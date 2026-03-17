# Human-in-the-Loop Example

Approval workflows for destructive operations.

## What it demonstrates

- **Streaming event detection**: Iterating over `RunStreamEvent` objects to detect `approval_requested` events in real-time (the pattern used by the Backstage plugin's `/chat/stream` endpoint)
- **ApprovalStore**: The in-memory store that tracks pending tool approvals with TTL-based expiry
- **Resume pattern**: Re-running with `approvalDecisions` to approve or reject pending tool calls

## Approval flow

```
User request
     │
     ▼
  run() / runStream()
     │
     ▼
Model calls tool with requireApproval
     │
     ▼
result.pendingApprovals returned
     │
     ▼
Present to user ──► User approves/rejects
     │
     ▼
Re-run with approvalDecisions
     │
     ▼
Tool executes (or skips if rejected)
     │
     ▼
Final response
```

## MCP approval configuration

To enable approval for MCP tools on the LlamaStack server:

```typescript
const mcpServer: MCPServerConfig = {
  id: 'github',
  name: 'GitHub',
  type: 'sse',
  url: 'https://github-mcp.example.com/sse',
  requireApproval: 'always',  // or { always: ['dangerous_*'], never: ['read_*'] }
};
```

## Run

```bash
LLAMA_STACK_URL=https://your-llamastack-server.com \
  npx tsx examples/human-in-the-loop/index.ts
```
