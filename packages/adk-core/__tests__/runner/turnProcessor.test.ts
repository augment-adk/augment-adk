import { describe, it, expect, vi } from 'vitest';
import {
  processTurnClassification,
  handleMaxTurnsExceeded,
  registerFunctionTools,
  DEFAULT_MAX_AGENT_VISITS,
  type TurnEmitter,
  type TurnProcessorOptions,
} from '../../src/runner/turnProcessor';
import { RunContext } from '../../src/runner/RunContext';
import { noopLogger } from '../../src/logger';
import type { ResolvedAgent } from '../../src/agent/agentGraph';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { ResponsesApiResponse, ResponsesApiOutputEvent } from '../../src/types/responsesApi';
import type { OutputClassification } from '../../src/runner/steps';
import { CycleDetectedError, MaxTurnsError } from '../../src/errors';

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Test Agent',
    instructions: 'You are a test agent.',
    ...overrides,
  };
}

function makeResolvedAgent(key: string, overrides: Partial<AgentConfig> = {}): ResolvedAgent {
  const config = makeAgentConfig(overrides);
  return {
    key,
    functionName: key,
    config,
    handoffTools: [],
    agentAsToolTools: [],
    handoffTargetKeys: new Set(),
    asToolTargetKeys: new Set(),
  };
}

function makeResponse(id = 'resp-1', output: ResponsesApiOutputEvent[] = []): ResponsesApiResponse {
  return { id, output };
}

function makeEmitter(): TurnEmitter & { calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    agentStart(agentKey, agentName, turn) {
      calls.push({ method: 'agentStart', args: [agentKey, agentName, turn] });
    },
    agentEnd(agentKey, agentName, turn, result) {
      calls.push({ method: 'agentEnd', args: [agentKey, agentName, turn, result] });
    },
    handoff(from, to, reason) {
      calls.push({ method: 'handoff', args: [from, to, reason] });
    },
    toolCalled(toolName, args, agentKey, callId) {
      calls.push({ method: 'toolCalled', args: [toolName, args, agentKey, callId] });
    },
    toolOutput(toolName, output, agentKey, callId) {
      calls.push({ method: 'toolOutput', args: [toolName, args, agentKey, callId] });
    },
    approvalRequested(info) {
      calls.push({ method: 'approvalRequested', args: [info] });
    },
  };
}

function makeProcessorOptions(overrides: Partial<TurnProcessorOptions> = {}): TurnProcessorOptions {
  return {
    model: { chatTurn: vi.fn(), chatTurnStream: vi.fn(), testConnection: vi.fn() } as any,
    config: { systemPrompt: '', model: 'test' } as any,
    mcpServers: [],
    toolResolver: {
      isKnown: () => false,
      getServerInfo: () => undefined,
      register: vi.fn(),
      resolve: () => undefined,
    } as any,
    functionTools: [],
    capabilities: { functionTools: true, strictField: true } as any,
    outputClassifier: { classify: vi.fn() } as any,
    logger: noopLogger,
    maxAgentVisits: DEFAULT_MAX_AGENT_VISITS,
    ...overrides,
  };
}

describe('processTurnClassification', () => {
  describe('final_output', () => {
    it('returns the response content', async () => {
      const agent = makeResolvedAgent('test');
      const response = makeResponse('r1', [
        { type: 'message', content: [{ type: 'output_text', text: 'Hello world' }] } as any,
      ]);
      const ctx = new RunContext({ userQuery: 'hi' });
      const emitter = makeEmitter();

      const outcome = await processTurnClassification(
        { type: 'final_output' },
        response,
        agent,
        0,
        ctx,
        new Map([['test', agent]]),
        undefined,
        makeProcessorOptions(),
        emitter,
      );

      expect(outcome.action).toBe('return');
      if (outcome.action === 'return') {
        expect(outcome.result.content).toBe('Hello world');
        expect(outcome.result.agentName).toBe('Test Agent');
      }
      expect(emitter.calls.some(c => c.method === 'agentEnd')).toBe(true);
    });

    it('validates output against outputSchema when present', async () => {
      const agent = makeResolvedAgent('test', {
        outputSchema: {
          name: 'TestSchema',
          schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
        },
      });
      const response = makeResponse('r1', [
        { type: 'message', content: [{ type: 'output_text', text: '{}' }] } as any,
      ]);
      const ctx = new RunContext({ userQuery: 'hi' });

      const outcome = await processTurnClassification(
        { type: 'final_output' },
        response,
        agent,
        0,
        ctx,
        new Map([['test', agent]]),
        undefined,
        makeProcessorOptions(),
        makeEmitter(),
      );

      expect(outcome.action).toBe('return');
      if (outcome.action === 'return') {
        expect(outcome.result.outputValidationError).toContain('name');
      }
    });
  });

  describe('continue', () => {
    it('returns continue action with synthetic tool output', async () => {
      const agent = makeResolvedAgent('test');
      const response = makeResponse('r1', []);
      const ctx = new RunContext({ userQuery: 'hi' });

      const outcome = await processTurnClassification(
        { type: 'continue' },
        response,
        agent,
        3,
        ctx,
        new Map([['test', agent]]),
        undefined,
        makeProcessorOptions(),
        makeEmitter(),
      );

      expect(outcome.action).toBe('continue');
      if (outcome.action === 'continue') {
        expect(outcome.nextInput).toHaveLength(1);
        const item = (outcome.nextInput as any[])[0];
        expect(item.type).toBe('function_call_output');
        expect(item.output).toContain('Continue');
      }
    });
  });

  describe('handoff — cycle detection (A1)', () => {
    it('returns last response when cycle detected and lastResponse exists', async () => {
      const router = makeResolvedAgent('router', { handoffs: ['target'] });
      const target = makeResolvedAgent('target', { name: 'Target' });
      router.handoffTargetKeys.add('target');
      const agents = new Map([['router', router], ['target', target]]);

      const lastResponse = makeResponse('last', [
        { type: 'message', content: [{ type: 'output_text', text: 'last text' }] } as any,
      ]);
      const ctx = new RunContext({ userQuery: 'hi' });
      // Simulate many visits
      for (let i = 0; i < DEFAULT_MAX_AGENT_VISITS + 1; i++) {
        ctx.recordVisit('target');
      }

      const outcome = await processTurnClassification(
        { type: 'handoff', targetKey: 'target', callId: 'c1' },
        makeResponse(),
        router,
        5,
        ctx,
        agents,
        lastResponse,
        makeProcessorOptions({ maxAgentVisits: DEFAULT_MAX_AGENT_VISITS }),
        makeEmitter(),
      );

      expect(outcome.action).toBe('return');
    });

    it('throws CycleDetectedError when cycle detected and no lastResponse', async () => {
      const router = makeResolvedAgent('router', { handoffs: ['target'] });
      const target = makeResolvedAgent('target', { name: 'Target' });
      router.handoffTargetKeys.add('target');
      const agents = new Map([['router', router], ['target', target]]);

      const ctx = new RunContext({ userQuery: 'hi' });
      for (let i = 0; i < DEFAULT_MAX_AGENT_VISITS + 1; i++) {
        ctx.recordVisit('target');
      }

      await expect(
        processTurnClassification(
          { type: 'handoff', targetKey: 'target', callId: 'c1' },
          makeResponse(),
          router,
          5,
          ctx,
          agents,
          undefined,
          makeProcessorOptions({ maxAgentVisits: DEFAULT_MAX_AGENT_VISITS }),
          makeEmitter(),
        ),
      ).rejects.toThrow(CycleDetectedError);
    });

    it('respects configurable maxAgentVisits', async () => {
      const router = makeResolvedAgent('router', { handoffs: ['target'] });
      const target = makeResolvedAgent('target', { name: 'Target' });
      router.handoffTargetKeys.add('target');
      const agents = new Map([['router', router], ['target', target]]);

      const ctx = new RunContext({ userQuery: 'hi' });
      ctx.recordVisit('target');
      ctx.recordVisit('target');

      // With maxAgentVisits=2 and 2 prior visits, visit 3 > 2 triggers cycle.
      // No lastResponse → throws CycleDetectedError.
      await expect(
        processTurnClassification(
          { type: 'handoff', targetKey: 'target', callId: 'c1' },
          makeResponse(),
          router,
          2,
          ctx,
          agents,
          undefined,
          makeProcessorOptions({ maxAgentVisits: 2 }),
          makeEmitter(),
        ),
      ).rejects.toThrow(CycleDetectedError);
    });

    it('allows visits below maxAgentVisits', async () => {
      const router = makeResolvedAgent('router', { handoffs: ['target'] });
      const target = makeResolvedAgent('target', { name: 'Target' });
      router.handoffTargetKeys.add('target');
      const agents = new Map([['router', router], ['target', target]]);

      const ctx = new RunContext({ userQuery: 'hi' });
      ctx.recordVisit('target');

      // maxAgentVisits=3 and 1 prior visit → visit 2 <= 3, no cycle
      const outcome = await processTurnClassification(
        { type: 'handoff', targetKey: 'target', callId: 'c1' },
        makeResponse(),
        router,
        1,
        ctx,
        agents,
        undefined,
        makeProcessorOptions({ maxAgentVisits: 3 }),
        makeEmitter(),
      );

      expect(outcome.action).toBe('continue');
      if (outcome.action === 'continue') {
        expect(outcome.nextAgent?.key).toBe('target');
      }
    });
  });

  describe('handoff — normal flow', () => {
    it('emits agentEnd and handoff events, returns continue with nextAgent', async () => {
      const router = makeResolvedAgent('router', { handoffs: ['target'] });
      const target = makeResolvedAgent('target', { name: 'Target', handoffDescription: 'Target agent' });
      router.handoffTargetKeys.add('target');
      const agents = new Map([['router', router], ['target', target]]);
      const emitter = makeEmitter();
      const ctx = new RunContext({ userQuery: 'hi' });

      const outcome = await processTurnClassification(
        { type: 'handoff', targetKey: 'target', callId: 'c1', metadata: '{"reason":"user asked"}' },
        makeResponse(),
        router,
        0,
        ctx,
        agents,
        undefined,
        makeProcessorOptions(),
        emitter,
      );

      expect(outcome.action).toBe('continue');
      if (outcome.action === 'continue') {
        expect(outcome.nextAgent?.key).toBe('target');
      }
      expect(emitter.calls.some(c => c.method === 'agentEnd')).toBe(true);
      expect(emitter.calls.some(c => c.method === 'handoff')).toBe(true);
    });
  });

  describe('mcp_approval_request', () => {
    it('returns with pendingApproval and emits approvalRequested', async () => {
      const agent = makeResolvedAgent('test');
      const response = makeResponse('r1', []);
      const emitter = makeEmitter();
      const ctx = new RunContext({ userQuery: 'hi' });

      const classification: OutputClassification = {
        type: 'mcp_approval_request',
        approvalRequestId: 'req-1',
        serverLabel: 'my-server',
        method: 'tools/call',
        params: { name: 'my_tool' },
      };

      const outcome = await processTurnClassification(
        classification,
        response,
        agent,
        0,
        ctx,
        new Map([['test', agent]]),
        undefined,
        makeProcessorOptions(),
        emitter,
      );

      expect(outcome.action).toBe('return');
      if (outcome.action === 'return') {
        expect(outcome.result.pendingApproval?.approvalRequestId).toBe('req-1');
        expect(outcome.result.pendingApproval?.serverLabel).toBe('my-server');
      }
      expect(emitter.calls.some(c => c.method === 'approvalRequested')).toBe(true);
    });
  });

  describe('tool_calls with approval store', () => {
    it('stores pending approvals and returns with pendingApprovals', async () => {
      const agent = makeResolvedAgent('test');
      const response = makeResponse('r1', [
        {
          type: 'function_call',
          id: 'c1',
          name: 'srv__dangerous_tool',
          arguments: '{"x":1}',
          call_id: 'c1',
        } as any,
      ]);
      const ctx = new RunContext({ userQuery: 'hi' });
      const emitter = makeEmitter();

      const approvalStore = {
        store: vi.fn(),
        get: vi.fn(),
        remove: vi.fn(),
        size: 0,
      };

      const resolver = {
        isKnown: () => true,
        getServerInfo: () => ({ serverId: 'srv', originalName: 'dangerous_tool' }),
        register: vi.fn(),
        resolve: () => undefined,
      } as any;

      const options = makeProcessorOptions({
        toolResolver: resolver,
        approvalStore: approvalStore as any,
        mcpServers: [{ id: 'srv', url: '', requireApproval: 'always' as any }],
      });

      const outcome = await processTurnClassification(
        {
          type: 'backend_tool',
          calls: [{ callId: 'c1', name: 'srv__dangerous_tool', arguments: '{"x":1}' }],
        },
        response,
        agent,
        0,
        ctx,
        new Map([['test', agent]]),
        undefined,
        options,
        emitter,
      );

      expect(outcome.action).toBe('return');
      if (outcome.action === 'return') {
        expect(outcome.result.pendingApprovals).toBeDefined();
        expect(outcome.result.pendingApprovals!.length).toBe(1);
        expect(outcome.result.pendingApproval).toBeDefined();
      }
      expect(approvalStore.store).toHaveBeenCalled();
    });
  });

  describe('agent_tool', () => {
    it('invokes sub-agent inline and returns tool output', async () => {
      const router = makeResolvedAgent('router', { asTools: ['helper'] });
      const helper = makeResolvedAgent('helper', { name: 'Helper' });

      const response = makeResponse('r1', [
        {
          type: 'function_call',
          id: 'c1',
          name: 'call_helper',
          arguments: '{"input":"help me"}',
          call_id: 'c1',
        } as any,
      ]);
      const ctx = new RunContext({ userQuery: 'hi' });
      const emitter = makeEmitter();

      const subResponse = makeResponse('sub-r', [
        { type: 'message', content: [{ type: 'output_text', text: 'sub-result' }] } as any,
      ]);

      const options = makeProcessorOptions({
        model: {
          chatTurn: vi.fn().mockResolvedValue(subResponse),
          chatTurnStream: vi.fn(),
          testConnection: vi.fn(),
        } as any,
      });

      const outcome = await processTurnClassification(
        {
          type: 'agent_tool',
          targetKey: 'helper',
          callId: 'c1',
          arguments: '{"input":"help me"}',
        },
        response,
        router,
        0,
        ctx,
        new Map([['router', router], ['helper', helper]]),
        undefined,
        options,
        emitter,
      );

      expect(outcome.action).toBe('continue');
      if (outcome.action === 'continue') {
        const output = (outcome.nextInput as any[])[0];
        expect(output.type).toBe('function_call_output');
        expect(output.output).toBe('sub-result');
      }
    });

    it('handles sub-agent error gracefully', async () => {
      const router = makeResolvedAgent('router', { asTools: ['helper'] });
      const helper = makeResolvedAgent('helper', { name: 'Helper' });

      const response = makeResponse('r1', []);
      const ctx = new RunContext({ userQuery: 'hi' });
      const emitter = makeEmitter();

      const options = makeProcessorOptions({
        model: {
          chatTurn: vi.fn().mockRejectedValue(new Error('sub-agent crash')),
          chatTurnStream: vi.fn(),
          testConnection: vi.fn(),
        } as any,
      });

      const outcome = await processTurnClassification(
        { type: 'agent_tool', targetKey: 'helper', callId: 'c1', arguments: '' },
        response,
        router,
        0,
        ctx,
        new Map([['router', router], ['helper', helper]]),
        undefined,
        options,
        emitter,
      );

      expect(outcome.action).toBe('continue');
      if (outcome.action === 'continue') {
        const output = (outcome.nextInput as any[])[0];
        expect(output.output).toContain('encountered an error');
      }
    });

    it('uses subAgentRunner when provided', async () => {
      const router = makeResolvedAgent('router');
      const helper = makeResolvedAgent('helper', { name: 'Helper' });

      const response = makeResponse('r1', []);
      const ctx = new RunContext({ userQuery: 'hi' });
      const emitter = makeEmitter();

      const subAgentRunner = vi.fn().mockResolvedValue({
        content: 'runner result',
      });

      const options = makeProcessorOptions({ subAgentRunner });

      const outcome = await processTurnClassification(
        { type: 'agent_tool', targetKey: 'helper', callId: 'c1', arguments: '{"input":"test"}' },
        response,
        router,
        0,
        ctx,
        new Map([['router', router], ['helper', helper]]),
        undefined,
        options,
        emitter,
      );

      expect(outcome.action).toBe('continue');
      expect(subAgentRunner).toHaveBeenCalled();
    });

    it('uses subAgentRunner and surfaces pending approvals', async () => {
      const router = makeResolvedAgent('router');
      const helper = makeResolvedAgent('helper', { name: 'Helper' });

      const response = makeResponse('r1', []);
      const ctx = new RunContext({ userQuery: 'hi' });
      const emitter = makeEmitter();

      const subAgentRunner = vi.fn().mockResolvedValue({
        content: 'partial',
        pendingApproval: {
          approvalRequestId: 'ar1',
          toolName: 'dangerous',
          serverLabel: 'srv',
        },
      });

      const options = makeProcessorOptions({ subAgentRunner });

      const outcome = await processTurnClassification(
        { type: 'agent_tool', targetKey: 'helper', callId: 'c1', arguments: '' },
        response,
        router,
        0,
        ctx,
        new Map([['router', router], ['helper', helper]]),
        undefined,
        options,
        emitter,
      );

      expect(outcome.action).toBe('return');
      if (outcome.action === 'return') {
        expect(outcome.result.pendingApproval?.approvalRequestId).toBe('ar1');
      }
    });
  });
});

describe('handleMaxTurnsExceeded', () => {
  it('returns result with maxTurnsExceeded=true when lastResponse exists', () => {
    const ctx = new RunContext({ userQuery: 'hi' });
    ctx.agentPath.push('router', 'engineer');
    const lastResponse = makeResponse('last', [
      { type: 'message', content: [{ type: 'output_text', text: 'partial' }] } as any,
    ]);

    const result = handleMaxTurnsExceeded(
      10,
      ctx,
      'Test Agent',
      lastResponse,
      noopLogger,
    );

    expect(result.maxTurnsExceeded).toBe(true);
    expect(result.agentName).toBe('Test Agent');
    expect(result.handoffPath).toEqual(['router', 'engineer']);
  });

  it('throws MaxTurnsError when no lastResponse', () => {
    const ctx = new RunContext({ userQuery: 'hi' });
    ctx.agentPath.push('router');

    expect(() =>
      handleMaxTurnsExceeded(10, ctx, 'Test Agent', undefined, noopLogger),
    ).toThrow(MaxTurnsError);
  });

  it('uses onMaxTurnsExceeded handler when provided', () => {
    const ctx = new RunContext({ userQuery: 'hi' });
    const handler = vi.fn().mockReturnValue({ content: 'custom result' });

    const result = handleMaxTurnsExceeded(
      10,
      ctx,
      'Test Agent',
      undefined,
      noopLogger,
      handler,
    );

    expect(handler).toHaveBeenCalledWith({ agentPath: [], lastResponse: undefined });
    expect(result.content).toBe('custom result');
  });
});

describe('registerFunctionTools', () => {
  it('skips already-known tools', () => {
    const registerFn = vi.fn();
    const resolver = {
      isKnown: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      register: registerFn,
    } as any;

    const tools = [
      { name: 'tool_a', description: 'A', parameters: {}, execute: async () => '' },
      { name: 'tool_b', description: 'B', parameters: {}, execute: async () => '' },
    ];

    registerFunctionTools(tools, resolver);

    expect(registerFn).toHaveBeenCalledTimes(1);
    expect(registerFn).toHaveBeenCalledWith(
      expect.objectContaining({ originalName: 'tool_a' }),
    );
  });

  it('does nothing when functionTools is undefined', () => {
    const registerFn = vi.fn();
    const resolver = { isKnown: vi.fn(), register: registerFn } as any;

    registerFunctionTools(undefined, resolver);

    expect(registerFn).not.toHaveBeenCalled();
  });
});
