import type { ILogger } from '../logger';
import type { Model } from '../model/model';
import type { ResolvedAgent } from '../agentGraph';
import type { EffectiveConfig, MCPServerConfig, CapabilityInfo } from '../types/modelConfig';
import type {
  ResponsesApiInputItem,
  ResponsesApiResponse,
  ResponsesApiTool,
  ResponsesApiFunctionTool,
  FunctionCallOutputItem,
} from '../types/responsesApi';
import type { RunContext } from './RunContext';
import type { OutputClassifierInterface } from './outputClassifier';
import type { ToolResolver } from '../tools/toolResolver';
import type { MCPToolManager } from '../tools/mcpTool';
import type { ToolScopeProvider } from '../tools/toolScopeProvider';
import type { FunctionTool } from '../tools/tool';
import type { OutputClassification, ToolCallInfo } from './steps';
import {
  buildAgentEffectiveConfig,
  buildToolAvailabilityContext,
  applyScopeFilter,
  sanitizeToolsForServer,
} from './turnPreparation';
import { executeToolCalls, type ToolCallResult } from '../tools/toolExecution';
import { extractTextFromResponse, extractServerToolCallId } from './responseProcessor';
import { toErrorMessage } from '../errors';
import type { AgentLifecycleEvent } from '../types/lifecycle';

/**
 * Dependencies injected into each turn of the run loop.
 */
export interface TurnDeps {
  model: Model;
  config: EffectiveConfig;
  mcpServers: MCPServerConfig[];
  toolResolver: ToolResolver;
  mcpToolManager?: MCPToolManager;
  toolScopeProvider?: ToolScopeProvider;
  functionTools?: FunctionTool[];
  capabilities: CapabilityInfo;
  outputClassifier: OutputClassifierInterface;
  logger: ILogger;
  onLifecycleEvent?: (event: AgentLifecycleEvent) => void;
  toolErrorFormatter?: (toolName: string, error: string) => string;
}

/**
 * Build the tools array for a single agent turn.
 */
export async function buildAgentTools(
  agent: ResolvedAgent,
  deps: TurnDeps,
  ctx: RunContext,
  options?: { excludeAgentAsToolTools?: boolean },
): Promise<ResponsesApiTool[]> {
  const agentConfig = buildAgentEffectiveConfig(
    deps.config,
    agent.config,
    ctx.hasUsedTools(agent.key),
  );

  const filteredServers = filterMcpServers(deps.mcpServers, agent.config.mcpServers);

  const baseTools: ResponsesApiTool[] = [];

  if (agent.config.enableRAG) {
    const storeIds = [...new Set(agentConfig.vectorStoreIds)];
    if (storeIds.length > 0) {
      baseTools.push({
        type: 'file_search',
        vector_store_ids: storeIds,
        max_num_results: agentConfig.fileSearchMaxResults,
        ranking_options: agentConfig.fileSearchScoreThreshold
          ? { score_threshold: agentConfig.fileSearchScoreThreshold }
          : undefined,
      });
    }
  }

  if (deps.mcpToolManager && filteredServers.length > 0) {
    const mcpTools = await deps.mcpToolManager.ensureDiscovered(
      filteredServers,
      deps.toolResolver,
    );
    baseTools.push(...mcpTools);
  }

  if (agentConfig.functions) {
    for (const func of agentConfig.functions) {
      baseTools.push({
        type: 'function',
        name: func.name,
        description: func.description,
        parameters: func.parameters,
        strict: func.strict ?? true,
      });
    }
  }

  if (deps.functionTools) {
    for (const ft of deps.functionTools) {
      baseTools.push({
        type: 'function',
        name: ft.name,
        description: ft.description,
        parameters: ft.parameters,
        strict: ft.strict,
      });
    }
  }

  if (agentConfig.enableWebSearch) baseTools.push({ type: 'web_search' });
  if (agentConfig.enableCodeInterpreter) baseTools.push({ type: 'code_interpreter' });

  const agentTools = options?.excludeAgentAsToolTools
    ? agent.handoffTools
    : [...agent.handoffTools, ...agent.agentAsToolTools];

  let allTools: ResponsesApiTool[] = [...baseTools, ...agentTools];

  allTools = applyScopeFilter(
    allTools,
    agentTools,
    deps.config.toolScoping,
    deps.toolScopeProvider,
    ctx.userQuery,
    deps.logger,
    agent.key,
  );

  return sanitizeToolsForServer(allTools, deps.capabilities, deps.logger);
}

function filterMcpServers(
  allServers: MCPServerConfig[],
  agentServerIds: string[] | undefined,
): MCPServerConfig[] {
  if (agentServerIds === undefined) return allServers;
  if (agentServerIds.length === 0) return [];
  const idSet = new Set(agentServerIds);
  return allServers.filter(s => idSet.has(s.id));
}
