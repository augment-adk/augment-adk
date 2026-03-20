import type { ToolCallInfo } from './steps';
import type { RAGSource, ReasoningSummary, ApprovalInfo } from './responseProcessor';
import type { ResponseUsage } from '../types/responsesApi';

/**
 * The final result returned by `run()`.
 */
export interface RunResult {
  content: string;
  /** Graph key of the agent that produced this result. Use this to start the next `run()` from the same agent. */
  currentAgentKey?: string;
  agentName?: string;
  handoffPath?: string[];
  ragSources?: RAGSource[];
  toolCalls?: ToolCallInfo[];
  responseId?: string;
  usage?: ResponseUsage;
  reasoning?: ReasoningSummary[];
  pendingApproval?: ApprovalInfo;
  pendingApprovals?: ApprovalInfo[];
  outputValidationError?: string;
  maxTurnsExceeded?: boolean;
}
