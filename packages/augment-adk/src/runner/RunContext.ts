import type { ToolCallInfo } from './steps';

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
}
