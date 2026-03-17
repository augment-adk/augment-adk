# Changelog

## [Unreleased]

### Changed

- **Monorepo restructure** — Split the single `@augment-adk/augment-adk` package into four:
  - `@augment-adk/adk-core` — Provider-agnostic agent orchestration (Agent, Runner, Tools, Guardrails, Approval, Stream, Tracing)
  - `@augment-adk/adk-llamastack` — LlamaStack Responses API provider (LlamaStackModel, ResponsesApiClient)
  - `@augment-adk/adk-openai-compat` — OpenAI-compatible Chat Completions provider (ChatCompletionsModel, ChatCompletionsClient)
  - `@augment-adk/augment-adk` — Batteries-included entry package that re-exports all sub-packages
- **Tests reorganized** — All `*.test.ts` files moved from `src/` to `__tests__/` directories mirroring source structure
- **Agent files grouped** — `agent.ts`, `agentGraph.ts`, `handoff.ts` moved into `src/agent/` subdirectory in adk-core
- **Model interface separated** — `model.ts` (interface-only) placed at root of adk-core, independent of any provider

### Backward Compatibility

The `@augment-adk/augment-adk` package continues to export every symbol from v0.2.0. All existing imports work unchanged. The v0.1.0 backward compatibility test suite passes. New packages are additive — consumers can optionally import from sub-packages for lighter bundles.

## [0.2.0] - 2026-03-15

### Added

- **ChatCompletionsModel** — Model adapter for any OpenAI-compatible `/v1/chat/completions` endpoint, with `ChatCompletionsClient` handling HTTP, SSE streaming, TLS, and retries.
- **Hosted tool factories** — `webSearchTool()`, `fileSearchTool()`, and `hostedMcpTool()` for creating server-side tool definitions with typed options.
- **MCP approval flow** — `mcp_approval_request` classification in the output classifier, with handling in both `runLoop` and `runLoopStream`. Enables server-side MCP approval workflows alongside the existing client-side approval store.
- **RunState serialization** — `serializeRunState()` and `deserializeRunState()` for persisting and resuming interrupted runs. `RunState.pendingMcpApprovals` field for MCP approval continuations.
- **RunContext approval helpers** — `approveTool()`, `rejectTool()`, `buildApprovalOutputItems()`, and `buildMcpApprovalResponses()` on `RunContext`.
- **Dynamic instructions** — `DynamicInstructions` type and `Agent.resolveInstructions()` for runtime instruction resolution (static strings or async functions).
- **Agent.toJSON()** — Serialization of agent configuration to plain objects for debugging and logging.
- **Optional Zod integration** — `zod` and `zod-to-json-schema` as optional peer dependencies with runtime detection via `isZodAvailable()`, `zodSchemaToJsonSchema()`, and `validateWithZod()`.
- **Error callbacks** — Optional `onModelError` and `onToolError` callbacks on `RunnerOptions`.
- **LlamaStack connector IDs** — `connector_id` field on `ResponsesApiMcpTool` for server-side MCP routing.
- **MCP approval types** — `ResponsesApiMcpApprovalRequest`, `ResponsesApiMcpListTools`, and `McpApprovalResponseItem` in the Responses API type system.
- **Behavioral tests** — 47 new unit tests across 5 new test files covering ChatCompletionsModel, hosted tools, MCP approval classification, RunState serialization, Agent dynamic instructions, and Zod compatibility.
- **Backward compatibility guard** — `V010_RUNTIME_EXPORTS` baseline test ensuring all v0.1.0 public API symbols remain exported.

### Backward Compatibility

All changes are additive. No existing exports, types, or function signatures were modified or removed. The v0.1.0 public API contract is fully preserved.

## [0.1.2] - 2026-03-14

Initial published release.
