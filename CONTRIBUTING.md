# Contributing to Augment ADK

Thank you for your interest in contributing to Augment ADK! This guide will help you get started.

## Development Setup

1. **Clone the repository**

```bash
git clone https://github.com/augment-adk/augment-adk.git
cd augment-adk
```

2. **Install dependencies** (this is a pnpm monorepo)

```bash
pnpm install
```

3. **Build all packages**

```bash
pnpm -r build
```

4. **Run tests**

```bash
pnpm -r test
```

## Project Structure

This is a pnpm monorepo with four packages:

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
    __tests__/               Unit tests (mirrors src/ structure)

  adk-llamastack/            LlamaStack Responses API provider
    src/
      LlamaStackModel.ts     Model implementation
      ResponsesApiClient.ts  HTTP/SSE client
      requestBuilder.ts      Request construction
      streamParser.ts        SSE stream parsing

  adk-chat-completions/      Chat Completions API adapter (optional, separate install)
    src/
      ChatCompletionsModel.ts    Model for /v1/chat/completions
      ChatCompletionsClient.ts   HTTP client

  augment-adk/               Umbrella package (re-exports adk-core + adk-llamastack)

examples/
  basic/              # Single-agent
  chat-completions/   # OpenAI-compatible backend
  multi-agent/        # Router + specialists
  mcp-tools/          # MCP integration
  human-in-the-loop/  # Approval workflows
  backstage-plugin/   # Reference architecture for Backstage
```

## Code Standards

### File Size

Files should be **100–250 lines** ideally, with a hard ceiling of **350 lines**. The only exception is `runLoop.ts` which holds the core orchestration loop and is accepted at ~450 lines.

### No God Files

Every file should have a **single responsibility**. If a file is growing beyond 250 lines, consider extracting a focused helper module.

### Type Safety

- Use strict TypeScript (`strict: true`)
- Prefer `interface` over `type` for object shapes
- Use discriminated unions for event types
- Avoid `any` — use `unknown` and narrow

### Error Handling

- Extend `AdkError` for domain-specific errors
- Include structured context (error codes, metadata) in errors
- Never swallow errors silently — log and rethrow or return error results

### Testing

- Write unit tests with Vitest
- Place tests in `__tests__/` directories that mirror the `src/` structure
- Mock external dependencies (HTTP, MCP connections) at the boundary

### No Runtime Dependencies in Core

The core package (`@augment-adk/adk-core`) has **zero** runtime npm dependencies. Only Node.js built-ins are allowed. Provider packages (`adk-llamastack`, `adk-chat-completions`) depend on `adk-core` via workspace references. Dev dependencies (tsup, vitest, typescript, eslint) are fine.

## Pull Request Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes following the code standards above
3. Add or update tests for your changes
4. Run the full check suite:

```bash
pnpm -r typecheck
pnpm -r lint
pnpm -r test
pnpm -r build
```

5. Write a clear PR description explaining the "why" behind your changes
6. Submit the PR — a maintainer will review it

## Commit Messages

Use conventional commit format:

```
feat: add streaming support for multi-turn runs
fix: handle context overflow in tool reduction
docs: update MCP tools example
refactor: extract fuzzy matching into toolNameUtils
test: add unit tests for ApprovalStore TTL
```

## Reporting Issues

When filing an issue, please include:

- Augment ADK version
- LlamaStack server version
- Minimal reproduction steps
- Expected vs actual behavior
- Relevant error messages or logs

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 License.
