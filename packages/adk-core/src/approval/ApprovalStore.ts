/**
 * A pending tool approval waiting for human decision.
 */
export interface PendingApproval {
  responseId: string;
  callId: string;
  functionName: string;
  argumentsJson: string;
  serverId: string;
  serverUrl: string;
  originalToolName: string;
  conversationId?: string;
  createdAt: number;
  agentKey?: string;
}

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_PENDING = 100;

/**
 * In-memory store for pending tool approvals.
 * Provides TTL-based expiry (30 min) and a cap on concurrent pending items (100).
 *
 * **Limitation:** This store is process-local. Pending approvals are lost on
 * process restart and are not shared across worker instances. For durable
 * HITL, use `createInterruptedStateFromResult()` to build a serializable
 * `RunState` and persist it externally.
 */
export class ApprovalStore {
  private readonly pending = new Map<string, PendingApproval>();

  private key(responseId: string, callId: string): string {
    return `${responseId}::${callId}`;
  }

  store(approval: PendingApproval): void {
    this.cleanup();
    if (this.pending.size >= MAX_PENDING) {
      const oldest = [...this.pending.entries()].sort(
        ([, a], [, b]) => a.createdAt - b.createdAt,
      )[0];
      if (oldest) this.pending.delete(oldest[0]);
    }
    this.pending.set(
      this.key(approval.responseId, approval.callId),
      approval,
    );
  }

  get(responseId: string, callId: string): PendingApproval | undefined {
    this.cleanup();
    return this.pending.get(this.key(responseId, callId));
  }

  remove(responseId: string, callId: string): void {
    this.pending.delete(this.key(responseId, callId));
  }

  get size(): number {
    return this.pending.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, approval] of this.pending) {
      if (now - approval.createdAt > TTL_MS) {
        this.pending.delete(key);
      }
    }
  }
}
