/**
 * Structured lifecycle event emitted by the runner during multi-agent orchestration.
 * Follows the OpenAI Agents SDK `RunHooks` pattern for observability.
 */
export type AgentLifecycleEvent =
  | { type: 'agent.start'; agentKey: string; agentName: string; turn: number }
  | { type: 'agent.end'; agentKey: string; agentName: string; turn: number; result: string }
  | {
      type: 'agent.handoff';
      fromAgent: string;
      toAgent: string;
      fromKey: string;
      toKey: string;
      reason?: string;
    }
  | { type: 'agent.tool_start'; agentKey: string; toolName: string; turn: number }
  | { type: 'agent.tool_end'; agentKey: string; toolName: string; turn: number; success: boolean };

/**
 * Callback for receiving lifecycle events from the runner.
 */
export type LifecycleEventCallback = (event: AgentLifecycleEvent) => void;
