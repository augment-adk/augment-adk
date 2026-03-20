import type { ResponsesApiInputItem } from '../types/responsesApi';

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
  lastInput?: string | ResponsesApiInputItem[];
  isInterrupted: boolean;
  /** Pending MCP approval requests from the server. */
  pendingMcpApprovals?: Array<{
    approvalRequestId: string;
    serverLabel: string;
    name: string;
    arguments?: string;
  }>;
}

/**
 * Serialize a RunState to a JSON string for persistence.
 */
export function serializeRunState(state: RunState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize a RunState from a JSON string.
 */
export function deserializeRunState(json: string): RunState {
  return JSON.parse(json) as RunState;
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
 * Create an interrupted RunState with pending approvals.
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
