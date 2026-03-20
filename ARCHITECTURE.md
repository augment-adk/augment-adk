# Architecture

## Design thesis

Augment ADK is a TypeScript orchestration library for multi-agent workflows over the Responses API. It is architecturally inspired by the [OpenAI Agents JS SDK](https://github.com/openai/openai-agents-js) -- the core patterns (agent configuration, run loop, handoffs, tool resolution) follow similar design principles, and the project acknowledges this openly.

What distinguishes this project is a narrow set of deliberate constraints:

1. **Zero external runtime dependencies.** The core package (`adk-core`) has no npm `dependencies`. HTTP clients are built on Node's native `http`/`https` modules. The only optional peer dependencies are `zod` and `zod-to-json-schema` for runtime schema validation. This is a supply-chain decision: in regulated environments, every transitive dependency requires audit, SBOM inclusion, and license review.

2. **Library, not framework.** The ADK exports plain functions (`run()`, `runStream()`) and TypeScript interfaces. It does not own the process, register global state, or impose an application structure. It is designed to be embedded inside host applications -- a Backstage plugin, an Express server, a CLI tool -- where the host controls the HTTP server, auth, configuration, and lifecycle.

3. **LlamaStack Responses API as the primary target.** The type system, streaming normalization, MCP tool handling, and approval flows are designed around Meta's [LlamaStack](https://github.com/meta-llama/llama-stack) implementation of the Responses API. A `ChatCompletionsModel` adapter is available as an optional separate package (`@augment-adk/adk-chat-completions`) for local development with Ollama, vLLM, or other Chat Completions providers, but the Responses API is the canonical interface. See [LlamaStack API coverage](#llamastack-api-coverage) for details on which LlamaStack APIs the ADK uses.

## Codebase structure

~73 source files, ~53 test files across four packages:

```
packages/
  adk-core/                  Provider-agnostic orchestration engine (0 runtime deps)
    src/
      agent/                 Agent config, graph resolution, handoff logic
      approval/              ApprovalStore, partitionByApproval
      guardrails/            Input and output guardrail evaluation
      runner/                Run loop, streaming loop, context, state, retry
      session/               Session interface and implementations
      stream/                SSE normalization, event handlers, accumulator
      tools/                 Tool resolution, MCP, function tools, scoping
      tracing/               Span/Trace providers, batch processor
      types/                 AgentConfig, EffectiveConfig, Responses API types
      model.ts               Model interface (primary extension point)
      hooks.ts               Lifecycle hooks
      errors.ts              Error hierarchy (AdkError, MaxTurnsError, etc.)
      run.ts                 Top-level run() entry point
      runStream.ts           Top-level runStream() entry point

  adk-llamastack/            LlamaStack Responses API provider
    src/
      LlamaStackModel.ts     Model implementation
      ResponsesApiClient.ts  HTTP/SSE client (Node native http/https)
      requestBuilder.ts      Request construction and parameter mapping
      streamParser.ts        SSE stream parsing

  adk-chat-completions/      Chat Completions API adapter (optional, separate install)
    src/
      ChatCompletionsModel.ts    Model implementation for /v1/chat/completions
      ChatCompletionsClient.ts   HTTP client

  augment-adk/               Umbrella package (re-exports adk-core + adk-llamastack)
```

## LlamaStack API coverage

LlamaStack exposes ~20 API groups (Responses, Conversations, Inference, Models, Shields, Safety, VectorIO, Files, Prompts, Connectors, Tools, Tool-Runtime, Eval, Benchmarks, Scoring, Datasets, DatasetIO, Batches, Admin). The ADK intentionally targets a narrow subset.

### APIs the ADK calls directly

| Endpoint | Usage |
|----------|-------|
| `POST /v1/responses` | Core model turn (non-streaming and streaming via SSE). This is the only inference call the ADK makes. |
| `GET /v1/models` | Connectivity check via `testConnection()`. |

### CreateResponseRequest field coverage

The `requestBuilder.ts` in `adk-llamastack` maps the following `CreateResponseRequest` fields from the [LlamaStack OpenAPI spec](https://github.com/meta-llama/llama-stack):

| Field | Mapped from | Notes |
|-------|-------------|-------|
| `input` | Run loop input items | String or `ResponsesApiInputItem[]` |
| `model` | `EffectiveConfig.model` | |
| `instructions` | Agent system prompt | Omitted when `prompt` is set |
| `prompt` | `EffectiveConfig.promptRef` | Server-side prompt with `id`, `version`, `variables` |
| `tools` | Merged tool set | Function, MCP, web search, file search, code interpreter |
| `tool_choice` | `EffectiveConfig.toolChoice` | |
| `parallel_tool_calls` | `EffectiveConfig.parallelToolCalls` | |
| `stream` | Run option | `true` for `runStream()` |
| `store` | Run option / ZDR mode | Defaults to `true` unless ZDR mode |
| `temperature` | `EffectiveConfig.temperature` | |
| `text.format` | `EffectiveConfig.textFormat` | JSON schema structured output |
| `reasoning` | `EffectiveConfig.reasoning` | Effort and summary config |
| `conversation` | Session `conversationId` | Mutually exclusive with `previous_response_id` |
| `previous_response_id` | Run option | Fallback when no `conversationId` |
| `guardrails` | `EffectiveConfig.guardrails` | Server-side shield identifiers |
| `max_tool_calls` | `EffectiveConfig.maxToolCalls` | |
| `max_output_tokens` | `EffectiveConfig.maxOutputTokens` | Gated by server capability detection |
| `max_infer_iters` | `EffectiveConfig.maxInferIters` | |
| `safety_identifier` | `EffectiveConfig.safetyIdentifier` | |
| `truncation` | `EffectiveConfig.truncation` | Gated by server capability detection |
| `include` | `BuildRequestOptions.include` | Optional response field selectors |
| `metadata` | `EffectiveConfig.metadata` | Response-level key-value pairs |

### Response type alignment

The ADK's TypeScript types in `responsesApi.ts` are structural mirrors of the OpenAPI schema discriminated unions:

| ADK type | OpenAPI schema |
|----------|---------------|
| `ResponsesApiMessage` | `OpenAIResponseMessage-Output` |
| `ResponsesApiFunctionCall` | `OpenAIResponseOutputMessageFunctionToolCall` |
| `ResponsesApiFunctionCallOutput` | `OpenAIResponseInputFunctionToolCallOutput` (input type, not in output union) |
| `ResponsesApiWebSearchCall` | `OpenAIResponseOutputMessageWebSearchToolCall` |
| `ResponsesApiMcpCall` | `OpenAIResponseOutputMessageMCPCall` |
| `ResponsesApiMcpApprovalRequest` | `OpenAIResponseMCPApprovalRequest` |
| `McpApprovalResponseItem` | `OpenAIResponseMCPApprovalResponse` |
| `ResponsesApiMcpListTools` | `OpenAIResponseOutputMessageMCPListTools` |
| `ResponsesApiFileSearchResult` | `OpenAIResponseOutputMessageFileSearchToolCall` |
| `ResponsesApiMcpTool` | `OpenAIResponseInputToolMCP` |
| `ResponsesApiFunctionTool` | `OpenAIResponseInputToolFunction` |
| `ResponsesApiWebSearchTool` | `OpenAIResponseInputToolWebSearch` |
| `ResponsesApiFileSearchTool` | `OpenAIResponseInputToolFileSearch` |
| `ResponsesApiResponse` | `OpenAIResponseObject` |

### APIs the ADK does not call

The ADK passes configuration values that reference other LlamaStack APIs (e.g., `vectorStoreIds` for file search, `conversation` for conversation tracking, `guardrails` for shield identifiers, `connector_id` for MCP connectors) but does not call those APIs directly. Management of these resources (creating vector stores, registering shields, configuring connectors) is the responsibility of the deployment infrastructure or host application.

| API group | Why not called |
|-----------|---------------|
| Conversations (`/v1/conversations`) | The `conversation` field in `CreateResponseRequest` associates turns with a conversation. The server manages the conversation lifecycle. |
| Safety/Shields (`/v1/safety`, `/v1/shields`) | Shield identifiers are passed via the `guardrails` request field. The server runs shields inline during response generation. |
| VectorIO/Vector Stores (`/v1/vector-io`, `/v1/vector_stores`) | Vector store IDs are passed via file search tool config. The server executes file search. |
| Files (`/v1/files`) | File IDs can be referenced in input content. File management is external. |
| Connectors (`/v1alpha/connectors`) | `connector_id` on MCP tools routes calls through server-managed connectors. Connector registration is external. |
| Prompts (`/v1/prompts`) | `promptRef.id` references a server-managed prompt. Prompt CRUD is external. |
| Inference (`/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`) | These are separate inference endpoints. The ADK uses the Responses API, which wraps inference with tool calling, guardrails, and conversation management. The optional `@augment-adk/adk-chat-completions` package provides a `ChatCompletionsModel` targeting `/v1/chat/completions` for non-LlamaStack providers. |
| Eval, Scoring, Benchmarks, Datasets, Batches, Tool-Runtime | Out of scope for an orchestration library. These are platform-level concerns. |

## Run loop

The core execution model is a turn-based loop. Each turn calls the model, classifies the output, and either returns a result or continues the loop.

```
run(userMessage, options)
  |
  v
resolveAgentGraph(agents)            Validate agent graph, detect cycles, resolve handoff targets
  |
  v
runLoop(input, agents, model, ...)   Main orchestration loop
  |
  +---> [Turn N]
  |       |
  |       v
  |     buildAgentTools()            Merge function tools + MCP tools + handoff tools + agent-as-tool
  |       |
  |       v
  |     withRetry(model.chatTurn())  Call the model (with configurable retry policy)
  |       |
  |       v
  |     outputClassifier.classify()  Categorize the response
  |       |
  |       v
  |     processTurnClassification()
  |       |
  |       +---> final_output        Extract text, return RunResult
  |       +---> handoff             Switch active agent, continue loop
  |       +---> tool_calls          Execute server-side tools (MCP), feed results back
  |       +---> backend_tool        Execute local function tools, feed results back
  |       +---> agent_tool          Fork context, run sub-agent, feed result back
  |       +---> mcp_approval        Serialize state, return pending approvals for HITL
  |
  +---> [Turn N+1] ...
  |
  v
RunResult { content, currentAgentKey, agentName, handoffPath, toolCalls, usage, pendingApprovals }
```

**Streaming** (`runStream()`) follows the same control flow but has its own run loop implementation (`runLoopStream`) that yields `RunStreamEvent` objects as an async iterable during execution. It is not a wrapper around the non-streaming path. The `StreamAccumulator` incrementally builds the final `RunResult` from granular SSE events.

**Agent graph validation** happens before the first model call. `resolveAgentGraph()` detects cycles, validates that all handoff targets exist, and produces a frozen snapshot of the agent graph. Malformed graphs fail fast at startup, not mid-conversation.

**Retry** is handled via composable retry policies (`onNetworkError`, `onRateLimit`, `onServerError`, `maxAttempts`) with exponential backoff and `AbortSignal` support. Policies are applied at the model call boundary, not at the HTTP level.

### Multi-turn agent continuity

Each `run()` / `runStream()` call starts from `defaultAgent` unless overridden. Handoffs are **intra-run** -- they switch agents within a single `run()` invocation. When the run completes and the user sends a follow-up message, the next `run()` would restart from the router unless you explicitly tell it to continue from the specialist.

`RunResult.currentAgentKey` provides the graph key of the agent that produced the result. Use it with `createContinuationState()` (or by setting `defaultAgent` directly) to maintain agent continuity across turns:

```typescript
import { run, createContinuationState } from '@augment-adk/augment-adk';
import type { RunState } from '@augment-adk/adk-core';

let resumeState: RunState | undefined;

// Each user turn:
const result = await run(userMessage, {
  ...options,
  resumeState,
});

// Preserve agent continuity for the next turn
resumeState = createContinuationState(result, conversationId);
```

Alternatively, track the agent key and pass it as `defaultAgent`:

```typescript
let activeAgent = 'router';

const result = await run(userMessage, { ...options, defaultAgent: activeAgent });
activeAgent = result.currentAgentKey ?? activeAgent;
```

This pattern follows the same approach as the OpenAI Agents SDK, where `result.lastAgent` is used to start the next turn from the correct agent.

## Extension points

### Model

The primary extension point. The run loop interacts with models exclusively through this interface:

```typescript
interface Model {
  chatTurn(input, instructions, tools, config, options?): Promise<ResponsesApiResponse>;
  chatTurnStream(input, instructions, tools, config, onEvent, options?, signal?): Promise<void>;
  testConnection(): Promise<{ connected: boolean; error?: string }>;
}
```

Built-in implementation: `LlamaStackModel`. An optional `ChatCompletionsModel` is available via `@augment-adk/adk-chat-completions`.

To add a new provider, implement these three methods and translate the provider's native response format into `ResponsesApiResponse` at the boundary. The [Backstage plugin example](./examples/backstage-plugin/src/ModelAdapter.ts) demonstrates how a host application wraps its own HTTP client behind this interface.

### Session

Conversation history storage:

```typescript
interface Session {
  getSessionId(): string;
  getItems(): Promise<ReadonlyArray<ResponsesApiInputItem>>;
  addItems(items: ResponsesApiInputItem[]): Promise<void>;
  popItem(): Promise<ResponsesApiInputItem | undefined>;
  clearSession(): Promise<void>;
}
```

Built-in: `InMemorySession` (development), `ServerManagedSession` (LlamaStack server-side history), `CompactionSession` (summarizes history when it exceeds a token threshold).

### Tools

Three integration levels:

| Level | Mechanism | Where it executes |
|-------|-----------|-------------------|
| Function tools | `tool()` factory with an `execute` handler | In your process |
| Hosted MCP tools | `hostedMcpTool()` declaration | On the LlamaStack server (server connects to MCP server) |
| MCP tool manager | `MCPToolManager` with a connection factory | Client-side MCP protocol |

Function tools have the simplest contract: `execute: (args: TArgs) => Promise<string>`. This is the same pattern used in the Backstage plugin, which discovers backend tools from MCP servers and wraps each one as a `FunctionTool` with an execute handler that proxies the call.

### ToolScopeProvider

Semantic tool filtering for large tool sets:

```typescript
interface ToolScopeProvider {
  updateIndex(descriptors: ToolDescriptor[]): void;
  filterTools(query, maxTools, serverIds?, minScore?): ToolScopeResult;
}
```

The core ships no implementation. This is intentional -- tool scoping requires embedding models or TF-IDF indexes that would add significant dependencies. Consumers provide their own.

### ToolSearchProvider

Deferred tool discovery (tools loaded on-demand when the model requests them):

```typescript
interface ToolSearchProvider {
  search(query: string, limit: number): Promise<ToolSearchResult[]>;
}
```

Built-in: `StaticToolSearchProvider` (pre-loaded list), `RemoteToolSearchProvider` (HTTP-based).

### Hooks

```typescript
interface RunHooks {
  onRunStart?(): void;
  onRunEnd?(result): void;
  onTurnStart?(turn, agentKey): void;
  onTurnEnd?(turn, agentKey): void;
  inputFilter?(input, agentKey, turn): input;    // pre-model-call input transformation
  toolErrorFormatter?(toolName, error): string;
  onModelError?(error, agentKey, turn): string | undefined;  // return fallback or rethrow
}

interface AgentHooks {
  onStart?(agentKey, turn): void;
  onEnd?(agentKey, turn, result): void;
  onHandoff?(fromKey, toKey, reason?): void;
  onToolStart?(agentKey, toolName, turn): void;
  onToolEnd?(agentKey, toolName, turn, success): void;
}
```

### Tracing

```typescript
interface TracingProcessor {
  onSpanEnd(span: Span): void;
  shutdown(): Promise<void>;
}
```

Built-in: `BatchTraceProcessor` (batches spans and flushes periodically), `ConsoleSpanExporter`. Implement `TracingProcessor` to export to OpenTelemetry collectors, Jaeger, or Datadog.

## Trade-offs and limitations

These are deliberate constraints, not accidental gaps.

### The type system is coupled to the Responses API shape

All internal components -- the run loop, output classifier, response processor, stream accumulator, session interface -- operate on `ResponsesApiInputItem`, `ResponsesApiResponse`, and `ResponsesApiTool` types. These are structural mirrors of the LlamaStack OpenAPI schema types (`OpenAIResponseObject`, `OpenAIResponseMessage`, `OpenAIResponseOutputMessageFunctionToolCall`, etc.) as documented in the [response type alignment table](#response-type-alignment) above.

This means that adding a new model provider requires translating the provider's native format to/from these types at the `Model` boundary. For providers that already implement the Responses API (LlamaStack, OpenAI), this is trivial. For providers with significantly different formats (Anthropic Messages API, Google GenerateContent), the adapter needs to map fields. This is feasible -- the Responses API types cover standard constructs (messages, function calls, tool outputs) -- but it is additional work that wouldn't exist with a fully generic internal type system.

The trade-off is simplicity: a single concrete type system is easier to reason about, test, and maintain than a generic one with type parameters throughout the codebase.

### EffectiveConfig is broad

The `EffectiveConfig` interface has ~40 fields covering model parameters, RAG settings, vector store config, TLS options, and more. Some fields map directly to `CreateResponseRequest` parameters (see [field coverage table](#createresponserequest-field-coverage)). Others -- `vectorStoreIds`, `embeddingModel`, `chunkingStrategy`, `safetyPatterns` -- exist because they configure tool definitions that are included in the `tools` array of the request, or because they govern client-side behavior (TLS, logging). Many fields are irrelevant for non-LlamaStack providers.

This does not cause runtime issues (unused fields are ignored), but it is a leaky abstraction. A cleaner design would split it into a small required core (`model`, `baseUrl`, `temperature`, `maxOutputTokens`) and optional extension interfaces. This is a known improvement area.

### Sequential agent execution only

The run loop executes one agent at a time. Handoffs are linear: agent A hands off to agent B, which may hand off to agent C. There is no built-in fan-out/fan-in (run agents A and B in parallel, merge results).

`RunContext.fork()` exists for isolating sub-agent state, so the foundation for parallel execution is present. But the orchestration logic to coordinate concurrent agents, handle partial failures, and merge results would need to be built.

For DAG-based workflows (LangGraph-style conditional routing with cycles and checkpointing), the recommended pattern is to build a higher-level orchestrator that calls `run()` as a primitive for each graph node.

### Streaming is SSE-specific

`chatTurnStream` takes an `onEvent: (eventData: string) => void` callback that receives raw SSE event strings. The normalization layer (`normalizeLlamaStackEvent`) parses these into typed objects. Supporting WebSocket or gRPC streaming would require generalizing this callback, though the internal components already work with parsed objects.

### No built-in persistence

Sessions, approval state, and traces are in-memory by default. The interfaces (`Session`, `TracingProcessor`, `ApprovalStore`) support external backends, but the ADK does not ship Redis, PostgreSQL, or file-system implementations. The host application is expected to provide these if needed.

### No prompt engineering utilities

No prompt template engine, few-shot example management, or chain-of-thought scaffolding. Instructions are plain strings (or async functions via `DynamicInstructions`). The ADK assumes the model is capable enough that orchestration (routing, tool use, handoffs) matters more than prompt construction.

## Security considerations

- **TLS verification** is configurable per-model (`skipTlsVerify`). In production, TLS verification should be enabled. The skip option exists for development against self-signed certificates.
- **No credential storage.** API keys and tokens are passed via configuration or environment variables. The ADK does not persist credentials.
- **Input sanitization.** `sanitizeMcpError()` strips potentially sensitive information from MCP tool error messages before they reach the model. `safetyPatterns` in `EffectiveConfig` support regex-based input filtering.
- **Tool execution isolation.** Function tools execute in the host process with no sandboxing. The host application is responsible for ensuring tool handlers do not perform unauthorized operations. MCP tools execute either on the LlamaStack server (hosted) or via client-side MCP connections.
- **Approval workflows.** Destructive tool calls can require human approval via `requireApproval` on MCP server configs. `RunState` serialization allows interrupted runs to be persisted and resumed after review.

## Extensibility effort estimates

| Extension | Effort | Notes |
|-----------|--------|-------|
| New model provider | Small | Implement `Model` (3 methods). See `LlamaStackModel` (~200 LOC) as reference. |
| New web framework integration | Small | `run()` and `runStream()` are plain functions. Wrap in route handlers. |
| New session backend | Small | Implement `Session` (5 methods). `InMemorySession` is ~30 LOC. |
| Custom tracing exporter | Small | Implement `TracingProcessor` (2 methods). |
| Parallel agent execution | Medium | Build on `RunContext.fork()`. New orchestration layer, not a core rewrite. |
| EffectiveConfig refactoring | Medium | Mechanical split into core + extensions. Touches many files. |
| Generalized streaming (WebSocket/gRPC) | Medium | Abstract the `onEvent` callback to typed objects. Internal components are ready. |
| DAG-based orchestration | Large | Higher-level orchestrator using `run()` as a per-node primitive. |

## Relation to other frameworks

This project occupies a specific niche: TypeScript, zero-dependency, Responses API-native, embeddable. It is not a general-purpose AI framework. It does not include RAG pipelines, vector store abstractions, prompt template engines, or memory systems beyond conversation sessions.

**OpenAI Agents JS SDK** is the closest architectural relative and the acknowledged inspiration. The key differences are: Augment ADK targets LlamaStack (not just OpenAI), has zero external runtime dependencies (vs. the `openai` package), and includes HITL approval as a core concern.

**LangChain / LangGraph** (Python and JS) is a significantly larger ecosystem with broader scope -- chains, retrievers, memory, graph-based orchestration. The trade-off is a large dependency tree and framework-level coupling. LangGraph's stateful DAG model is more powerful than Augment ADK's linear handoff model for complex workflows.

**Google ADK** (Python and TypeScript) is designed around Gemini and Google Cloud services. It shares the agent-to-agent orchestration pattern but is tightly integrated with Google's ecosystem.

**CrewAI** (Python) uses a role-based "crew" metaphor for multi-agent coordination. It has a higher-level API that is easier to get started with but less flexible for custom orchestration patterns.

Each of these frameworks makes valid trade-offs for their target audience. Augment ADK's trade-off is depth for focus: it does less, but what it does -- multi-agent orchestration over the Responses API with minimal dependencies -- it aims to do cleanly.
