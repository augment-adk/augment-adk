import type { AgentConfig } from './types/agentConfig';
import type { EffectiveConfig, MCPServerConfig, CapabilityInfo } from './types/modelConfig';
import type { Model } from './model/model';
import type { ILogger } from './logger';
import { consoleLogger } from './logger';
import type { RunResult } from './runner/RunResult';
import type { RunHooks } from './hooks';
import type { ToolScopeProvider } from './tools/toolScopeProvider';
import type { FunctionTool } from './tools/tool';
import type { ToolResolver as ToolResolverClass } from './tools/toolResolver';
import type { MCPToolManager } from './tools/mcpTool';
import type { ApprovalStore } from './approval/ApprovalStore';
import { resolveAgentGraph } from './agentGraph';
import { runLoop } from './runner/runLoop';
import { defaultCapabilities } from './model/llamastack/serverCapabilities';

/**
 * Options for the top-level `run()` function.
 */
export interface RunOptions {
  model: Model;
  agents: Record<string, AgentConfig>;
  defaultAgent: string;
  config: EffectiveConfig;

  mcpServers?: MCPServerConfig[];
  toolResolver?: ToolResolverClass;
  mcpToolManager?: MCPToolManager;
  toolScopeProvider?: ToolScopeProvider;
  functionTools?: FunctionTool[];
  capabilities?: CapabilityInfo;
  approvalStore?: ApprovalStore;
  hooks?: RunHooks;
  logger?: ILogger;
  maxAgentTurns?: number;

  /** Abort signal for cancelling an in-progress run. */
  signal?: AbortSignal;
}

/**
 * Top-level entry point for a multi-agent non-streaming run.
 *
 * ```ts
 * import { run } from '@augment-adk/augment-adk';
 *
 * const result = await run('List all namespaces', {
 *   model: llamaStackModel,
 *   agents: { router: routerConfig, engineer: engineerConfig },
 *   defaultAgent: 'router',
 *   config: effectiveConfig,
 * });
 * ```
 */
export async function run(
  userInput: string,
  options: RunOptions,
): Promise<RunResult> {
  const logger = options.logger ?? consoleLogger;
  const { ToolResolver: TR } = await import('./tools/toolResolver');
  const toolResolver = options.toolResolver ?? new TR(logger);
  const caps = options.capabilities ?? defaultCapabilities();

  const snapshot = resolveAgentGraph(
    options.agents,
    options.defaultAgent,
    options.maxAgentTurns,
    logger,
  );

  await options.hooks?.onRunStart?.();

  try {
    const result = await runLoop(userInput, snapshot, {
      model: options.model,
      config: options.config,
      mcpServers: options.mcpServers ?? [],
      toolResolver,
      mcpToolManager: options.mcpToolManager,
      toolScopeProvider: options.toolScopeProvider,
      functionTools: options.functionTools,
      capabilities: caps,
      approvalStore: options.approvalStore,
      logger,
      signal: options.signal,
      onLifecycleEvent: options.hooks?.onTurnStart
        ? event => {
            if (event.type === 'agent.start') {
              options.hooks?.onTurnStart?.(event.turn, event.agentKey);
            }
          }
        : undefined,
      inputFilter: options.hooks?.inputFilter,
      toolErrorFormatter: options.hooks?.toolErrorFormatter,
    });

    await options.hooks?.onRunEnd?.('success');
    return result;
  } catch (error) {
    await options.hooks?.onRunEnd?.('error');
    throw error;
  }
}
