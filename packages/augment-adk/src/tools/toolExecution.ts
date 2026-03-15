import type { ILogger } from '../logger';
import type { FunctionTool } from './tool';
import type { ToolResolver } from './toolResolver';
import type { MCPToolManager } from './mcpTool';
import { toErrorMessage } from '../errors';

export interface ToolCallRequest {
  callId: string;
  name: string;
  arguments: string;
}

export interface ToolCallResult {
  callId: string;
  name: string;
  output: string;
  error?: string;
  serverLabel?: string;
}

export interface ToolExecutionDeps {
  resolver: ToolResolver;
  mcpToolManager?: MCPToolManager;
  functionTools?: FunctionTool[];
  logger: ILogger;
  toolErrorFormatter?: (toolName: string, error: string) => string;
}

/**
 * Execute a batch of tool calls, dispatching to either local function
 * tools or MCP backend tools via the resolver.
 */
export async function executeToolCalls(
  calls: ToolCallRequest[],
  deps: ToolExecutionDeps,
): Promise<ToolCallResult[]> {
  const { resolver, mcpToolManager, functionTools, logger, toolErrorFormatter } = deps;

  const localToolMap = new Map<string, FunctionTool>();
  if (functionTools) {
    for (const ft of functionTools) {
      localToolMap.set(ft.name, ft);
    }
  }

  return Promise.all(
    calls.map(async call => {
      const info = resolver.getServerInfo(call.name);
      const displayName = info?.originalName ?? call.name;
      const serverLabel = info?.serverId ?? 'function';

      const localTool = localToolMap.get(call.name);
      if (localTool) {
        return executeLocalTool(localTool, call, logger, toolErrorFormatter);
      }

      if (mcpToolManager && resolver.isKnown(call.name)) {
        try {
          const output = await mcpToolManager.executeTool(
            resolver,
            call.name,
            call.arguments,
          );
          return {
            callId: call.callId,
            name: displayName,
            output,
            serverLabel,
          };
        } catch (err) {
          const errMsg = toErrorMessage(err);
          return {
            callId: call.callId,
            name: displayName,
            output: formatToolError(displayName, errMsg, toolErrorFormatter),
            error: errMsg,
            serverLabel,
          };
        }
      }

      return {
        callId: call.callId,
        name: displayName,
        output: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
        error: `Unknown tool: ${call.name}`,
        serverLabel,
      };
    }),
  );
}

async function executeLocalTool(
  tool: FunctionTool,
  call: ToolCallRequest,
  logger: ILogger,
  errorFormatter?: (toolName: string, error: string) => string,
): Promise<ToolCallResult> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    args = {};
  }

  try {
    const output = await tool.execute(args);
    return {
      callId: call.callId,
      name: tool.name,
      output,
      serverLabel: 'function',
    };
  } catch (err) {
    const errMsg = toErrorMessage(err);
    logger.error(`Tool "${tool.name}" execution failed: ${errMsg}`);
    return {
      callId: call.callId,
      name: tool.name,
      output: formatToolError(tool.name, errMsg, errorFormatter),
      error: errMsg,
      serverLabel: 'function',
    };
  }
}

function formatToolError(
  toolName: string,
  error: string,
  formatter?: (toolName: string, error: string) => string,
): string {
  if (formatter) return formatter(toolName, error);
  return JSON.stringify({ error });
}
