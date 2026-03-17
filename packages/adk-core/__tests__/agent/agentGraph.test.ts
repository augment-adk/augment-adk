import { describe, it, expect } from 'vitest';
import { resolveAgentGraph } from '../../src/agent/agentGraph';
import { noopLogger } from '../../src/logger';
import { GraphValidationError } from '../../src/errors';
import type { AgentConfig } from '../../src/types/agentConfig';

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Test Agent',
    instructions: 'You are a test agent.',
    ...overrides,
  };
}

describe('resolveAgentGraph', () => {
  it('resolves a simple single-agent graph', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({ name: 'Main' }),
    };
    const snapshot = resolveAgentGraph(configs, 'main', undefined, noopLogger);

    expect(snapshot.agents.size).toBe(1);
    expect(snapshot.defaultAgentKey).toBe('main');
    expect(snapshot.maxTurns).toBe(10);

    const main = snapshot.agents.get('main')!;
    expect(main.key).toBe('main');
    expect(main.functionName).toBe('main');
    expect(main.config.name).toBe('Main');
    expect(main.handoffTools).toEqual([]);
    expect(main.agentAsToolTools).toEqual([]);
    expect(main.handoffTargetKeys).toEqual(new Set());
    expect(main.asToolTargetKeys).toEqual(new Set());
  });

  it('resolves multi-agent graph with handoffs', () => {
    const configs: Record<string, AgentConfig> = {
      router: makeAgentConfig({
        name: 'Router',
        handoffs: ['engineer', 'analyst'],
      }),
      engineer: makeAgentConfig({
        name: 'Engineer',
        handoffDescription: 'Handles technical tasks',
      }),
      analyst: makeAgentConfig({
        name: 'Analyst',
        handoffDescription: 'Handles analysis',
      }),
    };
    const snapshot = resolveAgentGraph(configs, 'router', 20, noopLogger);

    expect(snapshot.agents.size).toBe(3);
    expect(snapshot.defaultAgentKey).toBe('router');
    expect(snapshot.maxTurns).toBe(20);

    const router = snapshot.agents.get('router')!;
    expect(router.handoffTools).toHaveLength(2);
    expect(router.handoffTools.map(t => t.name)).toContain('transfer_to_engineer');
    expect(router.handoffTools.map(t => t.name)).toContain('transfer_to_analyst');
    expect(router.handoffTargetKeys).toEqual(new Set(['engineer', 'analyst']));
  });

  it('throws GraphValidationError when defaultAgent does not exist', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig(),
    };
    expect(() =>
      resolveAgentGraph(configs, 'nonexistent', undefined, noopLogger),
    ).toThrow(GraphValidationError);
    expect(() =>
      resolveAgentGraph(configs, 'nonexistent', undefined, noopLogger),
    ).toThrow(/defaultAgent "nonexistent" does not match any configured agent/);
  });

  it('throws GraphValidationError when defaultAgent is disabled', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({ enabled: false }),
    };
    expect(() =>
      resolveAgentGraph(configs, 'main', undefined, noopLogger),
    ).toThrow(GraphValidationError);
    expect(() =>
      resolveAgentGraph(configs, 'main', undefined, noopLogger),
    ).toThrow(/defaultAgent "main" is disabled/);
  });

  it('throws GraphValidationError when handoff target does not exist', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({ handoffs: ['ghost'] }),
    };
    expect(() =>
      resolveAgentGraph(configs, 'main', undefined, noopLogger),
    ).toThrow(GraphValidationError);
    expect(() =>
      resolveAgentGraph(configs, 'main', undefined, noopLogger),
    ).toThrow(/handoff to "ghost" which does not exist/);
  });

  it('throws GraphValidationError when asTools target does not exist', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({ asTools: ['ghost'] }),
    };
    expect(() =>
      resolveAgentGraph(configs, 'main', undefined, noopLogger),
    ).toThrow(GraphValidationError);
    expect(() =>
      resolveAgentGraph(configs, 'main', undefined, noopLogger),
    ).toThrow(/asTools reference to "ghost" which does not exist/);
  });

  it('correctly builds handoff tools for targets', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({
        name: 'Main',
        handoffs: ['helper'],
      }),
      helper: makeAgentConfig({
        name: 'Helper',
        handoffDescription: 'Assists with tasks',
        handoffInputSchema: {
          task: { type: 'string', description: 'The task' },
        },
      }),
    };
    const snapshot = resolveAgentGraph(configs, 'main', undefined, noopLogger);

    const main = snapshot.agents.get('main')!;
    const handoffTool = main.handoffTools[0];
    expect(handoffTool).toBeDefined();
    expect(handoffTool.type).toBe('function');
    expect(handoffTool.name).toBe('transfer_to_helper');
    expect(handoffTool.description).toContain('Handoff to the Helper agent');
    expect(handoffTool.description).toContain('Assists with tasks');
    expect(handoffTool.parameters).toEqual({
      type: 'object',
      properties: { task: { type: 'string', description: 'The task' } },
      additionalProperties: false,
    });
    expect(handoffTool.strict).toBe(false);
  });

  it('builds handoff tool with empty params when no input schema', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({ handoffs: ['helper'] }),
      helper: makeAgentConfig({ name: 'Helper' }),
    };
    const snapshot = resolveAgentGraph(configs, 'main', undefined, noopLogger);

    const handoffTool = snapshot.agents.get('main')!.handoffTools[0];
    expect(handoffTool.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(handoffTool.strict).toBe(true);
  });

  it('correctly builds agent-as-tool tools', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({
        name: 'Main',
        asTools: ['calculator'],
      }),
      calculator: makeAgentConfig({
        name: 'Calculator',
        handoffDescription: 'Performs calculations',
      }),
    };
    const snapshot = resolveAgentGraph(configs, 'main', undefined, noopLogger);

    const main = snapshot.agents.get('main')!;
    const asTool = main.agentAsToolTools[0];
    expect(asTool).toBeDefined();
    expect(asTool.type).toBe('function');
    expect(asTool.name).toBe('call_calculator');
    expect(asTool.description).toContain('Call the Calculator agent');
    expect(asTool.description).toContain('Performs calculations');
    expect(asTool.parameters).toEqual({
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'The input to send to the agent',
        },
      },
      required: ['input'],
      additionalProperties: false,
    });
    expect(asTool.strict).toBe(true);
  });

  it('skips handoff to disabled target', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({ handoffs: ['disabled'] }),
      disabled: makeAgentConfig({ name: 'Disabled', enabled: false }),
    };
    const snapshot = resolveAgentGraph(configs, 'main', undefined, noopLogger);

    const main = snapshot.agents.get('main')!;
    expect(main.handoffTools).toHaveLength(0);
    expect(main.handoffTargetKeys).toEqual(new Set(['disabled']));
  });

  it('skips asTools reference to disabled target', () => {
    const configs: Record<string, AgentConfig> = {
      main: makeAgentConfig({ asTools: ['disabled'] }),
      disabled: makeAgentConfig({ name: 'Disabled', enabled: false }),
    };
    const snapshot = resolveAgentGraph(configs, 'main', undefined, noopLogger);

    const main = snapshot.agents.get('main')!;
    expect(main.agentAsToolTools).toHaveLength(0);
  });
});
