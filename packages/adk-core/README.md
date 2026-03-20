# @augment-adk/adk-core

Provider-agnostic core for the Augment Agent Development Kit.

## Overview

This package contains the orchestration engine for multi-agent workflows over the Responses API. It has **zero runtime npm dependencies** -- HTTP clients, streaming, and all internal logic are implemented without external packages.

The only optional peer dependencies are `zod` and `zod-to-json-schema` for runtime schema validation.

## Key exports

- **`run()`** / **`runStream()`** -- top-level entry points for single and streaming agent execution
- **`Agent`** -- agent configuration wrapper
- **`Model`** interface -- extension point for custom model providers
- **`Session`** interface -- pluggable conversation history storage
- **`ToolResolver`** -- fuzzy tool name resolution for LLM hallucination tolerance
- **`tool()`** -- factory for function tools with typed `execute` handlers
- **`hostedMcpTool()`** -- factory for server-side MCP tool declarations
- **`RunHooks`** / **`AgentHooks`** -- lifecycle observation
- **`TracingProcessor`** -- span export for observability backends

## Usage

This package is typically consumed via the umbrella package:

```bash
npm install @augment-adk/augment-adk
```

For fine-grained control, install directly:

```bash
npm install @augment-adk/adk-core
```

Then pair with a model provider (`@augment-adk/adk-llamastack` for the Responses API, or optionally `@augment-adk/adk-chat-completions` for Chat Completions).

## Documentation

See the [root README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) for full documentation.

## License

Apache-2.0
