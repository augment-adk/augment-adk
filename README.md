# Augment ADK

[![CI](https://github.com/augment-adk/augment-adk/actions/workflows/ci.yml/badge.svg)](https://github.com/augment-adk/augment-adk/actions/workflows/ci.yml)

A lightweight, provider-agnostic TypeScript framework for building multi-agent workflows. Inspired by the [OpenAI Agents JS SDK](https://github.com/openai/openai-agents-js), designed for LlamaStack and any OpenAI-compatible backend.

## Core concepts

1. **[Agents](./examples/basic)**: LLMs configured with instructions, tools, guardrails, and handoffs
2. **[Handoffs](./examples/multi-agent)**: Delegating to other agents via typed agent graphs with validation
3. **[Tools](./examples/mcp-tools)**: Function tools, MCP tool integration, and hosted tool factories
4. **[Guardrails](./packages/adk-core/src/guardrails)**: Configurable safety checks for input and output validation
5. **[Human in the loop](./examples/human-in-the-loop)**: Built-in approval store with MCP approval flow
6. **[Sessions](./packages/adk-core/src/session)**: Conversation history management across agent runs
7. **[Tracing](./packages/adk-core/src/tracing)**: Built-in tracking of agent runs for debugging and optimization
8. **[Streaming](./packages/adk-core/src/stream)**: SSE normalization for real-time token streaming

Explore the [`examples/`](./examples) directory to see the SDK in action.

## Get started

### Supported environments

- Node.js 18 or later
- Any TypeScript runtime (Deno, Bun)

### Installation

```bash
npm install @augment-adk/augment-adk
```

### Run your first agent

```typescript
import { run, LlamaStackModel } from '@augment-adk/augment-adk';

const model = new LlamaStackModel({
  clientConfig: { baseUrl: 'http://localhost:8321' },
});

const result = await run('What is the capital of France?', {
  model,
  agents: {
    assistant: {
      name: 'Assistant',
      instructions: 'You are a helpful assistant.',
    },
  },
  defaultAgent: 'assistant',
  config: {
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    baseUrl: 'http://localhost:8321',
    systemPrompt: 'You are a helpful assistant.',
    enableWebSearch: false,
    enableCodeInterpreter: false,
    vectorStoreIds: [],
    vectorStoreName: '',
    embeddingModel: '',
    embeddingDimension: 384,
    chunkingStrategy: 'auto',
    maxChunkSizeTokens: 800,
    chunkOverlapTokens: 400,
    skipTlsVerify: true,
    zdrMode: false,
    verboseStreamLogging: false,
  },
});

console.log(result.content);
```

### Using with OpenAI-compatible backends

Use `ChatCompletionsModel` to connect to OpenAI, Ollama, vLLM, LiteLLM, or any provider implementing `/v1/chat/completions`:

```typescript
import { run, ChatCompletionsModel } from '@augment-adk/augment-adk';

const model = new ChatCompletionsModel({
  clientConfig: {
    baseUrl: 'http://localhost:11434',
    token: process.env.API_KEY,
  },
});
```

See the [chat-completions example](./examples/chat-completions) for a complete walkthrough.

## Examples

| Example | Description |
|---------|-------------|
| [basic](./examples/basic) | Single-agent question answering |
| [chat-completions](./examples/chat-completions) | OpenAI-compatible backend via `ChatCompletionsModel` |
| [multi-agent](./examples/multi-agent) | Router + specialist agent graph with handoffs |
| [mcp-tools](./examples/mcp-tools) | Function tools and hosted MCP tool integration |
| [human-in-the-loop](./examples/human-in-the-loop) | Approval workflows for destructive operations |
| [backstage-plugin](./examples/backstage-plugin) | Integrating ADK into a Backstage backend plugin |

## Packages

The SDK is organized as a monorepo with focused packages:

| Package | Description |
|---------|-------------|
| [`@augment-adk/augment-adk`](./packages/augment-adk) | Batteries-included entry point — re-exports everything |
| [`@augment-adk/adk-core`](./packages/adk-core) | Provider-agnostic core: agents, runner, tools, guardrails, approval, streaming, tracing |
| [`@augment-adk/adk-llamastack`](./packages/adk-llamastack) | LlamaStack Responses API model provider |
| [`@augment-adk/adk-openai-compat`](./packages/adk-openai-compat) | OpenAI-compatible Chat Completions model provider |

Most users should install `@augment-adk/augment-adk`. Advanced consumers can import individual packages for lighter bundles:

```typescript
import { run, Agent } from '@augment-adk/adk-core';
import { LlamaStackModel } from '@augment-adk/adk-llamastack';
```

## Development

```bash
# Install dependencies
pnpm install

# Build all packages (in dependency order)
pnpm -r build

# Run all tests
pnpm -r test

# Type-check all packages
pnpm -r typecheck

# Lint
pnpm -r lint
```

## Acknowledgements

We'd like to acknowledge the excellent work of the open-source community, especially:

- [OpenAI Agents JS SDK](https://github.com/openai/openai-agents-js) (architectural inspiration)
- [LlamaStack](https://github.com/meta-llama/llama-stack) (Responses API backend)
- [zod](https://github.com/colinhacks/zod) (optional schema validation)
- [vitest](https://github.com/vitest-dev/vitest) and [tsup](https://github.com/egoist/tsup)
- [pnpm](https://pnpm.io/)

## License

Apache-2.0 — see [LICENSE](./LICENSE).
