import type { ToolCallInfo } from './steps';
import type { RAGSource, ReasoningSummary, ApprovalInfo } from './responseProcessor';
import type { ResponseUsage } from '../types/responsesApi';

/**
 * Context linking a pending approval back to the sub-agent call chain.
 * For multi-level nesting (router → A → B), `inner` chains deeper contexts
 * so resume can unwind through each level.
 */
export interface SubAgentContext {
  /** The call_id from the parent model's `function_call` that invoked this sub-agent. */
  parentCallId: string;
  /** Agent graph key of this sub-agent. */
  subAgentKey: string;
  /** Model response ID from this sub-agent's conversation, used as `previousResponseId` on resume. */
  subAgentResponseId?: string;
  /**
   * Nested context when this sub-agent itself delegated to a deeper sub-agent.
   * Forms a chain from outermost (root) to innermost (where the approval originated).
   * On resume, the chain is unwound: the innermost sub-agent receives the approval
   * response first, then each level wraps the result for its parent.
   */
  inner?: SubAgentContext;
}

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
  /** Auto-approved calls deferred because other calls in the same response needed approval. */
  autoApprovedCalls?: Array<{ callId: string; name: string; arguments: string }>;
  /**
   * Context for sub-agent HITL: the pending approvals originated from a sub-agent,
   * not the current (parent) agent. On resume, tool outputs must be wrapped in a
   * single function_call_output addressed to the parent's call_id.
   * For multi-level nesting (A → B → C), the `inner` field chains contexts.
   */
  subAgentContext?: SubAgentContext;
  outputValidationError?: string;
  maxTurnsExceeded?: boolean;
}
