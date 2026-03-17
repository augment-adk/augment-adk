# Examples

Runnable examples demonstrating the Augment ADK's capabilities.

## Quick start

All examples use `npx tsx` to run TypeScript directly. Set environment variables to configure the target server and model.

```bash
# LlamaStack examples
LLAMA_STACK_URL=https://your-server.com \
  MODEL=gemini/models/gemini-2.0-flash \
  npx tsx examples/basic/index.ts

# Chat completions examples (OpenAI-compatible)
OPENAI_BASE_URL=http://localhost:11434 \
  MODEL=llama3.1 \
  npx tsx examples/chat-completions/index.ts
```

## Examples

| Example | Model Provider | Description |
|---------|---------------|-------------|
| [basic](./basic) | LlamaStack | Single-agent question answering with `LlamaStackModel` |
| [chat-completions](./chat-completions) | OpenAI-compat | Same pattern using `ChatCompletionsModel` (Ollama, OpenAI, vLLM) |
| [multi-agent](./multi-agent) | LlamaStack | Triage agent routing to specialist agents via handoffs |
| [mcp-tools](./mcp-tools) | LlamaStack | Function tools (local) and hosted MCP tools (server-side) |
| [human-in-the-loop](./human-in-the-loop) | LlamaStack | Streaming event detection, approval store, and resume pattern |
| [backstage-plugin](./backstage-plugin) | Any | Reference architecture for integrating ADK into a Backstage backend plugin |

## Example details

### [basic](./basic)

The simplest possible ADK usage: one agent, one question, one answer. Start here to understand the core `run()` API.

### [chat-completions](./chat-completions)

Same as basic, but uses `ChatCompletionsModel` to connect to any backend that implements OpenAI's `/v1/chat/completions` endpoint (Ollama, OpenAI, vLLM, LiteLLM).

### [multi-agent](./multi-agent)

A triage agent that inspects the user's question and hands off to either an `engineer` or `writer` specialist. Demonstrates the handoff graph, `handoffDescription`, and reading `result.handoffPath`.

### [mcp-tools](./mcp-tools)

Two tool integration patterns:
- **Function tools**: Define tools with `tool()` that execute locally in your process. The model calls them, the ADK runs the handler, and returns the result.
- **Hosted MCP tools**: Declare tools with `hostedMcpTool()` so the LlamaStack server connects to the MCP server directly.

### [human-in-the-loop](./human-in-the-loop)

Shows the approval workflow used in production Backstage plugins:
1. Stream `RunStreamEvent` objects and detect `approval_requested` events
2. Use `ApprovalStore` to track pending approvals
3. Resume with `approvalDecisions` to approve or reject tool calls

### [backstage-plugin](./backstage-plugin)

Reference architecture (not directly runnable) showing how to integrate the ADK into a Backstage backend plugin. Includes adapter files for the `Model` interface, config stripping, Express route bridging, and stream event mapping. Based on the real [rhdh-plugins](https://github.com/rrbanda/rhdh-plugins/tree/feat/augment-workspace-v2/workspaces/augment) implementation.
