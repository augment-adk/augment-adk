/**
 * Responses API SSE event type constants.
 *
 * These are standard event types defined by the OpenAI Responses API
 * specification, used by both OpenAI and LlamaStack servers.
 *
 * @deprecated Use RESPONSES_EVENT instead. LS_EVENT is kept for backward compatibility.
 */
export const LS_EVENT = {
  RESPONSE_CREATED: 'response.created',
  RESPONSE_IN_PROGRESS: 'response.in_progress',
  RESPONSE_COMPLETED: 'response.completed',
  RESPONSE_FAILED: 'response.failed',
  ERROR: 'error',

  MCP_LIST_TOOLS_IN_PROGRESS: 'response.mcp_list_tools.in_progress',
  MCP_LIST_TOOLS_COMPLETED: 'response.mcp_list_tools.completed',

  OUTPUT_ITEM_ADDED: 'response.output_item.added',
  OUTPUT_ITEM_DONE: 'response.output_item.done',

  FUNCTION_CALL_ARGUMENTS_DELTA: 'response.function_call_arguments.delta',
  FUNCTION_CALL_ARGUMENTS_DONE: 'response.function_call_arguments.done',

  MCP_CALL_IN_PROGRESS: 'response.mcp_call.in_progress',
  MCP_CALL_COMPLETED: 'response.mcp_call.completed',
  MCP_CALL_FAILED: 'response.mcp_call.failed',
  MCP_CALL_REQUIRES_APPROVAL: 'response.mcp_call.requires_approval',
  MCP_CALL_ARGUMENTS_DELTA: 'response.mcp_call.arguments.delta',
  MCP_CALL_ARGUMENTS_DONE: 'response.mcp_call.arguments.done',
  MCP_CALL_ARGUMENTS_DELTA_LEGACY: 'response.mcp_call_arguments.delta',

  CONTENT_PART_ADDED: 'response.content_part.added',
  CONTENT_PART_DONE: 'response.content_part.done',
  OUTPUT_TEXT_DELTA: 'response.output_text.delta',
  OUTPUT_TEXT_DONE: 'response.output_text.done',

  REASONING_TEXT_DELTA: 'response.reasoning_text.delta',
  REASONING_TEXT_DONE: 'response.reasoning_text.done',

  REASONING_SUMMARY_PART_ADDED: 'response.reasoning_summary_part.added',
  REASONING_SUMMARY_PART_DONE: 'response.reasoning_summary_part.done',
  REASONING_SUMMARY_TEXT_DELTA: 'response.reasoning_summary_text.delta',
  REASONING_SUMMARY_TEXT_DONE: 'response.reasoning_summary_text.done',
} as const;

/** Alias for backward compatibility. */
export const RESPONSES_EVENT = LS_EVENT;

/**
 * Responses API output item type constants.
 */
export const LS_ITEM_TYPE = {
  FUNCTION_CALL: 'function_call',
  FUNCTION_CALL_OUTPUT: 'function_call_output',
  MCP_CALL: 'mcp_call',
  MCP_APPROVAL_REQUEST: 'mcp_approval_request',
  FILE_SEARCH_CALL: 'file_search_call',
  MESSAGE: 'message',
  MCP_LIST_TOOLS: 'mcp_list_tools',
} as const;

/**
 * Event types safe to forward immediately during streaming.
 * Events not in this set are buffered for handoff/tool detection.
 */
export const IMMEDIATE_FORWARD_TYPES = new Set([
  LS_EVENT.RESPONSE_CREATED,
  LS_EVENT.REASONING_TEXT_DELTA,
  LS_EVENT.REASONING_TEXT_DONE,
  LS_EVENT.REASONING_SUMMARY_TEXT_DELTA,
  LS_EVENT.REASONING_SUMMARY_TEXT_DONE,
  LS_EVENT.REASONING_SUMMARY_PART_ADDED,
  LS_EVENT.REASONING_SUMMARY_PART_DONE,
  LS_EVENT.OUTPUT_TEXT_DELTA,
  LS_EVENT.OUTPUT_TEXT_DONE,
]);
