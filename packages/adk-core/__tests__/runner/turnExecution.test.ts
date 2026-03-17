import { describe, it, expect, vi } from 'vitest';
import { buildAgentTools, type TurnDeps } from '../../src/runner/turnExecution';
import { RunContext } from '../../src/runner/RunContext';
import { noopLogger } from '../../src/logger';
import type { ResolvedAgent } from '../../src/agent/agentGraph';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { EffectiveConfig, CapabilityInfo } from '../../src/types/modelConfig';
import type { ResponsesApiFunctionTool } from '../../src/types/responsesApi';

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

function makeDeps(overrides?: Partial<TurnDeps>): TurnDeps {
  return {
    model: { chatTurn: vi.fn(), chatTurnStream: vi.fn(), testConnection: vi.fn() } as any,
    config: { systemPrompt: '', model: 'test' } as EffectiveConfig,
    mcpServers: [],
    toolResolver: {
      isKnown: () => false,
      getServerInfo: () => undefined,
      register: vi.fn(),
      resolve: () => undefined,
      getAll: () => [],
      clear: () => {},
      size: 0,
    } as any,
    capabilities: { functionTools: true, strictField: true, mcpTools: true } as CapabilityInfo,
    outputClassifier: { classify: vi.fn() } as any,
    logger: noopLogger,
    ...overrides,
  };
}

describe('buildAgentTools', () => {
  it('returns empty tools for agent with no capabilities', async () => {
    const agent = makeAgent('basic');
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, makeDeps(), ctx);
    expect(tools).toEqual([]);
  });

  it('includes file_search when RAG is enabled with vector stores', async () => {
    const agent = makeAgent('rag', { enableRAG: true });
    const deps = makeDeps({
      config: { systemPrompt: '', model: 'test', vectorStoreIds: ['vs1'] } as EffectiveConfig,
    });
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, deps, ctx);
    expect(tools.some(t => t.type === 'file_search')).toBe(true);
  });

  it('includes web_search when enabled', async () => {
    const agent = makeAgent('web', { enableWebSearch: true });
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, makeDeps(), ctx);
    expect(tools.some(t => t.type === 'web_search')).toBe(true);
  });

  it('includes code_interpreter when enabled', async () => {
    const agent = makeAgent('code', { enableCodeInterpreter: true });
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, makeDeps(), ctx);
    expect(tools.some(t => t.type === 'code_interpreter')).toBe(true);
  });

  it('includes MCP tools when mcpToolManager is provided', async () => {
    const mcpTool: ResponsesApiFunctionTool = {
      type: 'function', name: 'mcp__tool', description: 'mcp', parameters: {},
    };
    const mcpToolManager = {
      ensureDiscovered: vi.fn().mockResolvedValue([mcpTool]),
    };
    const deps = makeDeps({
      mcpToolManager: mcpToolManager as any,
      mcpServers: [{ id: 'srv', url: '' }],
    });
    const agent = makeAgent('mcp');
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, deps, ctx);
    expect(tools).toContainEqual(mcpTool);
    expect(mcpToolManager.ensureDiscovered).toHaveBeenCalled();
  });

  it('includes agent function definitions', async () => {
    const agent = makeAgent('fn', {
      functions: [{ name: 'greet', description: 'Greet', parameters: { type: 'object' } }],
    });
    const deps = makeDeps({
      config: { systemPrompt: '', model: 'test', functions: [{ name: 'greet', description: 'Greet', parameters: { type: 'object' } }] } as any,
    });
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, deps, ctx);
    expect(tools.some(t => t.type === 'function' && (t as ResponsesApiFunctionTool).name === 'greet')).toBe(true);
  });

  it('includes functionTools from deps', async () => {
    const ftool = {
      type: 'function' as const,
      name: 'my_fn',
      description: 'My function',
      parameters: {},
      execute: vi.fn(),
    };
    const deps = makeDeps({ functionTools: [ftool] });
    const agent = makeAgent('ft');
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, deps, ctx);
    expect(tools.some(t => t.type === 'function' && (t as ResponsesApiFunctionTool).name === 'my_fn')).toBe(true);
  });

  it('includes handoff and agent-as-tool tools', async () => {
    const handoffTool: ResponsesApiFunctionTool = {
      type: 'function', name: 'transfer_to_eng', description: 'Hand off', parameters: {},
    };
    const agentTool: ResponsesApiFunctionTool = {
      type: 'function', name: 'call_helper', description: 'Call helper', parameters: {},
    };
    const agent: ResolvedAgent = {
      ...makeAgent('router'),
      handoffTools: [handoffTool],
      agentAsToolTools: [agentTool],
    };
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, makeDeps(), ctx);
    expect(tools).toContainEqual(handoffTool);
    expect(tools).toContainEqual(agentTool);
  });

  it('excludes agent-as-tool tools when excludeAgentAsToolTools is set', async () => {
    const handoffTool: ResponsesApiFunctionTool = {
      type: 'function', name: 'transfer_to_eng', description: 'Hand off', parameters: {},
    };
    const agentTool: ResponsesApiFunctionTool = {
      type: 'function', name: 'call_helper', description: 'Call helper', parameters: {},
    };
    const agent: ResolvedAgent = {
      ...makeAgent('router'),
      handoffTools: [handoffTool],
      agentAsToolTools: [agentTool],
    };
    const ctx = new RunContext({ userQuery: 'hi' });
    const tools = await buildAgentTools(agent, makeDeps(), ctx, { excludeAgentAsToolTools: true });
    expect(tools).toContainEqual(handoffTool);
    expect(tools).not.toContainEqual(agentTool);
  });

  it('filters MCP servers by agent config', async () => {
    const mcpToolManager = {
      ensureDiscovered: vi.fn().mockResolvedValue([]),
    };
    const deps = makeDeps({
      mcpToolManager: mcpToolManager as any,
      mcpServers: [
        { id: 'srv-a', url: '' },
        { id: 'srv-b', url: '' },
      ],
    });
    const agent = makeAgent('selective', { mcpServers: ['srv-a'] });
    const ctx = new RunContext({ userQuery: 'hi' });
    await buildAgentTools(agent, deps, ctx);
    expect(mcpToolManager.ensureDiscovered).toHaveBeenCalledWith(
      [{ id: 'srv-a', url: '' }],
      expect.anything(),
    );
  });

  it('returns no MCP servers when agent specifies empty list', async () => {
    const mcpToolManager = {
      ensureDiscovered: vi.fn().mockResolvedValue([]),
    };
    const deps = makeDeps({
      mcpToolManager: mcpToolManager as any,
      mcpServers: [{ id: 'srv-a', url: '' }],
    });
    const agent = makeAgent('none', { mcpServers: [] });
    const ctx = new RunContext({ userQuery: 'hi' });
    await buildAgentTools(agent, deps, ctx);
    expect(mcpToolManager.ensureDiscovered).not.toHaveBeenCalled();
  });
});
