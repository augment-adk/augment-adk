import type { ILogger } from '../logger';
import type { Model } from '../model';
import type { ResolvedAgent, AgentGraphSnapshot } from '../agent/agentGraph';
import type { EffectiveConfig, MCPServerConfig, CapabilityInfo } from '../types/modelConfig';
import type {
  ResponsesApiInputItem,
  ResponsesApiResponse,
} from '../types/responsesApi';
import { RunContext } from './RunContext';
import type { RunResult } from './RunResult';
import type { OutputClassifierInterface } from './outputClassifier';
import { DefaultOutputClassifier } from './outputClassifier';
import type { ToolResolver } from '../tools/toolResolver';
import type { MCPToolManager } from '../tools/mcpTool';
import type { ToolScopeProvider } from '../tools/toolScopeProvider';
import type { ToolSearchProvider } from '../tools/toolSearch';
import type { FunctionTool } from '../tools/tool';
import type { ApprovalStore } from '../approval/ApprovalStore';
import type { AgentLifecycleEvent } from '../types/lifecycle';
import { buildAgentTools } from './turnExecution';
import {
  buildAgentEffectiveConfig,
  buildToolAvailabilityContext,
} from './turnPreparation';
import { promptWithHandoffInstructions } from '../agent/handoff';
import {
  mergeAccumulatedToolCalls,
} from './turnPolicy';
import { processResponse } from './responseProcessor';
import { AgentNotFoundError, toErrorMessage } from '../errors';
import type { RetryPolicy } from './retryPolicy';
import { withRetry } from './retryPolicy';
import {
  processTurnClassification,
  handleMaxTurnsExceeded,
  registerFunctionTools,
  DEFAULT_MAX_AGENT_VISITS,
  type TurnEmitter,
  type SubAgentRunner,
} from './turnProcessor';

export interface RunnerOptions {
  model: Model;
  config: EffectiveConfig;
  mcpServers: MCPServerConfig[];
  toolResolver: ToolResolver;
  mcpToolManager?: MCPToolManager;
  toolScopeProvider?: ToolScopeProvider;
  functionTools?: FunctionTool[];
  capabilities: CapabilityInfo;
  outputClassifier?: OutputClassifierInterface;
  approvalStore?: ApprovalStore;
  conversationId?: string;
  logger: ILogger;
  onLifecycleEvent?: (event: AgentLifecycleEvent) => void;
  inputFilter?: (
    input: string | ResponsesApiInputItem[],
    agentKey: string,
    turn: number,
  ) => string | ResponsesApiInputItem[];
  toolErrorFormatter?: (toolName: string, error: string) => string;
  onMaxTurnsExceeded?: (ctx: {
    agentPath: string[];
    lastResponse?: ResponsesApiResponse;
  }) => RunResult | undefined;
  onModelError?: (error: Error, agentKey: string, turn: number) => string | undefined;
  signal?: AbortSignal;
  maxAgentVisits?: number;
  maxSubAgentTurns?: number;
  retryPolicy?: RetryPolicy;
  resumeState?: import('./RunState').RunState;
  approvalDecisions?: Array<{ callId: string; approved: boolean; reason?: string }>;
  toolSearchProvider?: ToolSearchProvider;
}

/**
 * Execute a non-streaming multi-agent run loop.
 */
export async function runLoop(
  userInput: string | ResponsesApiInputItem[],
  snapshot: AgentGraphSnapshot,
  options: RunnerOptions,
): Promise<RunResult> {
  const { agents, defaultAgentKey, maxTurns } = snapshot;
  const logger = options.logger;
  const classifier =
    options.outputClassifier ?? new DefaultOutputClassifier(logger);

  const queryString = typeof userInput === 'string' ? userInput : '';
  const resumeState = options.resumeState;

  const ctx = new RunContext({
    userQuery: queryString,
    previousResponseId: resumeState?.previousResponseId,
    conversationId: resumeState?.conversationId ?? options.conversationId,
  });

  let skipFirstPathPush = false;
  if (resumeState) {
    for (const key of resumeState.agentPath) {
      ctx.agentPath.push(key);
    }
    skipFirstPathPush = true;
  }

  if (options.approvalDecisions) {
    for (const decision of options.approvalDecisions) {
      if (decision.approved) {
        ctx.approveTool(decision.callId, decision.reason);
      } else {
        ctx.rejectTool(decision.callId, decision.reason);
      }
    }
  }

  let currentAgent = resumeState
    ? getAgent(agents, resumeState.currentAgentKey)
    : getAgent(agents, defaultAgentKey);

  let input: string | ResponsesApiInputItem[] = userInput;

  if (resumeState?.isInterrupted) {
    if (resumeState.pendingMcpApprovals?.length) {
      input = ctx.buildMcpApprovalResponses() as ResponsesApiInputItem[];
    } else if (resumeState.pendingToolCalls.length > 0) {
      input = ctx.buildApprovalOutputItems() as ResponsesApiInputItem[];
    }
  }
  let lastResponse: ResponsesApiResponse | undefined;

  registerFunctionTools(options.functionTools, options.toolResolver);

  const maxAgentVisits = options.maxAgentVisits ?? DEFAULT_MAX_AGENT_VISITS;

  const subAgentRunner: SubAgentRunner = async (
    subInput, subAgent, allAgents, parentCtx, procOptions, maxTurns,
  ) => {
    const subSnapshot: import('../agent/agentGraph').AgentGraphSnapshot = {
      agents: new Map(allAgents),
      defaultAgentKey: subAgent.key,
      maxTurns,
    };

    return runLoop(subInput, subSnapshot, {
      model: procOptions.model,
      config: procOptions.config,
      mcpServers: procOptions.mcpServers,
      toolResolver: procOptions.toolResolver,
      mcpToolManager: procOptions.mcpToolManager,
      toolScopeProvider: procOptions.toolScopeProvider,
      functionTools: procOptions.functionTools,
      capabilities: procOptions.capabilities,
      outputClassifier: procOptions.outputClassifier,
      approvalStore: procOptions.approvalStore,
      logger: procOptions.logger,
      toolErrorFormatter: procOptions.toolErrorFormatter,
      signal: procOptions.signal,
      maxAgentVisits: procOptions.maxAgentVisits,
      maxSubAgentTurns: options.maxSubAgentTurns,
      conversationId: options.conversationId,
      toolSearchProvider: options.toolSearchProvider,
    });
  };

  const emitter: TurnEmitter = {
    agentStart(agentKey, agentName, turn) {
      emit(options, { type: 'agent.start', agentKey, agentName, turn });
    },
    agentEnd(agentKey, agentName, turn, result) {
      emit(options, {
        type: 'agent.end',
        agentKey,
        agentName,
        turn,
        result: result ?? 'final_output',
      });
    },
    handoff(from, to, reason) {
      emit(options, {
        type: 'agent.handoff',
        fromAgent: from.name,
        toAgent: to.name,
        fromKey: from.key,
        toKey: to.key,
        reason,
      });
    },
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (options.signal?.aborted) {
      return {
        content: 'Run was aborted.',
        currentAgentKey: currentAgent.key,
        agentName: currentAgent.config.name,
        handoffPath: ctx.agentPath,
        toolCalls: ctx.accumulatedToolCalls,
      };
    }

    if (skipFirstPathPush) {
      skipFirstPathPush = false;
    } else {
      ctx.agentPath.push(currentAgent.key);
    }

    if (options.inputFilter) {
      input = options.inputFilter(input, currentAgent.key, turn);
    }

    emit(options, {
      type: 'agent.start',
      agentKey: currentAgent.key,
      agentName: currentAgent.config.name,
      turn,
    });

    const handoffTargets = [...(currentAgent.config.handoffs ?? [])]
      .map(key => {
        const a = agents.get(key);
        return a ? { key, config: a.config } : undefined;
      })
      .filter((t): t is { key: string; config: import('../types/agentConfig').AgentConfig } => !!t);

    const enrichedConfig = handoffTargets.length > 0
      ? { ...currentAgent.config, instructions: promptWithHandoffInstructions(currentAgent.config, handoffTargets) }
      : currentAgent.config;

    const agentConfig = buildAgentEffectiveConfig(
      options.config,
      enrichedConfig,
      ctx.hasUsedTools(currentAgent.key),
    );
    const tools = await buildAgentTools(currentAgent, {
      model: options.model,
      config: options.config,
      mcpServers: options.mcpServers,
      toolResolver: options.toolResolver,
      mcpToolManager: options.mcpToolManager,
      toolScopeProvider: options.toolScopeProvider,
      functionTools: options.functionTools,
      capabilities: options.capabilities,
      outputClassifier: classifier,
      logger,
      toolErrorFormatter: options.toolErrorFormatter,
    }, ctx, { agentConfig });

    const toolCtx = buildToolAvailabilityContext(currentAgent.config, tools);
    const composedInstructions = agentConfig.systemPrompt + toolCtx;

    let response: ResponsesApiResponse;
    try {
      const callModel = () => options.model.chatTurn(
        input,
        composedInstructions,
        tools,
        agentConfig,
        {
          previousResponseId: ctx.previousResponseId,
          conversationId: ctx.conversationId,
        },
      );

      response = options.retryPolicy
        ? await withRetry(callModel, options.retryPolicy, { agentKey: currentAgent.key, turn })
        : await callModel();
    } catch (error) {
      logger.error(`Turn ${turn} failed for agent "${currentAgent.key}": ${toErrorMessage(error)}`);

      if (options.onModelError) {
        const fallback = options.onModelError(
          error instanceof Error ? error : new Error(String(error)),
          currentAgent.key,
          turn,
        );
        if (fallback !== undefined) {
          emit(options, {
            type: 'agent.end',
            agentKey: currentAgent.key,
            agentName: currentAgent.config.name,
            turn,
            result: 'error',
          });
          return mergeAccumulatedToolCalls(
            { content: fallback, currentAgentKey: currentAgent.key, agentName: currentAgent.config.name, handoffPath: [...ctx.agentPath] },
            ctx.accumulatedToolCalls,
          );
        }
      }

      emit(options, {
        type: 'agent.end',
        agentKey: currentAgent.key,
        agentName: currentAgent.config.name,
        turn,
        result: 'error',
      });

      if (lastResponse) {
        const result = processResponse(lastResponse);
        return mergeAccumulatedToolCalls(
          { ...result, currentAgentKey: currentAgent.key, agentName: currentAgent.config.name, handoffPath: [...ctx.agentPath] },
          ctx.accumulatedToolCalls,
        );
      }
      throw error;
    }

    ctx.previousResponseId = response.id;
    lastResponse = response;

    const classification = classifier.classify(
      response.output,
      currentAgent,
      agents,
      options.toolResolver,
    );

    logger.info(`Turn ${turn + 1}: agent="${currentAgent.key}", result=${classification.type}`);

    const outcome = await processTurnClassification(
      classification,
      response,
      currentAgent,
      turn,
      ctx,
      agents,
      lastResponse,
      {
        model: options.model,
        config: options.config,
        mcpServers: options.mcpServers,
        toolResolver: options.toolResolver,
        mcpToolManager: options.mcpToolManager,
        toolScopeProvider: options.toolScopeProvider,
        functionTools: options.functionTools,
        capabilities: options.capabilities,
        outputClassifier: classifier,
        logger,
        toolErrorFormatter: options.toolErrorFormatter,
        approvalStore: options.approvalStore,
        signal: options.signal,
        maxAgentVisits,
        subAgentRunner,
        maxSubAgentTurns: options.maxSubAgentTurns,
        toolSearchProvider: options.toolSearchProvider,
      },
      emitter,
    );

    if (outcome.action === 'return') {
      return outcome.result;
    }

    input = outcome.nextInput;
    if (outcome.nextAgent) {
      currentAgent = outcome.nextAgent;
    }
  }

  return handleMaxTurnsExceeded(
    maxTurns,
    ctx,
    currentAgent.config.name,
    lastResponse,
    logger,
    options.onMaxTurnsExceeded,
    currentAgent.key,
  );
}

function getAgent(
  agents: Map<string, ResolvedAgent>,
  key: string,
): ResolvedAgent {
  const agent = agents.get(key);
  if (!agent) {
    throw new AgentNotFoundError(key, [...agents.keys()]);
  }
  return agent;
}

function emit(
  options: RunnerOptions,
  event: AgentLifecycleEvent,
): void {
  options.onLifecycleEvent?.(event);
  options.logger.info(`lifecycle: ${JSON.stringify(event)}`);
}
