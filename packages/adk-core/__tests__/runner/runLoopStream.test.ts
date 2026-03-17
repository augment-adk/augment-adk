import { describe, it, expect, vi } from 'vitest';
import { runLoopStream, type StreamRunnerOptions } from '../../src/runner/runLoopStream';
import { noopLogger } from '../../src/logger';
import type { ResolvedAgent, AgentGraphSnapshot } from '../../src/agent/agentGraph';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { EffectiveConfig, CapabilityInfo } from '../../src/types/modelConfig';
import type {
  ResponsesApiResponse,
  ResponsesApiOutputEvent,
  ResponsesApiFunctionTool,
} from '../../src/types/responsesApi';
import type { Model } from '../../src/model';
import type { RunStreamEvent } from '../../src/stream/runStreamEvents';
import { ToolResolver } from '../../src/tools/toolResolver';

function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return { name: 'Test', instructions: 'test', ...overrides };
}

function makeAgent(key: string, overrides?: Partial<AgentConfig>): ResolvedAgent {
  return {
    key,
    functionName: key,
    config: makeAgentConfig(overrides),
    handoffTools: [],
    agentAsToolTools: [],
    handoffTargetKeys: new Set(),
    asToolTargetKeys: new Set(),
  };
}

function makeResponse(id = 'resp-1', output: ResponsesApiOutputEvent[] = []): ResponsesApiResponse {
  return { id, output };
}

function makeFinalResponse(text = 'Hello!'): ResponsesApiResponse {
  return makeResponse('resp-final', [
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  ]);
}

function makeToolCallResponse(callId: string, toolName: string): ResponsesApiResponse {
  return makeResponse('resp-tool', [
    { type: 'function_call', id: callId, name: toolName, arguments: '{}', call_id: callId },
  ]);
}

function makeHandoffResponse(callId: string, targetKey: string): ResponsesApiResponse {
  return makeResponse('resp-handoff', [
    {
      type: 'function_call',
      id: callId,
      name: `transfer_to_${targetKey}`,
      arguments: '{}',
      call_id: callId,
    },
  ]);
}

function emitResponseEvents(resp: ResponsesApiResponse, onEvent: (raw: string) => void): void {
  onEvent(JSON.stringify({ type: 'response.created', response: { id: resp.id } }));
  for (const item of resp.output) {
    onEvent(JSON.stringify({ type: 'response.output_item.done', item }));
  }
  onEvent(JSON.stringify({ type: 'response.completed', response: resp }));
}

function makeStreamModel(responses: ResponsesApiResponse[]): Model {
  let callIdx = 0;
  return {
    chatTurn: vi.fn(),
    chatTurnStream: vi.fn().mockImplementation(
      async (_input: unknown, _sys: unknown, _tools: unknown, _config: unknown, onEvent: (raw: string) => void) => {
        const resp = responses[callIdx++] ?? makeFinalResponse();
        emitResponseEvents(resp, onEvent);
      },
    ),
    testConnection: vi.fn().mockResolvedValue(undefined),
  } as unknown as Model;
}

function makeSnapshot(
  agents: Map<string, ResolvedAgent>,
  defaultAgentKey: string,
  maxTurns = 10,
): AgentGraphSnapshot {
  return { agents, defaultAgentKey, maxTurns };
}

function makeOptions(model: Model, overrides?: Partial<StreamRunnerOptions>): StreamRunnerOptions {
  return {
    model,
    config: { systemPrompt: '', model: 'test' } as EffectiveConfig,
    mcpServers: [],
    toolResolver: new ToolResolver(noopLogger),
    capabilities: { functionTools: true, strictField: true } as CapabilityInfo,
    logger: noopLogger,
    onStreamEvent: vi.fn(),
    ...overrides,
  };
}

describe('runLoopStream', () => {
  it('single-turn final output', async () => {
    const model = makeStreamModel([makeFinalResponse('streaming hello')]);
    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const events: RunStreamEvent[] = [];
    const options = makeOptions(model, {
      onStreamEvent: (e) => events.push(e),
    });

    const result = await runLoopStream('hi', snapshot, options);
    expect(result.content).toBe('streaming hello');
    expect(events.some(e => e.type === 'agent_start')).toBe(true);
    expect(events.some(e => e.type === 'raw_model_event')).toBe(true);
  });

  it('multi-turn tool use', async () => {
    const toolFn = vi.fn().mockResolvedValue('tool result');
    const functionTools = [{
      type: 'function' as const,
      name: 'my_tool',
      description: 'A tool',
      parameters: {},
      execute: toolFn,
    }];

    const model = makeStreamModel([
      makeToolCallResponse('c1', 'my_tool'),
      makeFinalResponse('done with tools'),
    ]);

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const resolver = new ToolResolver(noopLogger);
    resolver.register({
      serverId: 'function', serverUrl: '', originalName: 'my_tool',
      prefixedName: 'my_tool', description: 'A tool', inputSchema: {},
    });

    const events: RunStreamEvent[] = [];
    const options = makeOptions(model, {
      functionTools,
      toolResolver: resolver,
      onStreamEvent: (e) => events.push(e),
    });

    const result = await runLoopStream('do something', snapshot, options);
    expect(result.content).toBe('done with tools');
    expect(toolFn).toHaveBeenCalled();
    expect(events.some(e => e.type === 'tool_called')).toBe(true);
    expect(events.some(e => e.type === 'tool_output')).toBe(true);
  });

  it('handoff between agents', async () => {
    const router = makeAgent('router', { handoffs: ['eng'] });
    const eng = makeAgent('eng', { name: 'Engineer' });
    const handoffTool: ResponsesApiFunctionTool = {
      type: 'function', name: 'transfer_to_eng', description: 'Handoff', parameters: {},
    };
    router.handoffTools = [handoffTool];
    router.handoffTargetKeys = new Set(['eng']);

    const model = makeStreamModel([
      makeHandoffResponse('c1', 'eng'),
      makeFinalResponse('engineer done'),
    ]);

    const agents = new Map([['router', router], ['eng', eng]]);
    const snapshot = makeSnapshot(agents, 'router');
    const events: RunStreamEvent[] = [];
    const options = makeOptions(model, {
      onStreamEvent: (e) => events.push(e),
    });

    const result = await runLoopStream('help', snapshot, options);
    expect(result.content).toBe('engineer done');
    expect(events.some(e => e.type === 'handoff_occurred')).toBe(true);
  });

  it('abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const model = makeStreamModel([makeFinalResponse()]);
    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model, { signal: controller.signal });

    const result = await runLoopStream('hi', snapshot, options);
    expect(result.content).toBe('Run was aborted.');
  });

  it('max turns exceeded', async () => {
    const model = makeStreamModel([
      makeToolCallResponse('c1', 'unknown_tool'),
      makeToolCallResponse('c2', 'unknown_tool'),
    ]);

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a', 2);
    const options = makeOptions(model);

    const result = await runLoopStream('hi', snapshot, options);
    expect(result.maxTurnsExceeded).toBe(true);
  });

  it('model error with onModelError fallback', async () => {
    const model = {
      chatTurn: vi.fn(),
      chatTurnStream: vi.fn().mockRejectedValue(new Error('stream crash')),
      testConnection: vi.fn(),
    } as unknown as Model;

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model, {
      onModelError: () => 'stream fallback',
    });

    const result = await runLoopStream('hi', snapshot, options);
    expect(result.content).toBe('stream fallback');
  });

  it('model error without fallback throws', async () => {
    const model = {
      chatTurn: vi.fn(),
      chatTurnStream: vi.fn().mockRejectedValue(new Error('stream crash')),
      testConnection: vi.fn(),
    } as unknown as Model;

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model);

    await expect(runLoopStream('hi', snapshot, options)).rejects.toThrow('stream crash');
  });

  it('input filter is applied', async () => {
    const model = makeStreamModel([makeFinalResponse()]);
    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');

    const inputFilter = vi.fn().mockImplementation((input) => `filtered: ${input}`);
    const options = makeOptions(model, { inputFilter });

    await runLoopStream('hi', snapshot, options);
    expect(inputFilter).toHaveBeenCalledWith('hi', 'a', 0);
  });

  it('resume from RunState', async () => {
    const model = makeStreamModel([makeFinalResponse('resumed')]);
    const agent = makeAgent('eng');
    const agents = new Map([['eng', agent]]);
    const snapshot = makeSnapshot(agents, 'eng');
    const options = makeOptions(model, {
      resumeState: {
        currentAgentKey: 'eng',
        turn: 1,
        previousResponseId: 'prev',
        agentPath: ['router', 'eng'],
        pendingToolCalls: [],
        isInterrupted: false,
      },
    });

    const result = await runLoopStream('continue', snapshot, options);
    expect(result.content).toBe('resumed');
  });

  it('retry policy retries on stream error', async () => {
    let callCount = 0;
    const model = {
      chatTurn: vi.fn(),
      chatTurnStream: vi.fn().mockImplementation(
        async (_input: unknown, _sys: unknown, _tools: unknown, _config: unknown, onEvent: (raw: string) => void) => {
          callCount++;
          if (callCount === 1) throw new Error('transient');
          const resp = makeFinalResponse('recovered');
          emitResponseEvents(resp, onEvent);
        },
      ),
      testConnection: vi.fn(),
    } as unknown as Model;

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model, {
      retryPolicy: () => true,
    });

    const result = await runLoopStream('hi', snapshot, options);
    expect(result.content).toBe('recovered');
    expect(callCount).toBe(2);
  });
});
