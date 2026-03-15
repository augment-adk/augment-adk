import type { ResolvedAgent, AgentGraphSnapshot } from '../agentGraph';
import type {
  ResponsesApiInputItem,
  ResponsesApiResponse,
  FunctionCallOutputItem,
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
import {
  shouldStopAtToolNames,
  validateOutput,
  mergeAccumulatedToolCalls,
} from './turnResolution';
import {
  processResponse,
  extractTextFromResponse,
  extractServerToolCallId,
} from './responseProcessor';
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
  toErrorMessage,
} from '../errors';

const MAX_AGENT_VISITS = 4;

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
  userInput: string,
  snapshot: AgentGraphSnapshot,
  options: StreamRunnerOptions,
): Promise<RunResult> {
  const { agents, defaultAgentKey, maxTurns } = snapshot;
  const logger = options.logger;
  const push = options.onStreamEvent;
  const classifier =
    options.outputClassifier ?? new DefaultOutputClassifier(logger);
  const accumulator = new StreamAccumulator();

  const ctx = new RunContext({
    userQuery: userInput,
    previousResponseId: undefined,
    conversationId: options.conversationId,
  });

  let currentAgent = getAgent(agents, defaultAgentKey);
  let input: string | ResponsesApiInputItem[] = userInput;
  let lastResponse: ResponsesApiResponse | undefined;

  if (options.functionTools) {
    for (const ft of options.functionTools) {
      options.toolResolver.register({
        serverId: 'function',
        serverUrl: '',
        originalName: ft.name,
        prefixedName: ft.name,
        description: ft.description,
        inputSchema: ft.parameters,
      });
    }
  }

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

    push({
      type: 'agent_start',
      agentKey: currentAgent.key,
      agentName: currentAgent.config.name,
      turn,
    });

    const agentConfig = buildAgentEffectiveConfig(
      options.config,
      currentAgent.config,
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
    }, ctx);

    const toolCtx = buildToolAvailabilityContext(currentAgent.config, tools);
    const composedInstructions = agentConfig.systemPrompt + toolCtx;

    accumulator.reset();

    try {
      await options.model.chatTurnStream(
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
    } catch (error) {
      logger.error(`Turn ${turn} failed for agent "${currentAgent.key}": ${toErrorMessage(error)}`);

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

    switch (classification.type) {
      case 'backend_tool': {
        ctx.markToolUsed(currentAgent.key);
        const { approved, needsApproval } = partitionByApproval(
          classification.calls,
          options.toolResolver,
          options.mcpServers,
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

          push({
            type: 'approval_requested',
            toolName: result.pendingApproval.toolName,
            arguments: result.pendingApproval.arguments ?? '',
            serverLabel: result.pendingApproval.serverLabel ?? '',
            approvalRequestId: result.pendingApproval.approvalRequestId,
          });
          return mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls);
        }

        for (const call of approved) {
          const info = options.toolResolver.getServerInfo(call.name);
          push({
            type: 'tool_called',
            toolName: info?.originalName ?? call.name,
            arguments: call.arguments,
            agentKey: currentAgent.key,
            callId: call.callId,
          });
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

          push({
            type: 'tool_output',
            toolName: r.name,
            output: r.output,
            agentKey: currentAgent.key,
            callId: r.callId,
          });
        }

        if (shouldStopAtToolNames(currentAgent.config, approved)) {
          push({
            type: 'agent_end',
            agentKey: currentAgent.key,
            agentName: currentAgent.config.name,
            turn,
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

        push({
          type: 'agent_end',
          agentKey: currentAgent.key,
          agentName: currentAgent.config.name,
          turn,
        });
        push({
          type: 'handoff_occurred',
          fromAgent: currentAgent.config.name,
          toAgent: target.config.name,
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
          const subConfig = buildAgentEffectiveConfig(options.config, subAgent.config);
          const subTools = await buildAgentTools(subAgent, {
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
          }, ctx, { excludeAgentAsToolTools: true });

          let subInput = classification.arguments || '';
          try {
            const parsed = JSON.parse(subInput);
            if (typeof parsed.input === 'string') subInput = parsed.input;
          } catch {
            // Arguments are not valid JSON; pass raw string as sub-agent input
          }

          const subResponse = await options.model.chatTurn(
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
          push({
            type: 'agent_end',
            agentKey: currentAgent.key,
            agentName: currentAgent.config.name,
            turn,
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
        push({
          type: 'agent_end',
          agentKey: currentAgent.key,
          agentName: currentAgent.config.name,
          turn,
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
