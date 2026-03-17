import type { ToolCallInfo } from './steps';
import type { RAGSource, ReasoningSummary, ApprovalInfo } from './responseProcessor';
import type { ResponseUsage } from '../types/responsesApi';

/**
 * The final result returned by `run()`.
 */
export interface RunResult {
  content: string;
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
