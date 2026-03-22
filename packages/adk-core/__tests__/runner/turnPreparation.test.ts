import { describe, it, expect, vi } from 'vitest';
import {
  buildAgentEffectiveConfig,
  buildToolAvailabilityContext,
  applyScopeFilter,
  sanitizeToolsForServer,
  reduceToolsForContextBudget,
} from '../../src/runner/turnPreparation';
import { noopLogger } from '../../src/logger';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { EffectiveConfig, CapabilityInfo } from '../../src/types/modelConfig';
import type { ResponsesApiTool, ResponsesApiFunctionTool } from '../../src/types/responsesApi';
import type { ResolvedAgent } from '../../src/agent/agentGraph';
import type { ToolScopeProvider } from '../../src/tools/toolScopeProvider';

function makeBaseConfig(overrides?: Partial<EffectiveConfig>): EffectiveConfig {
  return {
    systemPrompt: 'base prompt',
    model: 'llama3',
    ...overrides,
  } as EffectiveConfig;
}

function makeAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: 'Test',
    instructions: 'agent prompt',
    ...overrides,
  };
}

function makeFnTool(name: string): ResponsesApiFunctionTool {
  return { type: 'function', name, description: name, parameters: {}, strict: true };
}

describe('buildAgentEffectiveConfig', () => {
  it('merges agent instructions as systemPrompt', () => {
    const result = buildAgentEffectiveConfig(makeBaseConfig(), makeAgentConfig());
    expect(result.systemPrompt).toBe('agent prompt');
  });

  it('overrides model from agent', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig(),
      makeAgentConfig({ model: 'gpt-4' }),
    );
    expect(result.model).toBe('gpt-4');
  });

  it('falls back to base model when agent has none', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig({ model: 'llama3' }),
      makeAgentConfig(),
    );
    expect(result.model).toBe('llama3');
  });

  it('resets toolChoice when hasUsedTools and resetToolChoice is default', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig(),
      makeAgentConfig({ toolChoice: 'required' }),
      true,
    );
    expect(result.toolChoice).toBeUndefined();
  });

  it('preserves toolChoice when resetToolChoice is false', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig(),
      makeAgentConfig({ toolChoice: 'required', resetToolChoice: false }),
      true,
    );
    expect(result.toolChoice).toBe('required');
  });

  it('applies outputSchema as textFormat', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig(),
      makeAgentConfig({ outputSchema: { name: 'MySchema', schema: { type: 'object' } } }),
    );
    expect(result.textFormat).toEqual({
      type: 'json_schema',
      json_schema: { name: 'MySchema', schema: { type: 'object' }, strict: true },
    });
  });

  it('applies outputSchema with strict false', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig(),
      makeAgentConfig({ outputSchema: { name: 'S', schema: {}, strict: false } }),
    );
    expect((result.textFormat as Record<string, unknown>).json_schema).toEqual(
      expect.objectContaining({ strict: false }),
    );
  });

  it('overrides vectorStoreIds from agent', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig({ vectorStoreIds: ['global-store'] }),
      makeAgentConfig({ vectorStoreIds: ['agent-store'] }),
    );
    expect(result.vectorStoreIds).toEqual(['agent-store']);
  });

  it('falls back to base vectorStoreIds when agent has empty array', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig({ vectorStoreIds: ['global-store'] }),
      makeAgentConfig({ vectorStoreIds: [] }),
    );
    expect(result.vectorStoreIds).toEqual(['global-store']);
  });

  it('falls back to base vectorStoreIds when agent has none', () => {
    const result = buildAgentEffectiveConfig(
      makeBaseConfig({ vectorStoreIds: ['global-store'] }),
      makeAgentConfig(),
    );
    expect(result.vectorStoreIds).toEqual(['global-store']);
  });
});

describe('buildToolAvailabilityContext', () => {
  it('returns empty when all enabled tools are present', () => {
    const agent = makeAgentConfig({ enableRAG: true, enableWebSearch: true });
    const tools: ResponsesApiTool[] = [
      { type: 'file_search', vector_store_ids: ['v1'] },
      { type: 'web_search' },
    ];
    expect(buildToolAvailabilityContext(agent, tools)).toBe('');
  });

  it('warns about missing file_search when RAG enabled', () => {
    const agent = makeAgentConfig({ enableRAG: true });
    const result = buildToolAvailabilityContext(agent, []);
    expect(result).toContain('file_search');
    expect(result).toContain('NOT available');
  });

  it('warns about missing web_search', () => {
    const agent = makeAgentConfig({ enableWebSearch: true });
    const result = buildToolAvailabilityContext(agent, []);
    expect(result).toContain('web_search');
  });

  it('warns about missing code_interpreter', () => {
    const agent = makeAgentConfig({ enableCodeInterpreter: true });
    const result = buildToolAvailabilityContext(agent, []);
    expect(result).toContain('code_interpreter');
  });

  it('returns empty when nothing is enabled', () => {
    expect(buildToolAvailabilityContext(makeAgentConfig(), [])).toBe('');
  });
});

describe('applyScopeFilter', () => {
  it('returns all tools when scoping is disabled', () => {
    const tools: ResponsesApiTool[] = [makeFnTool('a'), makeFnTool('b')];
    const result = applyScopeFilter(tools, [], undefined, undefined, 'query', noopLogger, 'agent');
    expect(result).toEqual(tools);
  });

  it('returns all tools when below activation threshold', () => {
    const tools: ResponsesApiTool[] = [makeFnTool('a')];
    const config = { enabled: true, activationThreshold: 5 };
    const result = applyScopeFilter(tools, [], config, undefined, 'query', noopLogger, 'agent');
    expect(result).toEqual(tools);
  });

  it('returns all tools when no scopeProvider', () => {
    const tools = Array.from({ length: 15 }, (_, i) => makeFnTool(`t${i}`));
    const config = { enabled: true, activationThreshold: 5 };
    const result = applyScopeFilter(tools, [], config, undefined, 'query', noopLogger, 'agent');
    expect(result).toEqual(tools);
  });

  it('returns all tools when no userQuery', () => {
    const tools = Array.from({ length: 15 }, (_, i) => makeFnTool(`t${i}`));
    const config = { enabled: true, activationThreshold: 5 };
    const provider: ToolScopeProvider = { updateIndex: vi.fn(), filterTools: vi.fn() };
    const result = applyScopeFilter(tools, [], config, provider, '', noopLogger, 'agent');
    expect(result).toEqual(tools);
  });

  it('filters tools using scope provider', () => {
    const tools = Array.from({ length: 15 }, (_, i) => makeFnTool(`t${i}`));
    const agentTools = [makeFnTool('handoff_1')];
    const config = { enabled: true, activationThreshold: 5 };
    const provider: ToolScopeProvider = {
      updateIndex: vi.fn(),
      filterTools: vi.fn().mockReturnValue({
        scopedTools: new Map([['agent', ['t0', 't1']]]),
        durationMs: 5,
      }),
    };
    const result = applyScopeFilter(tools, agentTools, config, provider, 'query', noopLogger, 'agent');
    expect(result.length).toBeLessThan(tools.length);
  });
});

describe('sanitizeToolsForServer', () => {
  it('returns tools as-is when strictField is supported', () => {
    const tools: ResponsesApiTool[] = [makeFnTool('a')];
    const caps: CapabilityInfo = { functionTools: true, strictField: true } as CapabilityInfo;
    expect(sanitizeToolsForServer(tools, caps, noopLogger)).toEqual(tools);
  });

  it('strips strict field when not supported', () => {
    const tools: ResponsesApiTool[] = [makeFnTool('a')];
    const caps: CapabilityInfo = { functionTools: true, strictField: false } as CapabilityInfo;
    const result = sanitizeToolsForServer(tools, caps, noopLogger);
    expect(result[0]).not.toHaveProperty('strict');
  });

  it('leaves non-function tools unchanged', () => {
    const tools: ResponsesApiTool[] = [{ type: 'web_search' }];
    const caps: CapabilityInfo = { functionTools: true, strictField: false } as CapabilityInfo;
    expect(sanitizeToolsForServer(tools, caps, noopLogger)).toEqual(tools);
  });
});

describe('reduceToolsForContextBudget', () => {
  it('preserves handoff and agent-as-tool tools', () => {
    const handoffTool = makeFnTool('transfer_to_eng');
    const agent: ResolvedAgent = {
      key: 'router',
      functionName: 'router',
      config: makeAgentConfig(),
      handoffTools: [handoffTool],
      agentAsToolTools: [],
      handoffTargetKeys: new Set(),
      asToolTargetKeys: new Set(),
    };
    const removable = Array.from({ length: 10 }, (_, i) => makeFnTool(`tool_${i}`));
    const allTools = [handoffTool, ...removable];
    const result = reduceToolsForContextBudget(allTools, agent);

    expect(result).toContainEqual(handoffTool);
    expect(result.length).toBeLessThan(allTools.length);
  });

  it('halves removable tools', () => {
    const agent: ResolvedAgent = {
      key: 'a',
      functionName: 'a',
      config: makeAgentConfig(),
      handoffTools: [],
      agentAsToolTools: [],
      handoffTargetKeys: new Set(),
      asToolTargetKeys: new Set(),
    };
    const tools = Array.from({ length: 10 }, (_, i) => makeFnTool(`t${i}`));
    const result = reduceToolsForContextBudget(tools, agent);
    expect(result.length).toBe(5);
  });

  it('keeps at least 1 removable tool', () => {
    const agent: ResolvedAgent = {
      key: 'a',
      functionName: 'a',
      config: makeAgentConfig(),
      handoffTools: [],
      agentAsToolTools: [],
      handoffTargetKeys: new Set(),
      asToolTargetKeys: new Set(),
    };
    const tools = [makeFnTool('only_one')];
    const result = reduceToolsForContextBudget(tools, agent);
    expect(result.length).toBe(1);
  });
});
