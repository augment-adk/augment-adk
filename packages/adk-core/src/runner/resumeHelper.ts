import type { ILogger } from '../logger';
import type { Model } from '../model';
import type { ResolvedAgent } from '../agent/agentGraph';
import type { EffectiveConfig, MCPServerConfig, CapabilityInfo } from '../types/modelConfig';
import type { FunctionCallOutputItem, ResponsesApiInputItem } from '../types/responsesApi';
import type { RunState } from './RunState';
import type { SubAgentContext } from './RunResult';
import type { RunContext, ToolApprovalDecision } from './RunContext';
import type { ToolCallInfo } from './steps';
import type { OutputClassifierInterface } from './outputClassifier';
import { DefaultOutputClassifier } from './outputClassifier';
import type { ToolResolver } from '../tools/toolResolver';
import type { MCPToolManager } from '../tools/mcpTool';
import type { ToolScopeProvider } from '../tools/toolScopeProvider';
import type { ToolSearchProvider } from '../tools/toolSearch';
import type { FunctionTool } from '../tools/tool';
import type { RetryPolicy } from './retryPolicy';
import { withRetry } from './retryPolicy';
import { buildAgentTools } from './turnExecution';
import { buildAgentEffectiveConfig } from './turnPreparation';
import { extractTextFromResponse } from './responseProcessor';
import { toErrorMessage } from '../errors';
import { executeToolCalls, type ToolExecutionDeps, type ToolCallRequest } from '../tools/toolExecution';

/**
 * Lifecycle callbacks emitted during resume-path tool execution.
 * Mirrors the relevant subset of TurnEmitter so the resume path
 * participates in the same event system as normal turns.
 */
export interface ResumeEmitter {
  toolCalled?(toolName: string, args: string, agentKey: string, callId: string): void;
  toolOutput?(toolName: string, output: string, agentKey: string, callId: string): void;
}

/**
 * Build function_call_output items for the resume turn after HITL interruption.
 *
 * Unlike the simple `buildApprovalOutputItems()` on RunContext, this function
 * actually executes approved tools and returns their real output. It handles
 * three categories of calls:
 *
 * 1. Auto-approved calls that were deferred because other calls needed approval
 * 2. User-approved calls (human said "yes") — executed and real output returned
 * 3. User-rejected calls (human said "no") — rejection message as output
 *
 * This ensures every function_call from the original response gets a
 * corresponding function_call_output, satisfying the Responses API contract.
 *
 * When `emitter` and `ctx` are provided, lifecycle events (`toolCalled`,
 * `toolOutput`) are fired and results are recorded in
 * `ctx.accumulatedToolCalls` — matching the behavior of the normal
 * (non-HITL) execution path in turnProcessor.
 */
export async function buildResumeToolOutputs(
  resumeState: RunState,
  decisions: ToolApprovalDecision[],
  deps: ToolExecutionDeps,
  emitter?: ResumeEmitter,
  ctx?: RunContext,
  agentKey?: string,
): Promise<FunctionCallOutputItem[]> {
  const pendingCallIds = new Set(resumeState.pendingToolCalls.map(c => c.callId));
  const unknownDecisions = decisions.filter(d => !pendingCallIds.has(d.callId));
  if (unknownDecisions.length > 0) {
    deps.logger.warn(
      `approvalDecisions contain ${unknownDecisions.length} callId(s) not found in pendingToolCalls: ` +
      `${unknownDecisions.map(d => d.callId).join(', ')}. These decisions will have no effect.`,
    );
  }

  const approvedDecisions = decisions.filter(d => d.approved);
  const rejectedDecisions = decisions.filter(d => !d.approved);

  const approvedCallIds = new Set(approvedDecisions.map(d => d.callId));

  const callsToExecute: ToolCallRequest[] = [
    ...(resumeState.autoApprovedToolCalls ?? []).map(c => ({
      callId: c.callId,
      name: c.name,
      arguments: c.arguments,
    })),
    ...resumeState.pendingToolCalls
      .filter(c => approvedCallIds.has(c.callId))
      .map(c => ({
        callId: c.callId,
        name: c.name,
        arguments: c.arguments,
      })),
  ];

  if (emitter?.toolCalled && agentKey) {
    for (const call of callsToExecute) {
      const info = deps.resolver.getServerInfo(call.name);
      emitter.toolCalled(info?.originalName ?? call.name, call.arguments, agentKey, call.callId);
    }
  }

  const executionResults = callsToExecute.length > 0
    ? await executeToolCalls(callsToExecute, deps)
    : [];

  if (ctx) {
    for (const r of executionResults) {
      const matchingCall = callsToExecute.find(c => c.callId === r.callId);
      const info: ToolCallInfo = {
        id: r.callId,
        name: r.name,
        serverLabel: r.serverLabel,
        arguments: matchingCall?.arguments,
        output: r.output,
        error: r.error,
      };
      ctx.accumulatedToolCalls.push(info);
      if (emitter?.toolOutput && agentKey) {
        emitter.toolOutput(r.name, r.output, agentKey, r.callId);
      }
    }
  }

  const executedOutputs: FunctionCallOutputItem[] = executionResults.map(r => ({
    type: 'function_call_output' as const,
    call_id: r.callId,
    output: r.output,
  }));

  const rejectionOutputs: FunctionCallOutputItem[] = rejectedDecisions.map(d => ({
    type: 'function_call_output' as const,
    call_id: d.callId,
    output: `Tool call rejected by human.${d.reason ? ` Reason: ${d.reason}` : ''}`,
  }));

  const decidedCallIds = new Set(decisions.map(d => d.callId));
  const undecidedOutputs: FunctionCallOutputItem[] = resumeState.pendingToolCalls
    .filter(c => !decidedCallIds.has(c.callId))
    .map(c => ({
      type: 'function_call_output' as const,
      call_id: c.callId,
      output: 'Tool call rejected — no approval decision was provided.',
    }));

  const allOutputs = [...executedOutputs, ...rejectionOutputs, ...undecidedOutputs];

  if (resumeState.subAgentContext) {
    const combinedText = allOutputs.map(o => o.output).join('\n');
    return [{
      type: 'function_call_output' as const,
      call_id: resumeState.subAgentContext.parentCallId,
      output: combinedText,
    }];
  }

  return allOutputs;
}

/**
 * Flatten a nested SubAgentContext chain into an array ordered
 * from outermost to innermost.
 */
export function flattenSubAgentChain(ctx: SubAgentContext): SubAgentContext[] {
  const chain: SubAgentContext[] = [];
  let current: SubAgentContext | undefined = ctx;
  while (current) {
    chain.push(current);
    current = current.inner;
  }
  return chain;
}

/**
 * Callback type for making a model call during sub-agent chain unwinding.
 * Accepts the input items and previousResponseId; returns the response text.
 */
export type SubAgentModelCall = (
  input: ResponsesApiInputItem[],
  agentKey: string,
  previousResponseId?: string,
) => Promise<string>;

/**
 * Unwind a sub-agent context chain for MCP resume.
 *
 * Sends the initial MCP approval responses to the innermost sub-agent,
 * then works outward — at each level, wrapping the previous level's text
 * as a function_call_output and calling that level's parent model.
 *
 * Returns a single function_call_output addressed to the outermost
 * parentCallId, ready to be sent to the top-level parent model.
 */
export async function unwindSubAgentMcpResume(
  chain: SubAgentContext[],
  mcpResponses: ResponsesApiInputItem[],
  callModel: SubAgentModelCall,
): Promise<FunctionCallOutputItem[]> {
  if (chain.length === 0) {
    throw new Error('unwindSubAgentMcpResume called with an empty sub-agent context chain');
  }
  const innermost = chain[chain.length - 1];

  let currentText = await callModel(
    mcpResponses,
    innermost.subAgentKey,
    innermost.subAgentResponseId,
  );

  // Unwind from second-innermost to outermost
  for (let i = chain.length - 2; i >= 0; i--) {
    const level = chain[i];
    const nextLevel = chain[i + 1];
    const wrappedInput: ResponsesApiInputItem[] = [{
      type: 'function_call_output' as const,
      call_id: nextLevel.parentCallId,
      output: currentText || 'Sub-agent completed.',
    }];
    currentText = await callModel(
      wrappedInput,
      level.subAgentKey,
      level.subAgentResponseId,
    );
  }

  return [{
    type: 'function_call_output' as const,
    call_id: chain[0].parentCallId,
    output: currentText || 'Sub-agent completed.',
  }];
}

/**
 * Dependencies for resolving resume input from an interrupted RunState.
 * Passed by both `runLoop` and `runLoopStream` so the shared logic
 * lives in one place.
 */
export interface ResumeInputDeps {
  ctx: RunContext;
  resumeState: RunState;
  agents: Map<string, ResolvedAgent>;
  currentAgent: ResolvedAgent;
  emitter: ResumeEmitter;
  logger: ILogger;
  model: Model;
  config: EffectiveConfig;
  mcpServers: MCPServerConfig[];
  toolResolver: ToolResolver;
  mcpToolManager?: MCPToolManager;
  toolScopeProvider?: ToolScopeProvider;
  functionTools?: FunctionTool[];
  capabilities: CapabilityInfo;
  outputClassifier?: OutputClassifierInterface;
  toolErrorFormatter?: (toolName: string, error: string) => string;
  retryPolicy?: RetryPolicy;
  toolSearchProvider?: ToolSearchProvider;
}

/**
 * Build the input items for resuming an interrupted run.
 *
 * Handles three resume paths:
 * 1. **MCP approval** — builds `mcp_approval_response` items, optionally
 *    unwinding through a sub-agent chain.
 * 2. **Client-side function tool approval** — executes approved tools via
 *    `buildResumeToolOutputs` and returns `function_call_output` items.
 * 3. **Empty interrupted state** — logs a warning and returns `null` so
 *    the caller falls through to the original user input.
 *
 * Returns `null` when no resume input could be produced (caller should
 * use the original user input).
 */
export async function resolveResumeInput(
  deps: ResumeInputDeps,
): Promise<ResponsesApiInputItem[] | null> {
  const {
    ctx, resumeState, agents, currentAgent, emitter, logger,
    model, config, mcpServers, toolResolver, mcpToolManager,
    toolScopeProvider, functionTools, capabilities, outputClassifier,
    toolErrorFormatter, retryPolicy, toolSearchProvider,
  } = deps;

  if (resumeState.pendingMcpApprovals?.length) {
    const mcpResponses = ctx.buildMcpApprovalResponses() as ResponsesApiInputItem[];
    if (mcpResponses.length === 0) {
      logger.warn(
        `Resuming with ${resumeState.pendingMcpApprovals.length} pending MCP approval(s) ` +
        'but no approvalDecisions were provided. The model will receive empty input. ' +
        'Unlike client-side function tools, MCP approvals are not auto-rejected — ' +
        'provide explicit approvalDecisions for each pendingMcpApproval.',
      );
    }
    const pendingMcpIds = new Set(resumeState.pendingMcpApprovals.map(a => a.approvalRequestId));
    const unknownMcpDecisions = ctx.toolApprovalDecisions.filter(d => !pendingMcpIds.has(d.callId));
    if (unknownMcpDecisions.length > 0) {
      logger.warn(
        `approvalDecisions contain ${unknownMcpDecisions.length} callId(s) not found in pendingMcpApprovals: ` +
        `${unknownMcpDecisions.map(d => d.callId).join(', ')}. These will be sent but may be rejected by the model.`,
      );
    }
    if (resumeState.subAgentContext) {
      const chain = flattenSubAgentChain(resumeState.subAgentContext);
      try {
        return await unwindSubAgentMcpResume(
          chain,
          mcpResponses,
          async (items, agentKey, prevResponseId) => {
            const agent = agents.get(agentKey);
            if (!agent) {
              logger.warn(`Sub-agent "${agentKey}" not found in agents map during MCP resume.`);
              return 'Sub-agent not found.';
            }
            const cfg = buildAgentEffectiveConfig(config, agent.config);
            const tools = await buildAgentTools(agent, {
              model,
              config,
              mcpServers,
              toolResolver,
              mcpToolManager,
              toolScopeProvider,
              functionTools,
              capabilities,
              outputClassifier: outputClassifier ?? new DefaultOutputClassifier(logger),
              logger,
              toolErrorFormatter,
            }, ctx);
            const rawCall = () => model.chatTurn(
              items,
              cfg.systemPrompt,
              tools,
              cfg,
              { previousResponseId: prevResponseId },
            );
            const resp = retryPolicy
              ? await withRetry(rawCall, retryPolicy, { agentKey, turn: 0 })
              : await rawCall();
            return extractTextFromResponse(resp);
          },
        ) as ResponsesApiInputItem[];
      } catch (err) {
        logger.error(`Sub-agent MCP resume failed: ${toErrorMessage(err)}`);
        return [{
          type: 'function_call_output' as const,
          call_id: chain[0].parentCallId,
          output: 'Sub-agent encountered an error during MCP approval resume.',
        }] as ResponsesApiInputItem[];
      }
    }
    return mcpResponses;
  }

  if (resumeState.pendingToolCalls.length > 0) {
    return await buildResumeToolOutputs(
      resumeState,
      ctx.toolApprovalDecisions,
      {
        resolver: toolResolver,
        mcpToolManager,
        functionTools,
        logger,
        toolErrorFormatter,
        toolGuardrails: currentAgent.config.toolGuardrails,
        toolSearchProvider,
      },
      emitter,
      ctx,
      currentAgent.key,
    ) as ResponsesApiInputItem[];
  }

  logger.warn(
    'resumeState.isInterrupted is true but neither pendingMcpApprovals nor pendingToolCalls contain entries. ' +
    'The run will proceed with the original user input, which may not be the intended behavior.',
  );
  return null;
}
