import type { AgentLifecycleEvent } from './types/lifecycle';
import type { ResponsesApiInputItem } from './types/responsesApi';

/**
 * Per-agent hooks for observing agent lifecycle events.
 */
export interface AgentHooks {
  onStart?: (agentKey: string, turn: number) => void | Promise<void>;
  onEnd?: (agentKey: string, turn: number, result: string) => void | Promise<void>;
  onHandoff?: (fromKey: string, toKey: string, reason?: string) => void | Promise<void>;
  onToolStart?: (agentKey: string, toolName: string, turn: number) => void | Promise<void>;
  onToolEnd?: (
    agentKey: string,
    toolName: string,
    turn: number,
    success: boolean,
  ) => void | Promise<void>;
}

/**
 * Run-level hooks for observing the overall orchestration.
 */
export interface RunHooks {
  onRunStart?: () => void | Promise<void>;
  onRunEnd?: (result: 'success' | 'error' | 'max_turns') => void | Promise<void>;
  onTurnStart?: (turn: number, agentKey: string) => void | Promise<void>;
  onTurnEnd?: (turn: number, agentKey: string) => void | Promise<void>;

  /**
   * Pre-model-call hook: inspect or modify the input before each chatTurn.
   * Return the (potentially modified) input.
   */
  inputFilter?: (
    input: string | ResponsesApiInputItem[],
    agentKey: string,
    turn: number,
  ) => string | ResponsesApiInputItem[];

  /**
   * Customizable formatter for tool execution errors.
   */
  toolErrorFormatter?: (toolName: string, error: string) => string;
}

/**
 * Dispatch a lifecycle event to the appropriate AgentHooks callback.
 */
export async function dispatchToHooks(
  event: AgentLifecycleEvent,
  hooks?: AgentHooks,
): Promise<void> {
  if (!hooks) return;

  switch (event.type) {
    case 'agent.start':
      await hooks.onStart?.(event.agentKey, event.turn);
      break;
    case 'agent.end':
      await hooks.onEnd?.(event.agentKey, event.turn, event.result);
      break;
    case 'agent.handoff':
      await hooks.onHandoff?.(event.fromKey, event.toKey, event.reason);
      break;
    case 'agent.tool_start':
      await hooks.onToolStart?.(event.agentKey, event.toolName, event.turn);
      break;
    case 'agent.tool_end':
      await hooks.onToolEnd?.(event.agentKey, event.toolName, event.turn, event.success);
      break;
  }
}
