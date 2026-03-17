import type { AgentConfig } from './types/agentConfig';
import type { EffectiveConfig, MCPServerConfig, CapabilityInfo } from './types/modelConfig';
import type { ResponsesApiInputItem } from './types/responsesApi';
import type { Model } from './model';
import type { ILogger } from './logger';
import { consoleLogger } from './logger';
import type { RunResult } from './runner/RunResult';
import type { RunHooks } from './hooks';
import type { ToolScopeProvider } from './tools/toolScopeProvider';
import type { ToolSearchProvider } from './tools/toolSearch';
import type { FunctionTool } from './tools/tool';
import type { ToolResolver as ToolResolverClass } from './tools/toolResolver';
import type { MCPToolManager } from './tools/mcpTool';
import type { ApprovalStore } from './approval/ApprovalStore';
import type { RetryPolicy } from './runner/retryPolicy';
import type { Session } from './session';
import type { RunState } from './runner/RunState';
import { ServerManagedSession } from './session';
import { resolveAgentGraph } from './agent/agentGraph';
import { runLoop } from './runner/runLoop';
import { defaultCapabilities } from './capabilities';

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
  toolSearchProvider?: ToolSearchProvider;
  functionTools?: FunctionTool[];
  capabilities?: CapabilityInfo;
  approvalStore?: ApprovalStore;
  session?: Session;
  hooks?: RunHooks;
  logger?: ILogger;
  maxAgentTurns?: number;
  maxAgentVisits?: number;
  maxSubAgentTurns?: number;
  retryPolicy?: RetryPolicy;

  /** Conversation ID for server-side conversation grouping. */
  conversationId?: string;

  /** Abort signal for cancelling an in-progress run. */
  signal?: AbortSignal;

  /** Provide a RunState to resume from an interrupted run (e.g. after HITL approval). */
  resumeState?: RunState;

  /**
   * Approval decisions for resuming an interrupted run.
   * Each entry maps a callId to approved (true) or rejected (false).
   */
  approvalDecisions?: Array<{ callId: string; approved: boolean; reason?: string }>;
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

  const session = options.session;
  const isServerManaged = session instanceof ServerManagedSession;
  const conversationId = isServerManaged
    ? (session as ServerManagedSession).conversationId
    : options.conversationId;

  try {
    let effectiveInput: string | ResponsesApiInputItem[] = userInput;
    if (session && !isServerManaged) {
      const history = await session.getItems();
      if (history.length > 0) {
        const userItem: ResponsesApiInputItem = {
          type: 'message',
          role: 'user',
          content: userInput,
        } as ResponsesApiInputItem;
        effectiveInput = [...history, userItem];
      }
    }

    await options.hooks?.onRunStart?.();
    const result = await runLoop(
      effectiveInput,
      snapshot,
      {
        model: options.model,
        config: options.config,
        mcpServers: options.mcpServers ?? [],
        toolResolver,
        mcpToolManager: options.mcpToolManager,
        toolScopeProvider: options.toolScopeProvider,
        functionTools: options.functionTools,
        capabilities: caps,
        approvalStore: options.approvalStore,
        conversationId,
        logger,
        signal: options.signal,
        maxAgentVisits: options.maxAgentVisits,
        maxSubAgentTurns: options.maxSubAgentTurns,
        retryPolicy: options.retryPolicy,
        resumeState: options.resumeState,
        approvalDecisions: options.approvalDecisions,
        toolSearchProvider: options.toolSearchProvider,
        onLifecycleEvent: options.hooks?.onTurnStart
          ? event => {
              if (event.type === 'agent.start') {
                options.hooks?.onTurnStart?.(event.turn, event.agentKey);
              }
            }
          : undefined,
        inputFilter: options.hooks?.inputFilter,
        toolErrorFormatter: options.hooks?.toolErrorFormatter,
        onModelError: options.hooks?.onModelError,
      },
    );

    if (session && !isServerManaged) {
      const newItems: ResponsesApiInputItem[] = [
        { type: 'message', role: 'user', content: userInput } as ResponsesApiInputItem,
      ];
      if (result.content) {
        newItems.push({
          type: 'message',
          role: 'assistant',
          content: result.content,
        } as ResponsesApiInputItem);
      }
      await session.addItems(newItems);
    }

    const hookResult = result.maxTurnsExceeded ? 'max_turns' : 'success';
    await options.hooks?.onRunEnd?.(hookResult);
    return result;
  } catch (error) {
    await options.hooks?.onRunEnd?.('error');
    throw error;
  }
}
