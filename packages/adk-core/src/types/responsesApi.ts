// ============================================================================
// Responses API Output Types
// ============================================================================

export interface ResponsesApiFileSearchResult {
  type: 'file_search_call';
  id: string;
  status: string;
  queries: string[];
  results: Array<{
    file_id: string;
    filename: string;
    score: number;
    text: string;
    attributes: Record<string, unknown>;
  }>;
}

export interface ResponsesApiMcpCall {
  type: 'mcp_call';
  id: string;
  name: string;
  arguments: string;
  server_label: string;
  error?: string;
  output?: string;
}

export interface ResponsesApiAnnotation {
  type: 'file_citation' | 'url_citation' | 'file_path' | 'container_file_citation';
  start_index?: number;
  end_index?: number;
  file_citation?: { file_id: string; filename?: string; quote?: string };
  url_citation?: { url: string; title?: string };
  file_path?: { file_id: string };
  container_file_citation?: { file_id: string; container_id: string };
  [key: string]: unknown;
}

export interface ResponsesApiMessage {
  type: 'message';
  id: string;
  role: 'assistant';
  status: 'completed' | 'failed' | 'in_progress';
  content: Array<{
    type: 'output_text';
    text: string;
    annotations?: ResponsesApiAnnotation[];
  }>;
}

export interface ResponsesApiFunctionCall {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: 'completed' | 'failed' | 'in_progress';
}

export interface ResponsesApiFunctionCallOutput {
  type: 'function_call_output';
  id?: string;
  call_id: string;
  output: string;
  status?: string;
}

export interface ResponsesApiReasoningItem {
  type: 'reasoning';
  id: string;
  summary?: Array<{ type: 'summary_text'; text: string }>;
  encrypted_content?: string;
  status?: 'completed' | 'in_progress';
}

export interface ResponsesApiWebSearchCall {
  type: 'web_search_call';
  id: string;
  status: 'completed' | 'searching' | 'failed' | 'in_progress';
}

export interface ResponsesApiMcpApprovalRequest {
  type: 'mcp_approval_request';
  id: string;
  server_label: string;
  name: string;
  arguments?: string;
}

export interface ResponsesApiMcpListTools {
  type: 'mcp_list_tools';
  id: string;
  server_label: string;
  tools: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>;
}

export type ResponsesApiOutputEvent =
  | ResponsesApiFileSearchResult
  | ResponsesApiMcpCall
  | ResponsesApiMcpApprovalRequest
  | ResponsesApiMcpListTools
  | ResponsesApiMessage
  | ResponsesApiFunctionCall
  | ResponsesApiWebSearchCall
  | ResponsesApiReasoningItem;

// ============================================================================
// Responses API Input Types
// ============================================================================

export interface ResponseInputContent {
  type: 'input_text' | 'input_image' | 'input_file';
  text?: string;
  [key: string]: unknown;
}

export interface FunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

export interface MessageInputItem {
  type: 'message';
  role: 'user' | 'system' | 'developer' | 'assistant';
  content: string | ResponseInputContent[];
}

export interface ItemReferenceInputItem {
  type: 'item_reference';
  id: string;
}

export interface McpApprovalResponseItem {
  type: 'mcp_approval_response';
  approval_request_id: string;
  approve: boolean;
  reason?: string;
}

export type ResponsesApiInputItem =
  | FunctionCallOutputItem
  | MessageInputItem
  | ItemReferenceInputItem
  | McpApprovalResponseItem;

// ============================================================================
// Responses API Tool Definitions
// ============================================================================

export interface ResponsesApiFileSearchTool {
  type: 'file_search';
  vector_store_ids: string[];
  max_num_results?: number;
  ranking_options?: { ranker?: string; score_threshold?: number };
}

export interface ResponsesApiMcpTool {
  type: 'mcp';
  server_url?: string;
  server_label: string;
  require_approval: 'never' | 'always' | { always?: string[]; never?: string[] };
  headers?: Record<string, string>;
  authorization?: string;
  allowed_tools?: string[];
  /** LlamaStack connector ID for server-side MCP routing. */
  connector_id?: string;
}

export interface ResponsesApiFunctionTool {
  type: 'function';
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponsesApiWebSearchTool {
  type: 'web_search';
  user_location?: {
    type: 'approximate';
    city?: string;
    region?: string;
    country?: string;
    timezone?: string;
  };
  search_context_size?: 'low' | 'medium' | 'high';
}

export interface ResponsesApiCodeInterpreterTool {
  type: 'code_interpreter';
  container?: { type: 'auto'; file_ids?: string[] };
}

export type ResponsesApiTool =
  | ResponsesApiFileSearchTool
  | ResponsesApiMcpTool
  | ResponsesApiFunctionTool
  | ResponsesApiWebSearchTool
  | ResponsesApiCodeInterpreterTool;

// ============================================================================
// Responses API Response Envelope
// ============================================================================

export interface ResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: Record<string, unknown>;
  output_tokens_details?: Record<string, unknown>;
}

export interface ResponsesApiResponse {
  id: string;
  output: ResponsesApiOutputEvent[];
  usage?: ResponseUsage;
  model?: string;
  created_at?: number;
  error?: { message?: string; code?: string };
  status?: string;
  status_reason?: string;
}
