import type { ResolvedAgent, AgentGraphSnapshot } from '../agent/agentGraph';
import type {
  ResponsesApiInputItem,
  ResponsesApiResponse,
} from '../types/responsesApi';
import { RunContext } from './RunContext';
import type { RunResult } from './RunResult';
import { DefaultOutputClassifier } from './outputClassifier';
import type { RunnerOptions } from './runLoop';
import type { RunStreamEvent } from '../stream/runStreamEvents';
import { StreamAccumulator } from '../stream/streamAccumulator';
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
import {
  AgentNotFoundError,
  toErrorMessage,
} from '../errors';
import { withRetry } from './retryPolicy';
import {
  processTurnClassification,
  handleMaxTurnsExceeded,
  registerFunctionTools,
  DEFAULT_MAX_AGENT_VISITS,
  type TurnEmitter,
  type SubAgentRunner,
} from './turnProcessor';

export interface StreamRunnerOptions extends RunnerOptions {
  onStreamEvent: (event: RunStreamEvent) => void;
}

/**
 * Streaming multi-agent run loop.
 *
 * Mirrors `runLoop` but uses `model.chatTurnStream()` per turn,
 * forwarding raw SSE events in real time and accumulating the
 * response for classification between turns.
 */
export async function runLoopStream(
  userInput: string | ResponsesApiInputItem[],
  snapshot: AgentGraphSnapshot,
  options: StreamRunnerOptions,
): Promise<RunResult> {
  const { agents, defaultAgentKey, maxTurns } = snapshot;
  const logger = options.logger;
  const push = options.onStreamEvent;
  const classifier =
    options.outputClassifier ?? new DefaultOutputClassifier(logger);
  const accumulator = new StreamAccumulator();

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { resumeState, approvalDecisions, ...parentOpts } = options;
    return runLoopStream(subInput, subSnapshot, {
      ...parentOpts,
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
      maxSubAgentTurns: procOptions.maxSubAgentTurns,
      onStreamEvent: (event) => {
        push({ ...event, type: event.type as RunStreamEvent['type'] } as RunStreamEvent);
      },
    });
  };

  const emitter: TurnEmitter = {
    agentStart(agentKey, agentName, turn) {
      push({ type: 'agent_start', agentKey, agentName, turn });
    },
    agentEnd(agentKey, agentName, turn) {
      push({ type: 'agent_end', agentKey, agentName, turn });
    },
    handoff(from, to, reason) {
      push({
        type: 'handoff_occurred',
        fromAgent: from.name,
        toAgent: to.name,
        reason,
      });
    },
    toolCalled(toolName, args, agentKey, callId) {
      push({ type: 'tool_called', toolName, arguments: args, agentKey, callId });
    },
    toolOutput(toolName, output, agentKey, callId) {
      push({ type: 'tool_output', toolName, output, agentKey, callId });
    },
    approvalRequested(info) {
      push({
        type: 'approval_requested',
        toolName: info.toolName,
        arguments: info.arguments ?? '',
        serverLabel: info.serverLabel ?? '',
        approvalRequestId: info.approvalRequestId,
      });
    },
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (options.signal?.aborted) {
      return {
        content: 'Run was aborted.',
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

    push({
      type: 'agent_start',
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

    accumulator.reset();

    try {
      const callModelStream = () => options.model.chatTurnStream(
        input,
        composedInstructions,
        tools,
        agentConfig,
        (rawEvent: string) => {
          accumulator.processEvent(rawEvent);
          push({ type: 'raw_model_event', data: rawEvent });
        },
        {
          previousResponseId: ctx.previousResponseId,
          conversationId: ctx.conversationId,
        },
        options.signal,
      );

      if (options.retryPolicy) {
        await withRetry(callModelStream, options.retryPolicy, { agentKey: currentAgent.key, turn });
      } else {
        await callModelStream();
      }
    } catch (error) {
      logger.error(`Turn ${turn} failed for agent "${currentAgent.key}": ${toErrorMessage(error)}`);

      if (options.onModelError) {
        const fallback = options.onModelError(
          error instanceof Error ? error : new Error(String(error)),
          currentAgent.key,
          turn,
        );
        if (fallback !== undefined) {
          push({ type: 'agent_end', agentKey: currentAgent.key, agentName: currentAgent.config.name, turn });
          return mergeAccumulatedToolCalls(
            { content: fallback, agentName: currentAgent.config.name, handoffPath: [...ctx.agentPath] },
            ctx.accumulatedToolCalls,
          );
        }
      }

      push({
        type: 'agent_end',
        agentKey: currentAgent.key,
        agentName: currentAgent.config.name,
        turn,
      });

      if (lastResponse) {
        const result = processResponse(lastResponse);
        return mergeAccumulatedToolCalls(
          { ...result, agentName: currentAgent.config.name, handoffPath: [...ctx.agentPath] },
          ctx.accumulatedToolCalls,
        );
      }
      throw error;
    }

    const response = accumulator.getResponse();
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
