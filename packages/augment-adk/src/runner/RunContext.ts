import type { ToolCallInfo } from './steps';
import type { FunctionCallOutputItem, McpApprovalResponseItem } from '../types/responsesApi';

export interface ToolApprovalDecision {
  callId: string;
  approved: boolean;
  reason?: string;
}

/**
 * Mutable context passed through the run loop.
 *
 * Tracks accumulated state like tool calls, agent path,
 * and the current previousResponseId for conversation chaining.
 */
export class RunContext {
  readonly agentPath: string[] = [];
  readonly accumulatedToolCalls: ToolCallInfo[] = [];
  readonly agentVisitCounts = new Map<string, number>();
  readonly agentToolUsed = new Set<string>();
  readonly toolApprovalDecisions: ToolApprovalDecision[] = [];
  previousResponseId?: string;
  userQuery: string;
  conversationId?: string;

  constructor(options: {
    userQuery: string;
    previousResponseId?: string;
    conversationId?: string;
  }) {
    this.userQuery = options.userQuery;
    this.previousResponseId = options.previousResponseId;
    this.conversationId = options.conversationId;
  }

  /**
   * Record a visit to an agent and return the new visit count.
   */
  recordVisit(agentKey: string): number {
    const count = (this.agentVisitCounts.get(agentKey) ?? 0) + 1;
    this.agentVisitCounts.set(agentKey, count);
    return count;
  }

  markToolUsed(agentKey: string): void {
    this.agentToolUsed.add(agentKey);
  }

  hasUsedTools(agentKey: string): boolean {
    return this.agentToolUsed.has(agentKey);
  }

  /**
   * Approve a pending tool call. Records the decision for later retrieval.
   */
  approveTool(callId: string, reason?: string): void {
    this.toolApprovalDecisions.push({ callId, approved: true, reason });
  }

  /**
   * Reject a pending tool call. Records the decision for later retrieval.
   */
  rejectTool(callId: string, reason?: string): void {
    this.toolApprovalDecisions.push({ callId, approved: false, reason });
  }

  /**
   * Build function_call_output items from approval decisions
   * for sending back to the model.
   */
  buildApprovalOutputItems(): FunctionCallOutputItem[] {
    return this.toolApprovalDecisions
      .filter(d => d.approved)
      .map(d => ({
        type: 'function_call_output' as const,
        call_id: d.callId,
        output: d.reason ?? 'Approved by human.',
      }));
  }

  /**
   * Build MCP approval response items from approval decisions.
   */
  buildMcpApprovalResponses(): McpApprovalResponseItem[] {
    return this.toolApprovalDecisions.map(d => ({
      type: 'mcp_approval_response' as const,
      approval_request_id: d.callId,
      approve: d.approved,
      reason: d.reason,
    }));
  }
}
