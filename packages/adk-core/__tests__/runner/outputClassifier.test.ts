import { describe, it, expect, vi } from 'vitest';
import { DefaultOutputClassifier } from '../../src/runner/outputClassifier';
import { noopLogger } from '../../src/logger';
import type { ResolvedAgent } from '../../src/agent/agentGraph';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { ResponsesApiOutputEvent, ResponsesApiFunctionCall } from '../../src/types/responsesApi';

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Test Agent',
    instructions: 'You are a test agent.',
    ...overrides,
  };
}

function makeResolvedAgent(key: string, overrides: Partial<AgentConfig> = {}): ResolvedAgent {
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

function makeFunctionCall(name: string, callId?: string): ResponsesApiFunctionCall {
  return {
    type: 'function_call',
    name,
    id: callId ?? `id_${name}`,
    call_id: callId ?? `id_${name}`,
    arguments: '{}',
  } as ResponsesApiFunctionCall;
}

describe('DefaultOutputClassifier', () => {
  const classifier = new DefaultOutputClassifier(noopLogger);

  it('classifies final_output when text is present', () => {
    const output: ResponsesApiOutputEvent[] = [
      { type: 'message', content: [{ type: 'output_text', text: 'Hello' }] } as any,
    ];
    const agent = makeResolvedAgent('test');

    const result = classifier.classify(output, agent, new Map([['test', agent]]));
    expect(result.type).toBe('final_output');
  });

  it('classifies continue when no text and no tool calls', () => {
    const result = classifier.classify([], makeResolvedAgent('test'), new Map());
    expect(result.type).toBe('continue');
  });

  it('classifies handoff when transfer_to_ call matches handoffTargetKeys', () => {
    const router = makeResolvedAgent('router');
    const engineer = makeResolvedAgent('engineer');
    router.handoffTargetKeys.add('engineer');
    const agents = new Map([['router', router], ['engineer', engineer]]);

    const output: ResponsesApiOutputEvent[] = [makeFunctionCall('transfer_to_engineer')];
    const result = classifier.classify(output, router, agents);

    expect(result.type).toBe('handoff');
    if (result.type === 'handoff') {
      expect(result.targetKey).toBe('engineer');
    }
  });

  it('classifies agent_tool when call_ call matches asToolTargetKeys', () => {
    const orchestrator = makeResolvedAgent('orchestrator');
    const calculator = makeResolvedAgent('calculator');
    orchestrator.asToolTargetKeys.add('calculator');
    const agents = new Map([['orchestrator', orchestrator], ['calculator', calculator]]);

    const output: ResponsesApiOutputEvent[] = [makeFunctionCall('call_calculator')];
    const result = classifier.classify(output, orchestrator, agents);

    expect(result.type).toBe('agent_tool');
    if (result.type === 'agent_tool') {
      expect(result.targetKey).toBe('calculator');
    }
  });

  describe('B1 — warns when concurrent tool calls are dropped', () => {
    it('logs warning when handoff drops other function calls', () => {
      const warnFn = vi.fn();
      const testLogger = { ...noopLogger, warn: warnFn };
      const warnClassifier = new DefaultOutputClassifier(testLogger);

      const router = makeResolvedAgent('router');
      const engineer = makeResolvedAgent('engineer');
      router.handoffTargetKeys.add('engineer');
      const agents = new Map([['router', router], ['engineer', engineer]]);
      const resolver = { isKnown: () => true } as any;

      const output: ResponsesApiOutputEvent[] = [
        makeFunctionCall('transfer_to_engineer', 'c1'),
        makeFunctionCall('some_tool', 'c2'),
        makeFunctionCall('another_tool', 'c3'),
      ];

      const result = warnClassifier.classify(output, router, agents, resolver);

      expect(result.type).toBe('handoff');
      expect(warnFn).toHaveBeenCalledTimes(1);
      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining('dropping 2 concurrent tool call(s)'),
      );
    });

    it('does not warn when handoff is the only function call', () => {
      const warnFn = vi.fn();
      const testLogger = { ...noopLogger, warn: warnFn };
      const warnClassifier = new DefaultOutputClassifier(testLogger);

      const router = makeResolvedAgent('router');
      const engineer = makeResolvedAgent('engineer');
      router.handoffTargetKeys.add('engineer');
      const agents = new Map([['router', router], ['engineer', engineer]]);

      const output: ResponsesApiOutputEvent[] = [
        makeFunctionCall('transfer_to_engineer'),
      ];

      warnClassifier.classify(output, router, agents);
      expect(warnFn).not.toHaveBeenCalled();
    });

    it('logs warning when agent-tool call drops other function calls', () => {
      const warnFn = vi.fn();
      const testLogger = { ...noopLogger, warn: warnFn };
      const warnClassifier = new DefaultOutputClassifier(testLogger);

      const orchestrator = makeResolvedAgent('orchestrator');
      const calc = makeResolvedAgent('calc');
      orchestrator.asToolTargetKeys.add('calc');
      const agents = new Map([['orchestrator', orchestrator], ['calc', calc]]);

      const output: ResponsesApiOutputEvent[] = [
        makeFunctionCall('call_calc', 'c1'),
        makeFunctionCall('backend_tool', 'c2'),
      ];

      const result = warnClassifier.classify(output, orchestrator, agents);

      expect(result.type).toBe('agent_tool');
      expect(warnFn).toHaveBeenCalledTimes(1);
      expect(warnFn).toHaveBeenCalledWith(
        expect.stringContaining('dropping 1 concurrent tool call(s)'),
      );
    });
  });

  it('classifies backend_tool for known resolver tools', () => {
    const agent = makeResolvedAgent('test');
    const resolver = { isKnown: (name: string) => name === 'my_tool' } as any;

    const output: ResponsesApiOutputEvent[] = [
      makeFunctionCall('my_tool', 'c1'),
    ];

    const result = classifier.classify(output, agent, new Map([['test', agent]]), resolver);

    expect(result.type).toBe('backend_tool');
    if (result.type === 'backend_tool') {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].name).toBe('my_tool');
    }
  });

  it('prioritises mcp_approval_request over function calls', () => {
    const agent = makeResolvedAgent('test');
    const output: ResponsesApiOutputEvent[] = [
      { type: 'mcp_approval_request', id: 'ap-1', server_label: 'srv', method: 'tools/call' } as any,
      makeFunctionCall('some_tool'),
    ];

    const result = classifier.classify(output, agent, new Map([['test', agent]]));
    expect(result.type).toBe('mcp_approval_request');
  });
});
