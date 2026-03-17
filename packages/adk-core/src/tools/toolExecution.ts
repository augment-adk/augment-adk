import type { ILogger } from '../logger';
import type { ToolGuardrailRule } from '../types/agentConfig';
import type { FunctionTool } from './tool';
import type { ToolResolver } from './toolResolver';
import type { MCPToolManager } from './mcpTool';
import type { ToolSearchProvider } from './toolSearch';
import { evaluateInputGuardrail } from '../guardrails/inputGuardrail';
import { evaluateOutputGuardrail } from '../guardrails/outputGuardrail';
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
  guardrailBlocked?: boolean;
}

export interface ToolExecutionDeps {
  resolver: ToolResolver;
  mcpToolManager?: MCPToolManager;
  functionTools?: FunctionTool[];
  logger: ILogger;
  toolErrorFormatter?: (toolName: string, error: string) => string;
  toolGuardrails?: ToolGuardrailRule[];
  toolSearchProvider?: ToolSearchProvider;
}

/**
 * Execute a batch of tool calls, dispatching to either local function
 * tools or MCP backend tools via the resolver.
 */
export async function executeToolCalls(
  calls: ToolCallRequest[],
  deps: ToolExecutionDeps,
): Promise<ToolCallResult[]> {
  const { resolver, mcpToolManager, functionTools, logger, toolErrorFormatter, toolGuardrails } = deps;

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

      if (toolGuardrails && toolGuardrails.length > 0) {
        const inputCheck = evaluateInputGuardrail(displayName, call.arguments, toolGuardrails);
        if (!inputCheck.allowed) {
          logger.warn(`Tool guardrail blocked "${displayName}": ${inputCheck.message}`);
          return {
            callId: call.callId,
            name: displayName,
            output: JSON.stringify({ error: `Blocked by guardrail: ${inputCheck.message}` }),
            error: inputCheck.message,
            serverLabel,
            guardrailBlocked: true,
          };
        }
        if (inputCheck.action === 'warn') {
          logger.warn(`Tool guardrail warning for "${displayName}": ${inputCheck.message}`);
        }
      }

      let result: ToolCallResult;

      const localTool = localToolMap.get(call.name);
      if (localTool) {
        result = await executeLocalTool(localTool, call, logger, toolErrorFormatter);
      } else if (mcpToolManager && resolver.isKnown(call.name)) {
        try {
          const output = await mcpToolManager.executeTool(
            resolver,
            call.name,
            call.arguments,
          );
          result = {
            callId: call.callId,
            name: displayName,
            output,
            serverLabel,
          };
        } catch (err) {
          const errMsg = toErrorMessage(err);
          result = {
            callId: call.callId,
            name: displayName,
            output: formatToolError(displayName, errMsg, toolErrorFormatter),
            error: errMsg,
            serverLabel,
          };
        }
      } else if (deps.toolSearchProvider) {
        try {
          const searchResults = await deps.toolSearchProvider.search(call.name);
          if (searchResults.length > 0) {
            const found = searchResults[0].tool;
            if ('execute' in found) {
              localToolMap.set(call.name, found as FunctionTool);
              result = await executeLocalTool(found as FunctionTool, call, logger, toolErrorFormatter);
            } else {
              resolver.register(found);
              if (mcpToolManager) {
                const output = await mcpToolManager.executeTool(resolver, found.prefixedName, call.arguments);
                result = { callId: call.callId, name: displayName, output, serverLabel };
              } else {
                result = {
                  callId: call.callId,
                  name: displayName,
                  output: JSON.stringify({ error: `Tool found but no MCP manager to execute: ${call.name}` }),
                  error: `No MCP manager`,
                  serverLabel,
                };
              }
            }
            logger.info(`Tool "${call.name}" resolved via deferred search`);
          } else {
            result = {
              callId: call.callId,
              name: displayName,
              output: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
              error: `Unknown tool: ${call.name}`,
              serverLabel,
            };
          }
        } catch (err) {
          const errMsg = toErrorMessage(err);
          result = {
            callId: call.callId,
            name: displayName,
            output: formatToolError(displayName, errMsg, toolErrorFormatter),
            error: errMsg,
            serverLabel,
          };
        }
      } else {
        result = {
          callId: call.callId,
          name: displayName,
          output: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
          error: `Unknown tool: ${call.name}`,
          serverLabel,
        };
      }

      if (toolGuardrails && toolGuardrails.length > 0 && !result.error) {
        const outputCheck = evaluateOutputGuardrail(displayName, result.output, toolGuardrails);
        if (!outputCheck.allowed) {
          logger.warn(`Tool output guardrail blocked "${displayName}": ${outputCheck.message}`);
          return {
            ...result,
            output: JSON.stringify({ error: `Output blocked by guardrail: ${outputCheck.message}` }),
            error: outputCheck.message,
            guardrailBlocked: true,
          };
        }
        if (outputCheck.action === 'warn') {
          logger.warn(`Tool output guardrail warning for "${displayName}": ${outputCheck.message}`);
        }
      }

      return result;
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
