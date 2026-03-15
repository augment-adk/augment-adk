import type { ILogger } from '../logger';
import type { ResponsesApiFunctionTool } from '../types/responsesApi';
import type { MCPServerConfig } from '../types/modelConfig';
import { prefixName, slimSchema } from './toolNameUtils';
import type { ToolResolver, ResolvedToolInfo } from './toolResolver';
import { toErrorMessage } from '../errors';

/**
 * Interface for MCP server connections.
 * Consumers provide their own implementation.
 */
export interface MCPConnection {
  listTools(): Promise<
    Array<{ name: string; description?: string; inputSchema?: unknown }>
  >;
  callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    isError?: boolean;
    content?: Array<{ type: string; text?: string }> | unknown;
  }>;
  close(): Promise<void>;
}

/**
 * Factory function for creating MCP connections from server configs.
 * Consumers inject this to avoid coupling the ADK to any specific MCP SDK.
 */
export type MCPConnectionFactory = (
  server: MCPServerConfig,
  options?: { skipTlsVerify?: boolean },
) => Promise<MCPConnection>;

const MAX_TOOL_OUTPUT_CHARS = 25_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/**
 * Discovers and executes MCP tools via backend proxy connections.
 *
 * When the model backend (LlamaStack) cannot reach MCP servers directly
 * (network isolation), this class converts MCP tools into function tools
 * and proxies execution.
 */
export class MCPToolManager {
  private readonly connections = new Map<string, MCPConnection>();
  private readonly logger: ILogger;
  private readonly connectFn: MCPConnectionFactory;
  private readonly maxOutputChars: number;
  private cachedTools: ResponsesApiFunctionTool[] | null = null;
  private cachedServerKey = '';
  private lastDiscoveryTime = 0;
  private inflightDiscovery: Promise<ResponsesApiFunctionTool[]> | null = null;
  private inflightServerKey = '';
  private readonly discoveryTtlMs: number;

  constructor(options: {
    connectionFactory: MCPConnectionFactory;
    logger: ILogger;
    maxOutputChars?: number;
    discoveryTtlMs?: number;
  }) {
    this.connectFn = options.connectionFactory;
    this.logger = options.logger;
    this.maxOutputChars = options.maxOutputChars ?? MAX_TOOL_OUTPUT_CHARS;
    this.discoveryTtlMs = options.discoveryTtlMs ?? 5 * 60 * 1000;
  }

  /**
   * Connect to all MCP servers, discover tools, and register them in the resolver.
   */
  async discoverTools(
    servers: MCPServerConfig[],
    resolver: ToolResolver,
  ): Promise<ResponsesApiFunctionTool[]> {
    resolver.clear();
    await this.closeAll();
    const tools: ResponsesApiFunctionTool[] = [];

    const results = await Promise.allSettled(
      servers.map(async server => {
        const conn = await this.connectFn(server);
        this.connections.set(server.id, conn);
        const serverTools = await conn.listTools();
        return { server, serverTools };
      }),
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error(`MCP server discovery failed: ${toErrorMessage(result.reason)}`);
        continue;
      }
      const { server, serverTools } = result.value;

      for (const t of serverTools) {
        const prefixed = prefixName(server.id, t.name);
        const schema = (t.inputSchema as Record<string, unknown>) || {
          type: 'object',
          properties: {},
        };

        const info: ResolvedToolInfo = {
          serverId: server.id,
          serverUrl: server.url,
          originalName: t.name,
          prefixedName: prefixed,
          description: t.description || `Tool ${t.name} from ${server.id}`,
          inputSchema: schema,
        };
        resolver.register(info);

        tools.push({
          type: 'function',
          name: prefixed,
          description: info.description,
          parameters: slimSchema(schema),
        });
      }

      this.logger.info(
        `Discovered ${serverTools.length} tools from ${server.id}`,
      );
    }

    return tools;
  }

  /**
   * Cached discovery — returns cached results if still valid.
   */
  async ensureDiscovered(
    servers: MCPServerConfig[],
    resolver: ToolResolver,
  ): Promise<ResponsesApiFunctionTool[]> {
    const key = servers.map(s => s.id).sort().join(',');
    if (this.cachedTools && this.cachedServerKey === key && this.isWithinTtl()) {
      return this.cachedTools;
    }
    if (this.inflightDiscovery && this.inflightServerKey === key) {
      return this.inflightDiscovery;
    }
    this.inflightServerKey = key;
    this.inflightDiscovery = this.discoverTools(servers, resolver)
      .then(tools => {
        this.cachedTools = tools;
        this.cachedServerKey = key;
        this.lastDiscoveryTime = Date.now();
        return tools;
      })
      .finally(() => {
        this.inflightDiscovery = null;
        this.inflightServerKey = '';
      });
    return this.inflightDiscovery;
  }

  /**
   * Execute a tool call on the appropriate MCP connection.
   */
  async executeTool(
    resolver: ToolResolver,
    functionName: string,
    argumentsJson: string,
  ): Promise<string> {
    const tool = resolver.resolve(functionName);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${functionName}` });
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argumentsJson);
    } catch {
      args = {};
    }

    const conn = this.connections.get(tool.serverId);
    if (!conn) {
      return JSON.stringify({
        error: `No connection to MCP server ${tool.serverId}`,
      });
    }

    try {
      const result = await conn.callTool(tool.originalName, args);

      if (result.isError) {
        const errorText = Array.isArray(result.content)
          ? result.content
              .filter((c): c is { type: string; text: string } => c.type === 'text' && !!c.text)
              .map(c => c.text)
              .join('\n')
          : JSON.stringify(result.content);
        return JSON.stringify({ error: errorText || 'Tool returned an error' });
      }

      let formatted: string;
      if (Array.isArray(result.content)) {
        const textParts = result.content
          .filter((c): c is { type: string; text: string } => c.type === 'text' && !!c.text)
          .map(c => c.text);
        formatted = textParts.length > 0 ? textParts.join('\n') : JSON.stringify(result.content);
      } else {
        formatted = JSON.stringify(result.content ?? result);
      }

      if (formatted.length > MAX_RESPONSE_BYTES) {
        return JSON.stringify({
          error: `Tool response too large (${Math.round(formatted.length / 1024)}KB)`,
        });
      }

      if (formatted.length > this.maxOutputChars) {
        return MCPToolManager.truncateOutput(formatted, this.maxOutputChars);
      }

      return formatted;
    } catch (error) {
      return JSON.stringify({ error: `Tool execution failed: ${toErrorMessage(error)}` });
    }
  }

  invalidateCache(): void {
    this.cachedTools = null;
    this.cachedServerKey = '';
    this.lastDiscoveryTime = 0;
    this.closeAll().catch(() => {});
  }

  static truncateOutput(output: string, maxChars: number): string {
    if (output.length <= maxChars) return output;
    const notice = `\n\n[... OUTPUT TRUNCATED: showing ${maxChars.toLocaleString()} of ${output.length.toLocaleString()} chars ...]`;
    const keepChars = maxChars - notice.length;
    if (keepChars <= 0) return output.slice(0, maxChars);
    const lastNewline = output.lastIndexOf('\n', keepChars);
    const cutPoint = lastNewline > keepChars * 0.5 ? lastNewline : keepChars;
    return output.slice(0, cutPoint) + notice;
  }

  private isWithinTtl(): boolean {
    return Date.now() - this.lastDiscoveryTime < this.discoveryTtlMs;
  }

  private async closeAll(): Promise<void> {
    const entries = Array.from(this.connections.entries());
    await Promise.allSettled(
      entries.map(async ([id, conn]) => {
        try {
          await conn.close();
        } catch (err) {
          this.logger.warn(`Error closing MCP connection ${id}: ${toErrorMessage(err)}`);
        }
      }),
    );
    this.connections.clear();
  }
}
