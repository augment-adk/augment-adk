import type { ResponsesApiMcpTool } from '../types/responsesApi';

export interface HostedMcpToolOptions {
  serverLabel: string;
  serverUrl?: string;
  connectorId?: string;
  requireApproval?: 'never' | 'always' | { always?: string[]; never?: string[] };
  headers?: Record<string, string>;
  allowedTools?: string[];
}

/**
 * Create a hosted MCP tool definition for the Responses API.
 *
 * Supports both direct server URLs and LlamaStack connector IDs.
 * When `connectorId` is provided, the server routes through the
 * LlamaStack connectors subsystem instead of a direct URL.
 */
export function hostedMcpTool(options: HostedMcpToolOptions): ResponsesApiMcpTool {
  const tool: ResponsesApiMcpTool = {
    type: 'mcp',
    server_label: options.serverLabel,
    server_url: options.serverUrl ?? '',
    require_approval: options.requireApproval ?? 'never',
  };

  if (options.connectorId) {
    (tool as ResponsesApiMcpTool).connector_id = options.connectorId;
  }
  if (options.headers) {
    tool.headers = options.headers;
  }
  if (options.allowedTools) {
    tool.allowed_tools = options.allowedTools;
  }

  return tool;
}
