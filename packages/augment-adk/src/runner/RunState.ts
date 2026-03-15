import type { ResponsesApiResponse, ResponsesApiInputItem } from '../types/responsesApi';
import type { ResolvedAgent } from '../agentGraph';

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
