import type { ResponsesApiInputItem } from '../types/responsesApi';
import type { RunResult, SubAgentContext } from './RunResult';

/**
 * Serializable run state that enables resumption after HITL interruption.
 *
 * When the runner encounters a tool call requiring human approval,
 * it returns a RunState that can be passed back to `run()` / `runStream()`
 * to continue execution after the approval decision.
 */
export interface RunState {
  currentAgentKey: string;
  turn: number;
  previousResponseId?: string;
  conversationId?: string;
  agentPath: string[];
  pendingToolCalls: Array<{
    callId: string;
    name: string;
    arguments: string;
    serverId: string;
    serverUrl: string;
    originalToolName: string;
  }>;
  /** Auto-approved calls deferred because other calls in the same response needed approval. */
  autoApprovedToolCalls?: Array<{
    callId: string;
    name: string;
    arguments: string;
  }>;
  lastInput?: string | ResponsesApiInputItem[];
  isInterrupted: boolean;
  /** Pending MCP approval requests from the server. */
  pendingMcpApprovals?: Array<{
    approvalRequestId: string;
    serverLabel: string;
    name: string;
    arguments?: string;
  }>;
  /**
   * When pending approvals originated from a sub-agent, this stores the
   * context needed to correctly route tool outputs on resume.
   * For multi-level nesting, the `inner` field chains deeper contexts.
   */
  subAgentContext?: SubAgentContext;
}

/**
 * Serialize a RunState to a JSON string for persistence.
 */
export function serializeRunState(state: RunState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize a RunState from a JSON string.
 * Validates that required fields are present and correctly typed.
 *
 * @throws {Error} if the JSON is malformed or missing required fields
 */
export function deserializeRunState(json: string): RunState {
  const parsed = JSON.parse(json);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Invalid RunState: expected a JSON object');
  }
  if (typeof parsed.currentAgentKey !== 'string') {
    throw new Error('Invalid RunState: missing or invalid "currentAgentKey" (expected string)');
  }
  if (typeof parsed.isInterrupted !== 'boolean') {
    throw new Error('Invalid RunState: missing or invalid "isInterrupted" (expected boolean)');
  }
  if (!Array.isArray(parsed.pendingToolCalls)) {
    throw new Error('Invalid RunState: missing or invalid "pendingToolCalls" (expected array)');
  }
  if (!Array.isArray(parsed.agentPath)) {
    throw new Error('Invalid RunState: missing or invalid "agentPath" (expected array)');
  }

  return parsed as RunState;
}

/**
 * Create an initial RunState for a new run.
 */
export function createInitialState(
  defaultAgentKey: string,
  conversationId?: string,
  previousResponseId?: string,
): RunState {
  return {
    currentAgentKey: defaultAgentKey,
    turn: 0,
    previousResponseId,
    conversationId,
    agentPath: [],
    pendingToolCalls: [],
    isInterrupted: false,
  };
}

/**
 * Build a RunState from a completed RunResult so the next `run()` starts
 * from the same agent that produced this result. This enables multi-turn
 * agent continuity across separate `run()` calls.
 *
 * @example
 * ```typescript
 * let activeState: RunState | undefined;
 * // Each user turn:
 * const result = await run(userMessage, {
 *   ...opts,
 *   resumeState: activeState,
 * });
 * activeState = createContinuationState(result);
 * ```
 */
export function createContinuationState(
  result: RunResult,
  conversationId?: string,
): RunState {
  return {
    currentAgentKey: result.currentAgentKey ?? '',
    turn: 0,
    previousResponseId: result.responseId,
    conversationId,
    agentPath: result.handoffPath ?? (result.currentAgentKey ? [result.currentAgentKey] : []),
    pendingToolCalls: [],
    isInterrupted: false,
  };
}

/**
 * Create an interrupted RunState with explicit pending calls.
 * Prefer `createInterruptedStateFromResult()` which extracts pending
 * approvals automatically from a `RunResult`.
 */
export function createInterruptedState(
  agentKey: string,
  turn: number,
  pendingCalls: RunState['pendingToolCalls'],
  previousResponseId?: string,
  conversationId?: string,
  agentPath?: string[],
): RunState {
  return {
    currentAgentKey: agentKey,
    turn,
    previousResponseId,
    conversationId,
    agentPath: agentPath ?? [],
    pendingToolCalls: pendingCalls,
    isInterrupted: true,
  };
}

/**
 * Build an interrupted RunState from a RunResult that contains
 * pending approvals. This is the recommended way to construct
 * the `resumeState` you pass back to `run()` / `runStream()`
 * after the human has made approval decisions.
 *
 * Automatically distinguishes between client-side approval
 * (`pendingApprovals` plural) and server-side MCP approval
 * (`pendingApproval` singular only) and populates the correct
 * RunState fields.
 *
 * @example
 * ```typescript
 * const result = await run(userMessage, opts);
 * if (result.pendingApproval || result.pendingApprovals?.length) {
 *   const state = createInterruptedStateFromResult(result);
 *   // ... present to user for approval/rejection ...
 *   const resumed = await run(userMessage, {
 *     ...opts,
 *     resumeState: state,
 *     approvalDecisions: [{ callId: '...', approved: true }],
 *   });
 * }
 * ```
 */
export function createInterruptedStateFromResult(
  result: RunResult,
  conversationId?: string,
): RunState {
  const approvals = result.pendingApprovals ?? (result.pendingApproval ? [result.pendingApproval] : []);
  // Client-side (function tool) approval sets pendingApprovals (plural);
  // server MCP approval only sets pendingApproval (singular).
  // These paths are mutually exclusive in turnProcessor.
  const isClientSide = (result.pendingApprovals?.length ?? 0) > 0;

  const state: RunState = {
    currentAgentKey: result.currentAgentKey ?? '',
    turn: 0,
    previousResponseId: result.responseId,
    conversationId,
    agentPath: result.handoffPath ?? (result.currentAgentKey ? [result.currentAgentKey] : []),
    pendingToolCalls: [],
    isInterrupted: true,
  };

  if (isClientSide) {
    state.pendingToolCalls = approvals.map(a => ({
      callId: a.approvalRequestId,
      name: a.toolName,
      arguments: a.arguments ?? '{}',
      serverId: a.serverLabel ?? '',
      serverUrl: '',
      originalToolName: a.toolName,
    }));
    if (result.autoApprovedCalls?.length) {
      state.autoApprovedToolCalls = result.autoApprovedCalls.map(c => ({
        callId: c.callId,
        name: c.name,
        arguments: c.arguments,
      }));
    }
  } else if (approvals.length > 0) {
    state.pendingMcpApprovals = approvals.map(a => ({
      approvalRequestId: a.approvalRequestId,
      serverLabel: a.serverLabel ?? '',
      name: a.toolName,
      arguments: a.arguments ?? '{}',
    }));
  }

  if (result.subAgentContext) {
    state.subAgentContext = JSON.parse(JSON.stringify(result.subAgentContext));
  }

  return state;
}
