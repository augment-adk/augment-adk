import type { ILogger } from '../logger';
import type { Model } from '../model';
import type { ResolvedAgent } from '../agent/agentGraph';
import type { EffectiveConfig, MCPServerConfig, CapabilityInfo } from '../types/modelConfig';
import type {
  ResponsesApiInputItem,
  ResponsesApiResponse,
  FunctionCallOutputItem,
} from '../types/responsesApi';
import type { RunContext } from './RunContext';
import type { RunResult } from './RunResult';
import type { OutputClassification } from './steps';
import type { ToolResolver } from '../tools/toolResolver';
import type { MCPToolManager } from '../tools/mcpTool';
import type { ToolScopeProvider } from '../tools/toolScopeProvider';
import type { FunctionTool } from '../tools/tool';
import type { ApprovalStore } from '../approval/ApprovalStore';
import type { OutputClassifierInterface } from './outputClassifier';
import type { ApprovalInfo } from './responseProcessor';
import type { ToolSearchProvider } from '../tools/toolSearch';
import {
  processResponse,
  extractTextFromResponse,
  extractServerToolCallId,
} from './responseProcessor';
import { buildAgentTools, type TurnDeps } from './turnExecution';
import { buildAgentEffectiveConfig } from './turnPreparation';
import {
  evaluateToolUseBehavior,
  validateOutput,
  mergeAccumulatedToolCalls,
} from './turnPolicy';
import { executeToolCalls } from '../tools/toolExecution';
import { partitionByApproval } from '../approval/partitionByApproval';
import {
  applyHandoffInputFilter,
  wrapHandoffOutput,
  parseHandoffReason,
} from '../agent/handoff';
import {
  CycleDetectedError,
  AgentNotFoundError,
  MaxTurnsError,
  toErrorMessage,
} from '../errors';

export const DEFAULT_MAX_AGENT_VISITS = 4;
export const DEFAULT_SUB_AGENT_TURNS = 5;

export type TurnOutcome =
  | { action: 'continue'; nextInput: string | ResponsesApiInputItem[]; nextAgent?: ResolvedAgent }
  | { action: 'return'; result: RunResult };

/**
 * Abstraction for emitting lifecycle and stream events from shared
 * turn-processing logic. Non-streaming loops provide lifecycle callbacks;
 * streaming loops provide stream event callbacks.
 */
export interface TurnEmitter {
  agentStart?(agentKey: string, agentName: string, turn: number): void;
  agentEnd(agentKey: string, agentName: string, turn: number, result?: string): void;
  handoff(
    from: { key: string; name: string },
    to: { key: string; name: string },
    reason?: string,
  ): void;
  toolCalled?(toolName: string, args: string, agentKey: string, callId: string): void;
  toolOutput?(toolName: string, output: string, agentKey: string, callId: string): void;
  approvalRequested?(info: ApprovalInfo): void;
}

/**
 * Callback for running a sub-agent through a full run loop.
 * Injected by runLoop/runLoopStream to avoid circular imports.
 */
export type SubAgentRunner = (
  input: string,
  subAgent: ResolvedAgent,
  agents: ReadonlyMap<string, ResolvedAgent>,
  parentCtx: RunContext,
  options: TurnProcessorOptions,
  maxTurns: number,
) => Promise<RunResult>;

export interface TurnProcessorOptions {
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
  toolErrorFormatter?: (toolName: string, error: string) => string;
  approvalStore?: ApprovalStore;
  signal?: AbortSignal;
  maxAgentVisits: number;
  subAgentRunner?: SubAgentRunner;
  maxSubAgentTurns?: number;
  toolSearchProvider?: ToolSearchProvider;
}

/**
 * Process a turn's classification result and determine the next action.
 * Shared between the streaming and non-streaming run loops so that bug
 * fixes and behavioural changes only need to be applied once.
 */
export async function processTurnClassification(
  classification: OutputClassification,
  response: ResponsesApiResponse,
  currentAgent: ResolvedAgent,
  turn: number,
  ctx: RunContext,
  agents: ReadonlyMap<string, ResolvedAgent>,
  lastResponse: ResponsesApiResponse | undefined,
  options: TurnProcessorOptions,
  emitter: TurnEmitter,
): Promise<TurnOutcome> {
  const { logger } = options;

  switch (classification.type) {
    case 'backend_tool': {
      ctx.markToolUsed(currentAgent.key);
      const { approved, needsApproval } = partitionByApproval(
        classification.calls,
        options.toolResolver,
        options.mcpServers,
      );

      if (needsApproval.length > 0 && !options.approvalStore) {
        logger.warn(
          `${needsApproval.length} tool call(s) require approval but no approvalStore is configured. ` +
          `Skipped: ${needsApproval.map(c => c.name).join(', ')}`,
        );
      }

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
        result.currentAgentKey = currentAgent.key;
        result.agentName = currentAgent.config.name;
        result.pendingApprovals = needsApproval.map(call => {
          const info = options.toolResolver.getServerInfo(call.name);
          return {
            approvalRequestId: call.callId,
            toolName: info?.originalName ?? call.name,
            serverLabel: info?.serverId,
            arguments: call.arguments,
          };
        });
        result.pendingApproval = result.pendingApprovals[0];

        emitter.approvalRequested?.(result.pendingApproval);
        return {
          action: 'return',
          result: mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls),
        };
      }

      for (const call of approved) {
        const info = options.toolResolver.getServerInfo(call.name);
        emitter.toolCalled?.(
          info?.originalName ?? call.name,
          call.arguments,
          currentAgent.key,
          call.callId,
        );
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
          toolGuardrails: currentAgent.config.toolGuardrails,
          toolSearchProvider: options.toolSearchProvider,
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
        emitter.toolOutput?.(r.name, r.output, currentAgent.key, r.callId);
      }

      const behaviorDecision = evaluateToolUseBehavior(
        currentAgent.config,
        results.map(r => ({
          name: r.name,
          callId: r.callId,
          output: r.output,
          error: r.error,
        })),
        { agentName: currentAgent.config.name, agentKey: currentAgent.key, turn },
      );

      if (behaviorDecision.isFinalOutput) {
        emitter.agentEnd(currentAgent.key, currentAgent.config.name, turn, 'final_output');
        return {
          action: 'return',
          result: mergeAccumulatedToolCalls(
            {
              content: behaviorDecision.finalOutput ?? results.map(r => r.output).join('\n'),
              currentAgentKey: currentAgent.key,
              agentName: currentAgent.config.name,
              handoffPath: ctx.agentPath.length > 1 ? [...ctx.agentPath] : undefined,
            },
            ctx.accumulatedToolCalls,
          ),
        };
      }

      const toolOutputItems: FunctionCallOutputItem[] = results.map(r => ({
        type: 'function_call_output' as const,
        call_id: r.callId,
        output: r.output,
      }));

      const rejectionOutputs: FunctionCallOutputItem[] =
        needsApproval.length > 0 && !options.approvalStore
          ? needsApproval.map(call => ({
              type: 'function_call_output' as const,
              call_id: call.callId,
              output:
                'Tool call requires approval but no approval store is configured. Call was not executed.',
            }))
          : [];

      return {
        action: 'continue',
        nextInput: [
          ...toolOutputItems,
          ...rejectionOutputs,
        ] as ResponsesApiInputItem[],
      };
    }

    case 'handoff': {
      const target = getAgent(agents, classification.targetKey);
      const reason = parseHandoffReason(classification.metadata);

      emitter.agentEnd(currentAgent.key, currentAgent.config.name, turn, 'handoff');
      emitter.handoff(
        { key: currentAgent.key, name: currentAgent.config.name },
        { key: target.key, name: target.config.name },
        reason,
      );

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
        handoffInput = wrapHandoffOutput(
          handoffInput,
          currentAgent.config.name,
          target.config.name,
        );
      }

      const nextInput = applyHandoffInputFilter(handoffInput, target.config, {
        fromAgentName: currentAgent.config.name,
        toAgentName: target.config.name,
        reason,
      });

      const visitCount = ctx.recordVisit(target.key);
      if (visitCount > options.maxAgentVisits) {
        logger.warn(`Cycle detected: "${target.key}" visited ${visitCount} times`);
        if (lastResponse) {
          const result = processResponse(lastResponse);
          return {
            action: 'return',
            result: mergeAccumulatedToolCalls(
              { ...result, currentAgentKey: currentAgent.key, agentName: currentAgent.config.name, handoffPath: [...ctx.agentPath] },
              ctx.accumulatedToolCalls,
            ),
          };
        }
        throw new CycleDetectedError(target.key, visitCount);
      }

      return { action: 'continue', nextInput, nextAgent: target };
    }

    case 'agent_tool': {
      ctx.markToolUsed(currentAgent.key);
      const subAgent = getAgent(agents, classification.targetKey);

      emitter.agentStart?.(subAgent.key, subAgent.config.name, turn);

      let subText: string;
      try {
        if (options.signal?.aborted) {
          throw new Error('Run was aborted');
        }

        let subInput = classification.arguments || '';
        try {
          const parsed = JSON.parse(subInput);
          if (typeof parsed.input === 'string') subInput = parsed.input;
        } catch {
          // not valid JSON; use raw string
        }

        if (options.subAgentRunner) {
          const subResult = await options.subAgentRunner(
            subInput,
            subAgent,
            agents,
            ctx,
            options,
            options.maxSubAgentTurns ?? DEFAULT_SUB_AGENT_TURNS,
          );

          if (subResult.pendingApproval || subResult.pendingApprovals?.length) {
            const result = processResponse(response);
            result.currentAgentKey = currentAgent.key;
            result.agentName = currentAgent.config.name;
            result.pendingApproval = subResult.pendingApproval ?? subResult.pendingApprovals?.[0];
            result.pendingApprovals = subResult.pendingApprovals;
            if (ctx.agentPath.length > 1) result.handoffPath = [...ctx.agentPath];
            if (result.pendingApproval) {
              emitter.approvalRequested?.(result.pendingApproval);
            }
            return {
              action: 'return',
              result: mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls),
            };
          }

          subText = subResult.content;
        } else {
          const subConfig = buildAgentEffectiveConfig(options.config, subAgent.config);
          const subTools = await buildAgentTools(
            subAgent,
            toTurnDeps(options),
            ctx,
            { excludeAgentAsToolTools: true },
          );

          const subResponse = await options.model.chatTurn(
            subInput,
            subConfig.systemPrompt,
            subTools,
            subConfig,
          );
          subText = extractTextFromResponse(subResponse);
        }
      } catch (err) {
        subText = `Sub-agent "${subAgent.config.name}" encountered an error.`;
        logger.error(`Agent-as-tool "${subAgent.key}" failed: ${toErrorMessage(err)}`);
      }

      emitter.agentEnd(subAgent.key, subAgent.config.name, turn, 'final_output');

      const agentToolBehavior = evaluateToolUseBehavior(
        currentAgent.config,
        [{
          name: `call_${subAgent.functionName}`,
          callId: classification.callId,
          output: subText || 'No output from sub-agent.',
        }],
        { agentName: currentAgent.config.name, agentKey: currentAgent.key, turn },
      );

      if (agentToolBehavior.isFinalOutput) {
        emitter.agentEnd(currentAgent.key, currentAgent.config.name, turn, 'final_output');
        return {
          action: 'return',
          result: mergeAccumulatedToolCalls(
            {
              content: agentToolBehavior.finalOutput ?? (subText || 'No output from sub-agent.'),
              currentAgentKey: currentAgent.key,
              agentName: currentAgent.config.name,
              handoffPath: ctx.agentPath.length > 1 ? [...ctx.agentPath] : undefined,
            },
            ctx.accumulatedToolCalls,
          ),
        };
      }

      return {
        action: 'continue',
        nextInput: [
          {
            type: 'function_call_output',
            call_id: classification.callId,
            output: subText || 'No output from sub-agent.',
          },
        ] as ResponsesApiInputItem[],
      };
    }

    case 'mcp_approval_request': {
      const result = processResponse(response);
      result.currentAgentKey = currentAgent.key;
      result.agentName = currentAgent.config.name;
      if (ctx.agentPath.length > 1) result.handoffPath = [...ctx.agentPath];
      result.pendingApproval = {
        approvalRequestId: classification.approvalRequestId,
        toolName: classification.name,
        serverLabel: classification.serverLabel,
        arguments: classification.arguments,
      };
      emitter.approvalRequested?.(result.pendingApproval);
      return {
        action: 'return',
        result: mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls),
      };
    }

    case 'final_output': {
      emitter.agentEnd(currentAgent.key, currentAgent.config.name, turn, 'final_output');
      const result = processResponse(response);
      result.currentAgentKey = currentAgent.key;
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

      return {
        action: 'return',
        result: mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls),
      };
    }

    case 'continue': {
      ctx.markToolUsed(currentAgent.key);
      return {
        action: 'continue',
        nextInput: [
          {
            type: 'function_call_output' as const,
            call_id:
              extractServerToolCallId(response.output) ?? `continue_${turn}`,
            output: 'Continue and provide a response based on the tool results.',
          },
        ] as ResponsesApiInputItem[],
      };
    }
  }
}

/**
 * Handle the max-turns-exceeded condition at the end of a run loop.
 * Returns a RunResult with `maxTurnsExceeded: true` when possible,
 * or throws MaxTurnsError when no response is available.
 */
export function handleMaxTurnsExceeded(
  maxTurns: number,
  ctx: RunContext,
  currentAgentName: string,
  lastResponse: ResponsesApiResponse | undefined,
  logger: ILogger,
  onMaxTurnsExceeded?: (ctx: {
    agentPath: string[];
    lastResponse?: ResponsesApiResponse;
  }) => RunResult | undefined,
  currentAgentKey?: string,
): RunResult {
  logger.warn(`Max turns (${maxTurns}) exceeded. Path: ${ctx.agentPath.join(' -> ')}`);

  if (onMaxTurnsExceeded) {
    const handlerResult = onMaxTurnsExceeded({
      agentPath: ctx.agentPath,
      lastResponse,
    });
    if (handlerResult) {
      if (currentAgentKey && !handlerResult.currentAgentKey) {
        handlerResult.currentAgentKey = currentAgentKey;
      }
      return mergeAccumulatedToolCalls(handlerResult, ctx.accumulatedToolCalls);
    }
  }

  if (lastResponse) {
    const result = processResponse(lastResponse);
    result.currentAgentKey = currentAgentKey;
    result.agentName = currentAgentName;
    if (ctx.agentPath.length > 1) result.handoffPath = [...ctx.agentPath];
    result.maxTurnsExceeded = true;
    return mergeAccumulatedToolCalls(result, ctx.accumulatedToolCalls);
  }

  throw new MaxTurnsError(maxTurns, ctx.agentPath);
}

/**
 * Register function tools in the ToolResolver, skipping any already known.
 */
export function registerFunctionTools(
  functionTools: FunctionTool[] | undefined,
  toolResolver: ToolResolver,
): void {
  if (!functionTools) return;
  for (const ft of functionTools) {
    if (!toolResolver.isKnown(ft.name)) {
      toolResolver.register({
        serverId: 'function',
        serverUrl: '',
        originalName: ft.name,
        prefixedName: ft.name,
        description: ft.description,
        inputSchema: ft.parameters,
      });
    }
  }
}

function getAgent(
  agents: ReadonlyMap<string, ResolvedAgent>,
  key: string,
): ResolvedAgent {
  const agent = agents.get(key);
  if (!agent) {
    throw new AgentNotFoundError(key, [...agents.keys()]);
  }
  return agent;
}

function toTurnDeps(options: TurnProcessorOptions): TurnDeps {
  return {
    model: options.model,
    config: options.config,
    mcpServers: options.mcpServers,
    toolResolver: options.toolResolver,
    mcpToolManager: options.mcpToolManager,
    toolScopeProvider: options.toolScopeProvider,
    functionTools: options.functionTools,
    capabilities: options.capabilities,
    outputClassifier: options.outputClassifier,
    logger: options.logger,
    toolErrorFormatter: options.toolErrorFormatter,
  };
}
