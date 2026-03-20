import type { ToolResolver } from '../tools/toolResolver';
import type { MCPServerConfig } from '../types/modelConfig';

interface ToolCall {
  callId: string;
  name: string;
  arguments: string;
}

/**
 * Partition tool calls into those that can auto-execute and those
 * that require human approval, based on the MCP server's
 * `requireApproval` configuration.
 */
export function partitionByApproval(
  calls: ToolCall[],
  resolver: ToolResolver,
  mcpServers: MCPServerConfig[],
): {
  approved: ToolCall[];
  needsApproval: ToolCall[];
} {
  const approved: ToolCall[] = [];
  const needsApproval: ToolCall[] = [];

  for (const call of calls) {
    const info = resolver.getServerInfo(call.name);
    if (!info) {
      approved.push(call);
      continue;
    }

    const server = mcpServers.find(s => s.id === info.serverId);
    if (
      !server ||
      !server.requireApproval ||
      server.requireApproval === 'never'
    ) {
      approved.push(call);
    } else if (server.requireApproval === 'always') {
      needsApproval.push(call);
    } else if (typeof server.requireApproval === 'object') {
      const { always, never } = server.requireApproval;
      const toolName = info.originalName ?? call.name;

      if (never && never.includes(toolName)) {
        approved.push(call);
      } else if (always && always.includes(toolName)) {
        needsApproval.push(call);
      } else {
        needsApproval.push(call);
      }
    } else {
      needsApproval.push(call);
    }
  }

  return { approved, needsApproval };
}
