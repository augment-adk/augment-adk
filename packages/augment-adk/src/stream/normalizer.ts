import type { NormalizedStreamEvent } from './events';
import { LS_EVENT } from './constants';
import {
  handleResponseCreated,
  handleResponseCompleted,
  handleOutputItemAdded,
  handleOutputItemDone,
  handleContentPartDone,
  handleArgumentsDelta,
  handleMcpCallCompleted,
  handleMcpCallFailed,
  handleMcpCallRequiresApproval,
  extractResponseFailedError,
} from './handlers';

/**
 * Normalize a single raw LlamaStack SSE event JSON string into zero or
 * more NormalizedStreamEvents.
 *
 * Returns an array because some raw events map to multiple normalized
 * events (e.g., output_item.done for file_search produces both
 * stream.rag.results and stream.tool.completed).
 *
 * This is a pure function with no side effects.
 */
export function normalizeLlamaStackEvent(
  rawJson: string,
  onUnknownEvent?: (type: string) => void,
): NormalizedStreamEvent[] {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawJson);
  } catch {
    return [];
  }

  const type = event.type as string | undefined;

  if (!type) {
    if (event.error) {
      const errorMessage =
        typeof event.error === 'string'
          ? event.error
          : (event.error as Record<string, unknown>).message || 'Unknown server error';
      return [{ type: 'stream.error', error: errorMessage as string }];
    }
    return [];
  }

  switch (type) {
    case LS_EVENT.RESPONSE_CREATED:
      return [handleResponseCreated(event)];

    case LS_EVENT.RESPONSE_IN_PROGRESS:
      return [];

    case LS_EVENT.RESPONSE_COMPLETED:
      return [handleResponseCompleted(event)];

    case LS_EVENT.RESPONSE_FAILED:
      return [{ type: 'stream.error', error: extractResponseFailedError(event) }];

    case LS_EVENT.ERROR:
      return [{
        type: 'stream.error',
        error:
          (event.message as string) ||
          (typeof event.error === 'string' ? event.error : '') ||
          'Unknown error',
      }];

    case LS_EVENT.MCP_LIST_TOOLS_IN_PROGRESS:
      return [{
        type: 'stream.tool.discovery',
        serverLabel: event.server_label as string | undefined,
        status: 'in_progress',
      }];

    case LS_EVENT.MCP_LIST_TOOLS_COMPLETED:
      return [{
        type: 'stream.tool.discovery',
        serverLabel: event.server_label as string | undefined,
        status: 'completed',
        toolCount: event.tool_count as number | undefined,
      }];

    case LS_EVENT.OUTPUT_ITEM_ADDED:
      return handleOutputItemAdded(event);

    case LS_EVENT.OUTPUT_ITEM_DONE:
      return handleOutputItemDone(event);

    case LS_EVENT.FUNCTION_CALL_ARGUMENTS_DELTA:
    case LS_EVENT.MCP_CALL_ARGUMENTS_DELTA:
    case LS_EVENT.MCP_CALL_ARGUMENTS_DELTA_LEGACY:
      return handleArgumentsDelta(event);

    case LS_EVENT.FUNCTION_CALL_ARGUMENTS_DONE:
    case LS_EVENT.MCP_CALL_ARGUMENTS_DONE:
    case LS_EVENT.MCP_CALL_IN_PROGRESS:
      return [];

    case LS_EVENT.MCP_CALL_COMPLETED:
      return handleMcpCallCompleted(event);

    case LS_EVENT.MCP_CALL_FAILED:
      return handleMcpCallFailed(event);

    case LS_EVENT.MCP_CALL_REQUIRES_APPROVAL:
      return handleMcpCallRequiresApproval(event);

    case LS_EVENT.CONTENT_PART_ADDED:
      return [];

    case LS_EVENT.CONTENT_PART_DONE:
      return handleContentPartDone(event);

    case LS_EVENT.OUTPUT_TEXT_DELTA:
      return event.delta
        ? [{ type: 'stream.text.delta', delta: event.delta as string }]
        : [];

    case LS_EVENT.OUTPUT_TEXT_DONE:
      return [{
        type: 'stream.text.done',
        text: (event.text as string) || '',
      }];

    case LS_EVENT.REASONING_TEXT_DELTA:
    case LS_EVENT.REASONING_SUMMARY_TEXT_DELTA:
      return event.delta
        ? [{ type: 'stream.reasoning.delta', delta: event.delta as string }]
        : [];

    case LS_EVENT.REASONING_TEXT_DONE:
    case LS_EVENT.REASONING_SUMMARY_TEXT_DONE:
      return [{ type: 'stream.reasoning.done', text: (event.text as string) || '' }];

    case LS_EVENT.REASONING_SUMMARY_PART_ADDED:
    case LS_EVENT.REASONING_SUMMARY_PART_DONE:
      return [];

    default:
      onUnknownEvent?.(type);
      return [];
  }
}
