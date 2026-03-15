/**
 * High-level events emitted by `runStream()`.
 *
 * These represent orchestration-level events (agent started, tool called, etc.)
 * as opposed to raw SSE events from the model.
 */
export type RunStreamEvent =
  | RunStreamAgentStart
  | RunStreamAgentEnd
  | RunStreamTextDelta
  | RunStreamTextDone
  | RunStreamToolCalled
  | RunStreamToolOutput
  | RunStreamHandoffOccurred
  | RunStreamReasoningDelta
  | RunStreamApprovalRequested
  | RunStreamError
  | RunStreamRawModelEvent;

export interface RunStreamAgentStart {
  type: 'agent_start';
  agentKey: string;
  agentName: string;
  turn: number;
}

export interface RunStreamAgentEnd {
  type: 'agent_end';
  agentKey: string;
  agentName: string;
  turn: number;
}

export interface RunStreamTextDelta {
  type: 'text_delta';
  delta: string;
  agentKey: string;
}

export interface RunStreamTextDone {
  type: 'text_done';
  text: string;
  agentKey: string;
}

export interface RunStreamToolCalled {
  type: 'tool_called';
  toolName: string;
  arguments: string;
  agentKey: string;
  callId: string;
}

export interface RunStreamToolOutput {
  type: 'tool_output';
  toolName: string;
  output: string;
  agentKey: string;
  callId: string;
}

export interface RunStreamHandoffOccurred {
  type: 'handoff_occurred';
  fromAgent: string;
  toAgent: string;
  reason?: string;
}

export interface RunStreamReasoningDelta {
  type: 'reasoning_delta';
  delta: string;
  agentKey: string;
}

export interface RunStreamApprovalRequested {
  type: 'approval_requested';
  toolName: string;
  arguments: string;
  serverLabel: string;
  approvalRequestId: string;
}

export interface RunStreamError {
  type: 'error';
  message: string;
  code?: string;
}

export interface RunStreamRawModelEvent {
  type: 'raw_model_event';
  data: string;
}
