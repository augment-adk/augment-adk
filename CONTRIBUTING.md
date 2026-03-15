# Contributing to Augment ADK

Thank you for your interest in contributing to Augment ADK! This guide will help you get started.

## Development Setup

1. **Clone the repository**

```bash
git clone https://github.com/augment-adk/augment-adk.git
cd augment-adk
```

2. **Install dependencies**

```bash
npm install
```

3. **Build the project**

```bash
cd packages/augment-adk
npm run build
```

4. **Run tests**

```bash
npm test
```

## Project Structure

```
packages/augment-adk/
  src/
    types/        # TypeScript type definitions
    model/        # Model abstraction + LlamaStack implementation
    tools/        # Tool system (FunctionTool, MCP, resolver)
    runner/       # Core orchestration engine
    stream/       # SSE normalization
    approval/     # HITL approval system
    guardrails/   # Input/output validation
    agent.ts      # Agent class
    agentGraph.ts # Multi-agent graph
    handoff.ts    # Handoff mechanics
    hooks.ts      # Lifecycle hooks
    run.ts        # Public API entry point
    errors.ts     # Error hierarchy
    logger.ts     # Logger interface
    index.ts      # Barrel exports
examples/
  basic/              # Single-agent
  multi-agent/        # Router + specialists
  mcp-tools/          # MCP integration
  human-in-the-loop/  # Approval workflows
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
- Co-locate test files next to source (`foo.test.ts` beside `foo.ts`)
- Mock external dependencies (HTTP, MCP connections) at the boundary

### No Runtime Dependencies

The ADK has **zero** runtime npm dependencies. Only Node.js built-ins are allowed. Dev dependencies (tsup, vitest, typescript, eslint) are fine.

## Pull Request Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes following the code standards above
3. Add or update tests for your changes
4. Run the full check suite:

```bash
npm run typecheck
npm run lint
npm test
npm run build
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
