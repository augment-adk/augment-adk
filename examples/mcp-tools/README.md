# MCP Tools Example

Two tool integration patterns: local function tools and hosted MCP tools.

## What it demonstrates

### Function tools (local execution)

Tools defined with `tool()` that execute in your process. The model calls the tool, the ADK runs the `execute` handler locally, and returns the result to the model for the next turn.

This is the same pattern used by the Backstage plugin's `BackendToolExecutor`: it discovers tools from MCP servers, then wraps each one as a `FunctionTool` with an execute handler that proxies the call back to the MCP server.

```typescript
const myTool = tool({
  name: 'list_namespaces',
  description: 'List Kubernetes namespaces',
  parameters: { type: 'object', properties: { ... } },
  execute: async (args) => JSON.stringify({ namespaces: ['default', 'kube-system'] }),
});

await run('List namespaces', {
  model, agents, defaultAgent: 'k8s', config,
  functionTools: [myTool],
});
```

### Hosted MCP tools (server-side execution)

Tools declared with `hostedMcpTool()` that the LlamaStack server executes directly by connecting to the MCP server:

```typescript
const githubTool = hostedMcpTool({
  serverLabel: 'github',
  serverUrl: 'https://github-mcp.example.com/sse',
  requireApproval: 'never',
});
```

## Run

```bash
LLAMA_STACK_URL=https://your-llamastack-server.com \
  npx tsx examples/mcp-tools/index.ts
```
