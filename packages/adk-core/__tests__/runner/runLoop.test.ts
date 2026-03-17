import { describe, it, expect, vi } from 'vitest';
import { runLoop, type RunnerOptions } from '../../src/runner/runLoop';
import { noopLogger } from '../../src/logger';
import type { ResolvedAgent, AgentGraphSnapshot } from '../../src/agent/agentGraph';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { EffectiveConfig, CapabilityInfo } from '../../src/types/modelConfig';
import type { ResponsesApiResponse, ResponsesApiOutputEvent, ResponsesApiFunctionTool } from '../../src/types/responsesApi';
import type { Model } from '../../src/model';
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

function makeToolCallResponse(
  callId: string,
  toolName: string,
  args = '{}',
): ResponsesApiResponse {
  return makeResponse('resp-tool', [
    { type: 'function_call', id: callId, name: toolName, arguments: args, call_id: callId },
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

function makeModel(chatTurnImpl?: (...args: unknown[]) => Promise<ResponsesApiResponse>): Model {
  return {
    chatTurn: chatTurnImpl
      ? vi.fn().mockImplementation(chatTurnImpl)
      : vi.fn().mockResolvedValue(makeFinalResponse()),
    chatTurnStream: vi.fn(),
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

function makeOptions(model: Model, overrides?: Partial<RunnerOptions>): RunnerOptions {
  return {
    model,
    config: { systemPrompt: '', model: 'test' } as EffectiveConfig,
    mcpServers: [],
    toolResolver: new ToolResolver(noopLogger),
    capabilities: { functionTools: true, strictField: true } as CapabilityInfo,
    logger: noopLogger,
    ...overrides,
  };
}

describe('runLoop', () => {
  it('single-turn final output', async () => {
    const model = makeModel();
    const agent = makeAgent('router');
    const agents = new Map([['router', agent]]);
    const snapshot = makeSnapshot(agents, 'router');
    const options = makeOptions(model);

    const result = await runLoop('hello', snapshot, options);
    expect(result.content).toBe('Hello!');
    expect(result.agentName).toBe('Test');
    expect(model.chatTurn).toHaveBeenCalledTimes(1);
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

    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeToolCallResponse('c1', 'my_tool'))
      .mockResolvedValueOnce(makeFinalResponse('done with tools'));

    const agent = makeAgent('router');
    const agents = new Map([['router', agent]]);
    const snapshot = makeSnapshot(agents, 'router');
    const resolver = new ToolResolver(noopLogger);
    resolver.register({
      serverId: 'function',
      serverUrl: '',
      originalName: 'my_tool',
      prefixedName: 'my_tool',
      description: 'A tool',
      inputSchema: {},
    });

    const options = makeOptions(model, { functionTools, toolResolver: resolver });
    const result = await runLoop('do something', snapshot, options);
    expect(result.content).toBe('done with tools');
    expect(model.chatTurn).toHaveBeenCalledTimes(2);
    expect(toolFn).toHaveBeenCalledTimes(1);
  });

  it('handoff between agents', async () => {
    const router = makeAgent('router', { handoffs: ['engineer'] });
    const engineer = makeAgent('engineer', { name: 'Engineer' });

    const handoffTool: ResponsesApiFunctionTool = {
      type: 'function',
      name: 'transfer_to_engineer',
      description: 'Hand off to engineer',
      parameters: {},
    };
    router.handoffTools = [handoffTool];
    router.handoffTargetKeys = new Set(['engineer']);

    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeHandoffResponse('c1', 'engineer'))
      .mockResolvedValueOnce(makeFinalResponse('engineer says hi'));

    const agents = new Map([['router', router], ['engineer', engineer]]);
    const snapshot = makeSnapshot(agents, 'router');
    const options = makeOptions(model);

    const result = await runLoop('help me', snapshot, options);
    expect(result.content).toBe('engineer says hi');
    expect(result.agentName).toBe('Engineer');
  });

  it('abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const model = makeModel();
    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model, { signal: controller.signal });

    const result = await runLoop('hi', snapshot, options);
    expect(result.content).toBe('Run was aborted.');
    expect(model.chatTurn).not.toHaveBeenCalled();
  });

  it('max turns exceeded with last response', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockResolvedValue(makeToolCallResponse('c1', 'unknown_tool'));

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a', 2);
    const options = makeOptions(model);

    const result = await runLoop('hi', snapshot, options);
    expect(result.maxTurnsExceeded).toBe(true);
  });

  it('max turns exceeded with onMaxTurnsExceeded handler', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockResolvedValue(makeToolCallResponse('c1', 'unknown_tool'));

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a', 1);
    const handler = vi.fn().mockReturnValue({ content: 'max turns custom' });
    const options = makeOptions(model, { onMaxTurnsExceeded: handler });

    const result = await runLoop('hi', snapshot, options);
    expect(result.content).toBe('max turns custom');
    expect(handler).toHaveBeenCalled();
  });

  it('model error with onModelError fallback', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('model crash'));

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model, {
      onModelError: () => 'fallback content',
    });

    const result = await runLoop('hi', snapshot, options);
    expect(result.content).toBe('fallback content');
  });

  it('model error without fallback throws', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('model crash'));

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model);

    await expect(runLoop('hi', snapshot, options)).rejects.toThrow('model crash');
  });

  it('lifecycle events are emitted', async () => {
    const events: unknown[] = [];
    const model = makeModel();
    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model, {
      onLifecycleEvent: (event) => events.push(event),
    });

    await runLoop('hi', snapshot, options);
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e: any) => e.type === 'agent.start')).toBe(true);
  });

  it('input filter is applied', async () => {
    const model = makeModel();
    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');

    const inputFilter = vi.fn().mockImplementation((input) => `filtered: ${input}`);
    const options = makeOptions(model, { inputFilter });

    await runLoop('hi', snapshot, options);
    expect(inputFilter).toHaveBeenCalledWith('hi', 'a', 0);
    expect(model.chatTurn).toHaveBeenCalledWith(
      'filtered: hi',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('throws AgentNotFoundError for invalid default agent', async () => {
    const model = makeModel();
    const agents = new Map<string, ResolvedAgent>();
    const snapshot = makeSnapshot(agents, 'missing');
    const options = makeOptions(model);

    await expect(runLoop('hi', snapshot, options)).rejects.toThrow('not found');
  });

  it('resume from RunState', async () => {
    const model = makeModel();
    const agent = makeAgent('eng', { name: 'Engineer' });
    const agents = new Map([['eng', agent]]);
    const snapshot = makeSnapshot(agents, 'eng');
    const options = makeOptions(model, {
      resumeState: {
        currentAgentKey: 'eng',
        turn: 1,
        previousResponseId: 'prev-resp',
        agentPath: ['router', 'eng'],
        pendingToolCalls: [],
        isInterrupted: false,
      },
    });

    const result = await runLoop('continue', snapshot, options);
    expect(result.content).toBe('Hello!');
  });

  it('retry policy retries on error', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(makeFinalResponse('recovered'));

    const agent = makeAgent('a');
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a');
    const options = makeOptions(model, {
      retryPolicy: () => true,
    });

    const result = await runLoop('hi', snapshot, options);
    expect(result.content).toBe('recovered');
    expect(model.chatTurn).toHaveBeenCalledTimes(2);
  });

  it('model error with last response returns gracefully', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(makeFinalResponse('first response'))
      .mockRejectedValueOnce(new Error('second call fail'));

    const agent = makeAgent('a');
    agent.config.toolUseBehavior = 'run_llm_again';
    const agents = new Map([['a', agent]]);
    const snapshot = makeSnapshot(agents, 'a', 2);

    const fnTool = {
      type: 'function' as const,
      name: 'my_fn',
      description: 'Test',
      parameters: {},
      execute: vi.fn().mockResolvedValue('result'),
    };
    const resolver = new ToolResolver(noopLogger);
    resolver.register({
      serverId: 'function', serverUrl: '', originalName: 'my_fn',
      prefixedName: 'my_fn', description: 'Test', inputSchema: {},
    });

    (model.chatTurn as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(makeToolCallResponse('c1', 'my_fn'))
      .mockRejectedValueOnce(new Error('crash'));

    const options = makeOptions(model, { functionTools: [fnTool], toolResolver: resolver });
    const result = await runLoop('hi', snapshot, options);
    expect(result.content).toBeDefined();
  });
});
