/**
 * Stream event mapper — converts ADK RunStreamEvents to frontend SSE events.
 *
 * The ADK emits `RunStreamEvent` objects during streaming. The frontend
 * reducer expects a different shape. This mapper bridges the two.
 *
 * Simplified from:
 * https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/
 *   workspaces/augment/plugins/augment-backend/src/providers/llamastack/
 *   adk-adapters/streamEventMapper.ts
 */
import type { RunStreamEvent } from '@augment-adk/augment-adk';

/**
 * Map an ADK RunStreamEvent to zero or more frontend SSE event strings.
 *
 * Returns JSON strings ready to be written as SSE `data:` payloads.
 */
export function mapAdkEventToFrontend(event: RunStreamEvent): string[] {
  switch (event.type) {
    case 'raw_model_event':
      return handleRawModelEvent(event);

    case 'text_delta':
      return [JSON.stringify({
        type: 'stream.text.delta',
        delta: event.delta,
      })];

    case 'tool_called':
      return [JSON.stringify({
        type: 'stream.tool.started',
        name: event.toolName,
        arguments: event.arguments,
      })];

    case 'tool_output':
      return [JSON.stringify({
        type: 'stream.tool.completed',
        name: event.toolName,
        output: event.output,
      })];

    case 'handoff_occurred':
      return [JSON.stringify({
        type: 'stream.handoff',
        from: event.fromAgent,
        to: event.toAgent,
      })];

    case 'approval_requested':
      return [JSON.stringify({
        type: 'stream.approval.requested',
        toolName: event.toolName,
        serverLabel: event.serverLabel,
        arguments: event.arguments,
        approvalRequestId: event.approvalRequestId,
      })];

    case 'agent_start':
      return [JSON.stringify({
        type: 'stream.agent.start',
        agentName: event.agentName,
        turn: event.turn,
      })];

    case 'agent_end':
      return [JSON.stringify({
        type: 'stream.agent.end',
        agentName: event.agentName,
      })];

    case 'error':
      return [JSON.stringify({
        type: 'stream.error',
        message: event.message,
      })];

    default:
      return [];
  }
}

function handleRawModelEvent(
  event: Extract<RunStreamEvent, { type: 'raw_model_event' }>,
): string[] {
  // Raw model events are LlamaStack SSE payloads. Forward them
  // to the frontend with a `stream.model.*` prefix so the frontend
  // reducer can handle them (e.g. for typing indicators, usage updates).
  const data = event.data;
  if (!data || typeof data !== 'object') return [];

  const eventType = (data as Record<string, unknown>).type as string | undefined;
  if (!eventType) return [];

  return [JSON.stringify({
    type: `stream.model.${eventType}`,
    data,
  })];
}
