# Architecture

This document explains the design decisions behind Augment ADK, how the codebase is structured, where the extension points are, and how it relates to other agent development kits in the ecosystem.

## Why this exists

Most agent frameworks fall into one of two categories:

1. **Full-stack Python frameworks** (LangChain/LangGraph, CrewAI, Google ADK) -- rich ecosystems but large dependency trees, Python-only, and tightly coupled to specific providers.
2. **Provider-locked TypeScript SDKs** (OpenAI Agents JS, Vercel AI SDK) -- excellent developer experience but designed around a single provider's API.

Augment ADK fills a specific gap: a **lightweight TypeScript orchestration layer** for the [Responses API](https://platform.openai.com/docs/api-reference/responses) pattern, with first-class support for [LlamaStack](https://github.com/meta-llama/llama-stack) and any OpenAI-compatible backend.

The primary design goals are:

- **Zero external runtime dependencies.** The `adk-core` package has no npm `dependencies` -- only build-time `devDependencies` and optional `peerDependencies` (zod). This matters for enterprise environments with strict supply-chain security, SBOM compliance, and dependency auditing requirements.
- **Embeddable, not monolithic.** The ADK is designed to be embedded as a library inside larger applications (Backstage plugins, Express servers, CLI tools), not to own the process. The `Model` interface lets host applications use their own HTTP clients, connection pools, and auth.
- **Focused scope.** Multi-agent orchestration, tool execution, approval workflows, and streaming. No RAG pipelines, vector store abstractions, prompt template engines, or memory systems beyond conversation sessions.

### Relation to OpenAI Agents JS SDK

The architecture is openly inspired by the [OpenAI Agents JS SDK](https://github.com/openai/openai-agents-js). Core patterns -- agent configs, the run loop, handoffs, tool resolution -- follow similar design principles. The README and package.json acknowledge this explicitly. What differs is the target: Augment ADK is built for LlamaStack's Responses API and designed to work without any OpenAI-specific infrastructure.

## Codebase structure

```
packages/
  adk-core/              # Provider-agnostic orchestration engine
    src/
      agent/             # Agent config, graph resolution, handoff logic
      approval/          # ApprovalStore, partitionByApproval
      guardrails/        # Input and output guardrail evaluation
      runner/            # Run loop, streaming loop, context, state
      session/           # Session interface, InMemory, ServerManaged, Compaction
      stream/            # SSE normalization, event handlers, accumulator
      tools/             # Tool resolution, MCP, function tools, scoping
      tracing/           # Span/Trace providers, batch processor
      types/             # AgentConfig, EffectiveConfig, Responses API types
      model.ts           # Model interface (the main extension point)
      hooks.ts           # Lifecycle hooks
      errors.ts          # Error hierarchy
      run.ts             # Top-level run() entry point
      runStream.ts       # Top-level runStream() entry point

  adk-llamastack/        # LlamaStack Responses API provider
    src/
      LlamaStackModel.ts # Model implementation for LlamaStack
      ResponsesApiClient.ts # HTTP/SSE client
      requestBuilder.ts  # Request construction
      streamParser.ts    # SSE stream parsing

  adk-openai-compat/     # OpenAI-compatible Chat Completions provider
    src/
      ChatCompletionsModel.ts  # Model implementation for /v1/chat/completions
      ChatCompletionsClient.ts # HTTP client

  augment-adk/           # Batteries-included entry point (re-exports all)

examples/                # Runnable examples and integration guides
```

## How the run loop works

The core execution flow for a single `run()` call:

```
run(userMessage, options)
  |
  v
resolveAgentGraph(agents)          -- validate agent graph, detect cycles
  |
  v
runLoop(input, agents, model, ...) -- main orchestration loop
  |
  +---> [Turn N]
  |       |
  |       v
  |     buildAgentTools()          -- merge function tools + MCP tools + handoff tools
  |       |
  |       v
  |     model.chatTurn()           -- call the model via the Model interface
  |       |
  |       v
  |     outputClassifier.classify() -- categorize: final_output | handoff | tool_calls | ...
  |       |
  |       v
  |     processTurnClassification()
  |       |
  |       +---> final_output       -- extract text, return RunResult
  |       +---> handoff            -- switch active agent, continue loop
  |       +---> tool_calls         -- execute tools, feed results back
  |       +---> agent_tool         -- run sub-agent, feed result back
  |       +---> mcp_approval       -- pause, return pending approvals
  |       +---> backend_tool       -- execute function tools, continue
  |
  +---> [Turn N+1] ...
  |
  v
RunResult { content, agentName, handoffPath, toolCalls, usage, ... }
```

Streaming (`runStream()`) follows the same logic but yields `RunStreamEvent` objects as an async iterable during execution.

## Extension points

### Model interface

The primary extension point. Every model interaction goes through this 3-method interface:

```typescript
interface Model {
  chatTurn(input, instructions, tools, config, options?): Promise<ResponsesApiResponse>;
  chatTurnStream(input, instructions, tools, config, onEvent, options?, signal?): Promise<void>;
  testConnection(): Promise<{ connected: boolean; error?: string }>;
}
```

**Built-in implementations:** `LlamaStackModel`, `ChatCompletionsModel`

**To add a new provider** (e.g., Anthropic, Bedrock, Gemini native): implement `Model`, translating the provider's response format into `ResponsesApiResponse`. The Responses API format is becoming a de facto standard -- the translation is typically straightforward.

The [backstage-plugin example](./examples/backstage-plugin/src/ModelAdapter.ts) shows how a host application implements this interface with its own HTTP client.

### Session interface

Pluggable conversation history storage:

```typescript
interface Session {
  getSessionId(): string;
  getItems(): Promise<ReadonlyArray<ResponsesApiInputItem>>;
  addItems(items: ResponsesApiInputItem[]): Promise<void>;
  popItem(): Promise<ResponsesApiInputItem | undefined>;
  clearSession(): Promise<void>;
}
```

**Built-in implementations:** `InMemorySession`, `ServerManagedSession`, `CompactionSession`

**To add a new backend** (Redis, PostgreSQL, DynamoDB): implement these 5 methods. `InMemorySession` is 30 lines and serves as a reference.

### Tool system

Three levels of tool integration:

| Level | Mechanism | Execution |
|-------|-----------|-----------|
| Function tools | `tool()` factory with `execute` handler | Local (in your process) |
| Hosted MCP tools | `hostedMcpTool()` declaration | Server-side (LlamaStack connects to MCP server) |
| MCP tool manager | `MCPToolManager` with connection factory | Client-side MCP protocol |

Function tools have the simplest contract: `execute: (args) => Promise<string>`. Any external service (REST API, gRPC, database query, shell command) can be wrapped as a function tool.

### ToolScopeProvider

Interface for semantic tool filtering (reduce tools sent to the model when there are many):

```typescript
interface ToolScopeProvider {
  updateIndex(descriptors: ToolDescriptor[]): void;
  filterTools(query, maxTools, serverIds?, minScore?): ToolScopeResult;
}
```

The core ships no implementation -- bring your own TF-IDF, embedding-based, or keyword matching. This is intentionally left as an extension point to avoid forcing a specific approach or adding heavy dependencies.

### ToolSearchProvider

Deferred tool loading -- tools discovered on-demand when the model requests them:

```typescript
interface ToolSearchProvider {
  search(query: string, limit: number): Promise<ToolSearchResult[]>;
}
```

**Built-in:** `StaticToolSearchProvider`, `RemoteToolSearchProvider`

### Lifecycle hooks

```typescript
interface RunHooks {
  onRunStart?(): void;
  onRunEnd?(result): void;
  onTurnStart?(turn, agentKey): void;
  onTurnEnd?(turn, agentKey): void;
  inputFilter?(input, agentKey, turn): input;
  toolErrorFormatter?(toolName, error): string;
  onModelError?(error, agentKey, turn): string | undefined;
}

interface AgentHooks {
  onStart?(agentKey, turn): void;
  onEnd?(agentKey, turn, result): void;
  onHandoff?(fromKey, toKey, reason?): void;
  onToolStart?(agentKey, toolName, turn): void;
  onToolEnd?(agentKey, toolName, turn, success): void;
}
```

Use hooks for logging, metrics, audit trails, or custom error handling without modifying core code.

### Tracing

```typescript
interface TracingProcessor {
  onSpanEnd(span: Span): void;
  shutdown(): Promise<void>;
}
```

**Built-in:** `BatchTraceProcessor`, `ConsoleSpanExporter`. Implement `TracingProcessor` to send spans to Jaeger, Datadog, OpenTelemetry collectors, etc.

## What would it take to extend

### Adding a new model provider

**Effort: Small.** Implement the `Model` interface (3 methods). The response format translation is the main work. See `packages/adk-llamastack/src/LlamaStackModel.ts` (~200 lines) or `packages/adk-openai-compat/src/ChatCompletionsModel.ts` for reference.

### Integrating with a web framework

**Effort: Small.** `run()` and `runStream()` are plain async functions. Wrap them in your framework's route handlers. See `examples/backstage-plugin/src/Orchestrator.ts` for the Express pattern. The same approach works with Fastify, Hono, NestJS, or any Node.js framework.

### Adding parallel agent execution

**Effort: Medium.** The current run loop executes agents sequentially (one active agent at a time). `RunContext.fork()` already provides isolated contexts for sub-agent runs. Adding fan-out/fan-in would require a new orchestration mode on top of the existing `runLoop`, not a rewrite of it.

### Slimming down EffectiveConfig

**Effort: Medium.** The current `EffectiveConfig` has ~40 fields mixing model parameters, RAG settings, and infrastructure config. Splitting it into a small required core and optional extension interfaces is mechanical refactoring. Every file touching `EffectiveConfig` needs updating, but the changes are predictable.

### DAG-based orchestration

**Effort: Large.** The current model is linear: agents hand off to other agents in a chain. For stateful graph workflows with conditional edges, parallel branches, and checkpointing (like LangGraph), you would build a higher-level orchestrator that calls `run()` as a primitive for each node, rather than modifying the core run loop.

## Comparison with other frameworks

| Aspect | Augment ADK | OpenAI Agents JS | LangChain/LangGraph | Google ADK | CrewAI |
|--------|-------------|-----------------|---------------------|------------|--------|
| Language | TypeScript | TypeScript | Python (+ JS) | Python | Python |
| Runtime deps | 0 | openai SDK | 100+ | google-genai | 50+ |
| Primary target | LlamaStack + OpenAI-compat | OpenAI | Any (via adapters) | Gemini | Any (via LiteLLM) |
| Multi-agent | Handoff graph | Handoff graph | Stateful graph (DAG) | Agent-to-agent | Role-based crews |
| Tool protocol | Function + MCP | Function + MCP | Tools + Toolkits | Function + MCP | Tools |
| Streaming | SSE normalization | SSE | Callbacks/streams | SSE | Limited |
| Approval/HITL | Built-in (core) | Basic | Via checkpointing | Planned | No |
| Embeddable | Yes (library) | Yes (library) | Framework-level | Framework-level | Framework-level |
| License | Apache-2.0 | MIT | MIT | Apache-2.0 | MIT |

The honest positioning: Augment ADK is not trying to replace LangChain or be a general-purpose AI framework. It is a focused orchestration layer for the Responses API pattern, optimized for TypeScript environments that need minimal dependencies, clean auditability, and embeddability in larger platforms like Backstage.

## Key design decisions

1. **Responses API as the internal type system.** All internal components operate on `ResponsesApiInputItem`, `ResponsesApiResponse`, and `ResponsesApiTool` types. This is a deliberate choice -- the Responses API is becoming the industry standard format (originated by OpenAI, adopted by LlamaStack, converging across providers). New model providers translate their native format at the `Model` boundary.

2. **No dependency on any AI provider SDK.** The HTTP clients (`ResponsesApiClient`, `ChatCompletionsClient`) are built on Node's native `http`/`https` modules. No `openai`, `@anthropic-ai/sdk`, or `@google/generative-ai` packages. This keeps the dependency tree completely clean.

3. **Agent graph validation at startup.** `resolveAgentGraph()` validates the entire agent graph before the first model call -- detecting cycles, missing agents, and invalid handoff targets. Errors surface immediately, not mid-conversation.

4. **Streaming as first-class.** `runStream()` is not a wrapper around `run()` -- it has its own run loop (`runLoopStream`) that yields `RunStreamEvent` objects as they occur. The `StreamAccumulator` incrementally builds the final result from granular events.

5. **Approval as a core concern.** `ApprovalStore`, `RunState` serialization, and MCP approval flows are in `adk-core`, not a plugin. Interrupted runs can be serialized, persisted, and resumed after human review.
