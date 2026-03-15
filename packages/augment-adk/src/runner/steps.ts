import type { ResponsesApiResponse, ResponsesApiInputItem } from '../types/responsesApi';

/**
 * Classification of a model's output that determines the next orchestration step.
 */
export type OutputClassification =
  | { type: 'handoff'; targetKey: string; callId: string; metadata?: string }
  | { type: 'agent_tool'; targetKey: string; callId: string; arguments: string }
  | { type: 'backend_tool'; calls: Array<{ callId: string; name: string; arguments: string }> }
  | { type: 'final_output' }
  | { type: 'continue' };

/**
 * The result of a single turn in the run loop.
 */
export interface SingleStepResult {
  nextStep: NextStep;
  response?: ResponsesApiResponse;
  input?: string | ResponsesApiInputItem[];
}

/**
 * The next action the run loop should take after processing a turn.
 */
export type NextStep =
  | { type: 'next_step_handoff'; targetKey: string; callId: string; metadata?: string }
  | { type: 'next_step_tool_execution'; calls: Array<{ callId: string; name: string; arguments: string }> }
  | { type: 'next_step_agent_tool'; targetKey: string; callId: string; arguments: string }
  | { type: 'next_step_final_output'; response: ResponsesApiResponse }
  | { type: 'next_step_continue'; callId: string }
  | { type: 'next_step_approval'; calls: Array<{ callId: string; name: string; arguments: string }> }
  | { type: 'next_step_run_again' };

/**
 * Tool call info collected during execution for the final response.
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  serverLabel?: string;
  arguments?: string;
  output?: string;
  error?: string;
}
