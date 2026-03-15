import type { ILogger } from '../logger';
import type { ResolvedAgent } from '../agentGraph';
import type { EffectiveConfig, CapabilityInfo, ToolScopingConfig } from '../types/modelConfig';
import type { AgentConfig } from '../types/agentConfig';
import type {
  ResponsesApiTool,
  ResponsesApiFunctionTool,
} from '../types/responsesApi';
import type { ToolScopeProvider, ToolDescriptor } from '../tools/toolScopeProvider';

const DEFAULT_ACTIVATION_THRESHOLD = 10;
const DEFAULT_MAX_TOOLS_PER_TURN = 6;
const DEFAULT_MIN_SCORE = 0.1;

/**
 * Build an agent-specific EffectiveConfig by merging per-agent overrides.
 */
export function buildAgentEffectiveConfig(
  base: EffectiveConfig,
  agent: AgentConfig,
  hasUsedTools = false,
): EffectiveConfig {
  let effectiveToolChoice = agent.toolChoice ?? base.toolChoice;
  if (hasUsedTools && (agent.resetToolChoice ?? true)) {
    effectiveToolChoice = undefined;
  }

  const config: EffectiveConfig = {
    ...base,
    systemPrompt: agent.instructions,
    model: agent.model ?? base.model,
    enableWebSearch: agent.enableWebSearch ?? false,
    enableCodeInterpreter: agent.enableCodeInterpreter ?? false,
    functions: agent.functions ?? undefined,
    toolChoice: effectiveToolChoice,
    reasoning: agent.reasoning ?? base.reasoning,
    guardrails: agent.guardrails ?? base.guardrails,
    maxToolCalls: agent.maxToolCalls ?? base.maxToolCalls,
    maxOutputTokens: agent.maxOutputTokens ?? base.maxOutputTokens,
    temperature: agent.temperature ?? base.temperature,
    promptRef: agent.promptRef ?? base.promptRef,
    truncation: agent.truncation ?? base.truncation,
  };

  if (agent.outputSchema) {
    config.textFormat = {
      type: 'json_schema',
      json_schema: {
        name: agent.outputSchema.name,
        schema: agent.outputSchema.schema,
        strict: agent.outputSchema.strict ?? true,
      },
    };
  }

  return config;
}

/**
 * Build runtime tool-availability context appended to agent instructions.
 * Prevents the LLM from hallucinating calls to tools not in its tool list.
 */
export function buildToolAvailabilityContext(
  agent: AgentConfig,
  tools: ResponsesApiTool[],
): string {
  const unavailable: string[] = [];

  if (agent.enableRAG && !tools.some(t => t.type === 'file_search')) {
    unavailable.push(
      '- **file_search** (knowledge base / RAG): Vector store is not configured. Do NOT call file_search.',
    );
  }
  if (agent.enableWebSearch && !tools.some(t => t.type === 'web_search')) {
    unavailable.push('- **web_search**: Not available. Do NOT call web_search.');
  }
  if (agent.enableCodeInterpreter && !tools.some(t => t.type === 'code_interpreter')) {
    unavailable.push('- **code_interpreter**: Not available. Do NOT call code_interpreter.');
  }

  if (unavailable.length === 0) return '';

  return (
    `\n\n---\n\n## Tool Availability Notice\n\n` +
    `The following tools are NOT available for this turn. ` +
    `Do not attempt to call them:\n\n${unavailable.join('\n')}` +
    `\n\nUse only the tools explicitly provided in your tool list.`
  );
}

/**
 * Apply semantic tool scoping to filter tools by relevance to the user query.
 */
export function applyScopeFilter(
  allTools: ResponsesApiTool[],
  agentTools: ResponsesApiFunctionTool[],
  scopingConfig: ToolScopingConfig | undefined,
  scopeProvider: ToolScopeProvider | undefined,
  userQuery: string | undefined,
  logger: ILogger,
  agentKey: string,
): ResponsesApiTool[] {
  if (
    !scopingConfig?.enabled ||
    !scopeProvider ||
    !userQuery ||
    allTools.length < (scopingConfig.activationThreshold ?? DEFAULT_ACTIVATION_THRESHOLD)
  ) {
    return allTools;
  }

  const descriptors: ToolDescriptor[] = allTools
    .filter((t): t is ResponsesApiFunctionTool => t.type === 'function')
    .map(t => ({ serverId: 'agent', name: t.name, description: t.description ?? t.name }));

  scopeProvider.updateIndex(descriptors);
  const result = scopeProvider.filterTools(
    userQuery,
    scopingConfig.maxToolsPerTurn ?? DEFAULT_MAX_TOOLS_PER_TURN,
    undefined,
    scopingConfig.minScore ?? DEFAULT_MIN_SCORE,
  );

  const allowedNames = new Set<string>();
  for (const [, names] of result.scopedTools) {
    for (const name of names) allowedNames.add(name);
  }

  const preserveNames = new Set(agentTools.map(t => t.name).filter(Boolean));

  const filtered = allTools.filter(t => {
    if (t.type !== 'function') return true;
    const ft = t as ResponsesApiFunctionTool;
    if (preserveNames.has(ft.name)) return true;
    return allowedNames.has(ft.name);
  });

  logger.info(
    `ToolScope filtered ${descriptors.length} → ${filtered.length} tools for "${agentKey}" (took ${result.durationMs}ms)`,
  );

  return filtered;
}

/**
 * Strip unsupported fields from tool definitions based on server capabilities.
 */
export function sanitizeToolsForServer(
  tools: ResponsesApiTool[],
  capabilities: CapabilityInfo,
  logger: ILogger,
): ResponsesApiTool[] {
  if (capabilities.strictField) return tools;

  return tools.map(tool => {
    if (tool.type !== 'function') return tool;
    const { strict, ...rest } = tool;
    if (strict !== undefined) {
      logger.debug(`Stripped 'strict' field from function tool "${rest.name}"`);
    }
    return rest as ResponsesApiTool;
  });
}

/**
 * Halve removable tools while preserving handoff and agent-as-tool tools.
 * Used for automatic retry when the model's context window overflows.
 */
export function reduceToolsForContextBudget(
  currentTools: ResponsesApiTool[],
  agent: ResolvedAgent,
): ResponsesApiTool[] {
  const preserveNames = new Set<string>();
  for (const t of [...agent.handoffTools, ...agent.agentAsToolTools]) {
    if (t.name) preserveNames.add(t.name);
  }

  const preserved: ResponsesApiTool[] = [];
  const removable: ResponsesApiTool[] = [];
  for (const t of currentTools) {
    const ft = t as ResponsesApiFunctionTool;
    if (t.type !== 'function' || preserveNames.has(ft.name)) {
      preserved.push(t);
    } else {
      removable.push(t);
    }
  }

  const keep = Math.max(1, Math.floor(removable.length / 2));
  return [...preserved, ...removable.slice(0, keep)];
}
