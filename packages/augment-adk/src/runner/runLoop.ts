import type { ILogger } from '../logger';
import type { Model } from '../model/model';
import type { ResolvedAgent, AgentGraphSnapshot } from '../agentGraph';
import type { EffectiveConfig, MCPServerConfig, CapabilityInfo } from '../types/modelConfig';
import type {
  ResponsesApiInputItem,
  ResponsesApiResponse,
  ResponsesApiTool,
  FunctionCallOutputItem,
} from '../types/responsesApi';
import { RunContext } from './RunContext';
import type { RunResult } from './RunResult';
import type { OutputClassifierInterface } from './outputClassifier';
import { DefaultOutputClassifier } from './outputClassifier';
import type { ToolResolver } from '../tools/toolResolver';
import type { MCPToolManager } from '../tools/mcpTool';
import type { ToolScopeProvider } from '../tools/toolScopeProvider';
import type { FunctionTool } from '../tools/tool';
import type { ApprovalStore } from '../approval/ApprovalStore';
import type { AgentLifecycleEvent } from '../types/lifecycle';
import { ResponsesApiError } from '../model/llamastack/errors';
import {
  processResponse,
  extractTextFromResponse,
  extractServerToolCallId,
} from './responseProcessor';
import { buildAgentTools, type TurnDeps } from './turnExecution';
import {
  buildAgentEffectiveConfig,
  buildToolAvailabilityContext,
  reduceToolsForContextBudget,
} from './turnPreparation';
import {
  shouldStopAtToolNames,
  validateOutput,
  mergeAccumulatedToolCalls,
} from './turnResolution';
import { executeToolCalls } from '../tools/toolExecution';
import { partitionByApproval } from '../approval/partitionByApproval';
import {
  applyHandoffInputFilter,
  nestHandoffHistory,
  parseHandoffReason,
} from '../handoff';
import {
  MaxTurnsError,
  AgentNotFoundError,
  CycleDetectedError,
  toErrorMessage,
} from '../errors';

const MAX_AGENT_VISITS = 4;

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

  /** Abort signal for cancelling the run. */
  signal?: AbortSignal;
}

/**
 * Execute a non-streaming multi-agent run loop.
 */
export async function runLoop(
  userInput: string,
  snapshot: AgentGraphSnapshot,
  options: RunnerOptions,
): Promise<RunResult> {
  const { agents, defaultAgentKey, maxTurns } = snapshot;
  const logger = options.logger;
  const classifier =
    options.outputClassifier ?? new DefaultOutputClassifier(logger);

  const ctx = new RunContext({
    userQuery: userInput,
    previousResponseId: undefined,
    conversationId: undefined,
  });

  let currentAgent = getAgent(agents, defaultAgentKey);
  let input: string | ResponsesApiInputItem[] = userInput;
  let lastResponse: ResponsesApiResponse | undefined;

  const deps: TurnDeps = {
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
    onLifecycleEvent: options.onLifecycleEvent,
    toolErrorFormatter: options.toolErrorFormatter,
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

    ctx.agentPath.push(currentAgent.key);

    if (options.inputFilter) {
      input = options.inputFilter(input, currentAgent.key, turn);
    }

    emit(options, {
      type: 'agent.start',
      agentKey: currentAgent.key,
      agentName: currentAgent.config.name,
      turn,
    });

    const agentConfig = buildAgentEffectiveConfig(
      deps.config,
      currentAgent.config,
      ctx.hasUsedTools(currentAgent.key),
    );
    const tools = await buildAgentTools(currentAgent, deps, ctx);

    const toolCtx = buildToolAvailabilityContext(currentAgent.config, tools);
    const composedInstructions = agentConfig.systemPrompt + toolCtx;

    let response: ResponsesApiResponse;
    try {
      response = await deps.model.chatTurn(
        input,
        composedInstructions,
        tools,
        agentConfig,
        { previousResponseId: ctx.previousResponseId },
      );
    } catch (error) {
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
          { ...result, agentName: currentAgent.config.name, handoffPath: [...ctx.agentPath] },
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

    switch (classification.type) {
      case 'backend_tool': {
        ctx.markToolUsed(currentAgent.key);
        const { approved, needsApproval } = partitionByApproval(
          classification.calls,
          options.toolResolver,
          deps.mcpServers,
        );

        if (needsApproval.length > 0 && options.approvalStore) {
          for (const call of needsApproval) {
            const info = options.toolResolver.getServerInfo(call.name);
            if (info) {
              options.approvalStore.store({
                responseId: response.id,
                callId: call.callId,
                functionName: call.name,
                argumentsJson: call.arguments,
                serverId: info.serverId,
                serverUrl: '',
                originalToolName: info.originalName,
                createdAt: Date.now(),
                agentKey: currentAgent.key,
              });
            }
          }
          const result = processResponse(response);
          result.agentName = currentAgent.config.name;
          const info = options.toolResolver.getServerInfo(needsApproval[0].name);
          result.pendingApproval = {
            approvalRequestId: needsApproval[0].callId,
            toolName: info?.originalName ?? needsApproval[0].name,
            serverLabel: info?.serverId,
            arguments: needsApproval[0].arguments,
          };
          return mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls);
        }

        const results = await executeToolCalls(
          approved.map(c => ({
            callId: c.callId,
            name: c.name,
            arguments: c.arguments,
          })),
          {
            resolver: options.toolResolver,
            mcpToolManager: options.mcpToolManager,
            functionTools: options.functionTools,
            logger,
            toolErrorFormatter: options.toolErrorFormatter,
          },
        );

        for (const r of results) {
          ctx.accumulatedToolCalls.push({
            id: r.callId,
            name: r.name,
            serverLabel: r.serverLabel,
            arguments: approved.find(c => c.callId === r.callId)?.arguments,
            output: r.output,
            error: r.error,
          });
        }

        if (shouldStopAtToolNames(currentAgent.config, approved)) {
          emit(options, {
            type: 'agent.end',
            agentKey: currentAgent.key,
            agentName: currentAgent.config.name,
            turn,
            result: 'final_output',
          });
          return mergeAccumulatedToolCalls(
            {
              content: results.map(r => r.output).join('\n'),
              agentName: currentAgent.config.name,
              handoffPath: ctx.agentPath.length > 1 ? [...ctx.agentPath] : undefined,
            },
            ctx.accumulatedToolCalls,
          );
        }

        input = results.map(r => ({
          type: 'function_call_output' as const,
          call_id: r.callId,
          output: r.output,
        })) as FunctionCallOutputItem[];
        continue;
      }

      case 'handoff': {
        const target = getAgent(agents, classification.targetKey);
        const reason = parseHandoffReason(classification.metadata);

        emit(options, {
          type: 'agent.end',
          agentKey: currentAgent.key,
          agentName: currentAgent.config.name,
          turn,
          result: 'handoff',
        });
        emit(options, {
          type: 'agent.handoff',
          fromAgent: currentAgent.config.name,
          toAgent: target.config.name,
          fromKey: currentAgent.key,
          toKey: target.key,
          reason,
        });

        const handoffOutput: Record<string, unknown> = { assistant: target.config.name };
        if (reason) handoffOutput.reason = reason;

        let handoffInput: ResponsesApiInputItem[] = [
          {
            type: 'function_call_output',
            call_id: classification.callId,
            output: JSON.stringify(handoffOutput),
          },
        ];

        if (target.config.nestHandoffHistory) {
          handoffInput = nestHandoffHistory(
            handoffInput,
            currentAgent.config.name,
            target.config.name,
          );
        }

        input = applyHandoffInputFilter(handoffInput, target.config);
        currentAgent = target;

        const visitCount = ctx.recordVisit(target.key);
        if (visitCount > MAX_AGENT_VISITS) {
          logger.warn(`Cycle detected: "${target.key}" visited ${visitCount} times`);
          if (lastResponse) {
            const result = processResponse(lastResponse);
            return mergeAccumulatedToolCalls(
              { ...result, agentName: currentAgent.config.name, handoffPath: [...ctx.agentPath] },
              ctx.accumulatedToolCalls,
            );
          }
        }
        continue;
      }

      case 'agent_tool': {
        ctx.markToolUsed(currentAgent.key);
        const subAgent = getAgent(agents, classification.targetKey);

        let subText: string;
        try {
          const subConfig = buildAgentEffectiveConfig(deps.config, subAgent.config);
          const subTools = await buildAgentTools(subAgent, deps, ctx, {
            excludeAgentAsToolTools: true,
          });
          let subInput = classification.arguments || '';
          try {
            const parsed = JSON.parse(subInput);
            if (typeof parsed.input === 'string') subInput = parsed.input;
          } catch { /* use raw */ }

          const subResponse = await deps.model.chatTurn(
            subInput,
            subConfig.systemPrompt,
            subTools,
            subConfig,
          );
          subText = extractTextFromResponse(subResponse);
        } catch (err) {
          subText = `Sub-agent "${subAgent.config.name}" encountered an error.`;
          logger.error(`Agent-as-tool "${subAgent.key}" failed: ${toErrorMessage(err)}`);
        }

        if (
          currentAgent.config.toolUseBehavior === 'stop_on_first_tool' ||
          shouldStopAtToolNames(currentAgent.config, [
            { name: `call_${subAgent.functionName}` },
          ])
        ) {
          emit(options, {
            type: 'agent.end',
            agentKey: currentAgent.key,
            agentName: currentAgent.config.name,
            turn,
            result: 'final_output',
          });
          return mergeAccumulatedToolCalls(
            {
              content: subText || 'No output from sub-agent.',
              agentName: currentAgent.config.name,
              handoffPath: ctx.agentPath.length > 1 ? [...ctx.agentPath] : undefined,
            },
            ctx.accumulatedToolCalls,
          );
        }

        input = [
          {
            type: 'function_call_output',
            call_id: classification.callId,
            output: subText || 'No output from sub-agent.',
          },
        ];
        continue;
      }

      case 'final_output': {
        emit(options, {
          type: 'agent.end',
          agentKey: currentAgent.key,
          agentName: currentAgent.config.name,
          turn,
          result: 'final_output',
        });
        const result = processResponse(response);
        result.agentName = currentAgent.config.name;
        if (ctx.agentPath.length > 1) result.handoffPath = [...ctx.agentPath];

        if (currentAgent.config.outputSchema && result.content) {
          const validation = validateOutput(
            result.content,
            currentAgent.config.outputSchema,
          );
          if (!validation.valid) {
            result.outputValidationError = validation.error;
          }
        }

        return mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls);
      }

      case 'continue': {
        ctx.markToolUsed(currentAgent.key);
        input = [
          {
            type: 'function_call_output' as const,
            call_id:
              extractServerToolCallId(response.output) ?? `continue_${turn}`,
            output: 'Continue and provide a response based on the tool results.',
          },
        ];
        continue;
      }
    }
  }

  logger.warn(`Max turns (${maxTurns}) exceeded. Path: ${ctx.agentPath.join(' -> ')}`);

  if (options.onMaxTurnsExceeded) {
    const handlerResult = options.onMaxTurnsExceeded({
      agentPath: ctx.agentPath,
      lastResponse,
    });
    if (handlerResult) {
      return mergeAccumulatedToolCalls(handlerResult, ctx.accumulatedToolCalls);
    }
  }

  if (lastResponse) {
    const result = processResponse(lastResponse);
    result.agentName = currentAgent.config.name;
    if (ctx.agentPath.length > 1) result.handoffPath = [...ctx.agentPath];
    return mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls);
  }

  throw new MaxTurnsError(maxTurns, ctx.agentPath);
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
