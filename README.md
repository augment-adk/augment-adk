# Augment ADK

A standalone, production-grade TypeScript Agent Development Kit for the **LlamaStack Responses API**. Inspired by the [OpenAI Agents JS SDK](https://github.com/openai/openai-agents-js), purpose-built for LlamaStack's `/v1/responses` endpoint.

**Zero Backstage dependencies. Framework-agnostic. Ready for any TypeScript runtime.**

## Features

- **Multi-Agent Orchestration** — Define agent graphs with typed handoffs, per-agent instructions, and configurable routing
- **Multiple Model Backends** — `LlamaStackModel` for Responses API, `ChatCompletionsModel` for any OpenAI-compatible endpoint
- **Tool Calling** — First-class MCP tool integration with fuzzy name resolution, output truncation, and schema sanitization
- **Hosted Tools** — `webSearchTool()`, `fileSearchTool()`, `hostedMcpTool()` factories for server-side tool definitions
- **Human-in-the-Loop** — Built-in approval store with TTL-based expiry, MCP approval flow, and tool-level approval policies
- **Stream Normalization** — Converts LlamaStack SSE events into a clean, typed `NormalizedStreamEvent` union
- **Guardrails** — Input and output validation for tool calls with configurable rules
- **Context Overflow Resilience** — Automatic tool reduction and graceful error handling when hitting token limits
- **Dynamic Instructions** — Static strings or async functions for runtime instruction resolution
- **Lifecycle Hooks** — `onRunStart`, `onRunEnd`, `onTurnStart`, `onHandoff`, and per-agent hooks
- **Resumable State** — `RunState` for serializing and resuming interrupted runs (HITL continuations)
- **Zero External Dependencies** — Only Node.js built-ins at runtime (Zod is an optional peer dep)

## Quick Start

```bash
npm install @augment-adk/augment-adk
```

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

## Using with OpenAI-Compatible Backends

Use `ChatCompletionsModel` to connect to any provider that implements the Chat Completions API (OpenAI, Ollama, vLLM, etc.):

```typescript
import { run, ChatCompletionsModel } from '@augment-adk/augment-adk';

const model = new ChatCompletionsModel({
  clientConfig: {
    baseUrl: 'http://localhost:11434', // Ollama, vLLM, etc.
    token: process.env.API_KEY,
  },
});

const result = await run('Explain Kubernetes pods', {
  model,
  agents: {
    assistant: {
      name: 'Assistant',
      instructions: 'You are a helpful DevOps expert.',
    },
  },
  defaultAgent: 'assistant',
  config: {
    model: 'llama3.1',
    baseUrl: 'http://localhost:11434',
    systemPrompt: 'You are a helpful DevOps expert.',
    enableWebSearch: false,
    enableCodeInterpreter: false,
    vectorStoreIds: [],
    vectorStoreName: '',
    embeddingModel: '',
    embeddingDimension: 384,
    chunkingStrategy: 'auto',
    maxChunkSizeTokens: 800,
    chunkOverlapTokens: 400,
    skipTlsVerify: false,
    zdrMode: false,
    verboseStreamLogging: false,
  },
});

console.log(result.content);
```

## Architecture

```
@augment-adk/augment-adk
├── src/
│   ├── agent.ts              # Agent class
│   ├── agentGraph.ts          # Multi-agent graph resolution & validation
│   ├── handoff.ts             # Handoff tools & context filtering
│   ├── hooks.ts               # Lifecycle hook interfaces
│   ├── run.ts                 # Top-level public API
│   ├── errors.ts              # Error hierarchy
│   ├── logger.ts              # Framework-agnostic logger
│   ├── types/                 # All TypeScript type definitions
│   │   ├── agentConfig.ts     # Agent, tool, guardrail types
│   │   ├── responsesApi.ts    # LlamaStack Responses API types
│   │   ├── modelConfig.ts     # Model & MCP server config
│   │   └── lifecycle.ts       # Lifecycle event types
│   ├── model/                 # Model abstraction layer
│   │   ├── model.ts           # Abstract Model interface
│   │   ├── llamastack/        # LlamaStack Responses API
│   │   │   ├── LlamaStackModel.ts
│   │   │   ├── ResponsesApiClient.ts
│   │   │   ├── requestBuilder.ts
│   │   │   ├── streamParser.ts
│   │   │   ├── serverCapabilities.ts
│   │   │   └── errors.ts
│   │   └── chatCompletions/   # OpenAI-compatible Chat Completions
│   │       ├── ChatCompletionsModel.ts
│   │       └── ChatCompletionsClient.ts
│   ├── tools/                 # Tool system
│   │   ├── tool.ts            # FunctionTool interface & factory
│   │   ├── hostedTools.ts     # Web search & file search factories
│   │   ├── hostedMcpTool.ts   # Hosted MCP tool factory
│   │   ├── toolResolver.ts    # Fuzzy name matching
│   │   ├── mcpTool.ts         # MCP tool manager
│   │   ├── toolExecution.ts   # Tool dispatch & execution
│   │   ├── toolNameUtils.ts   # Name sanitization utilities
│   │   └── toolScopeProvider.ts # Optional semantic filtering
│   ├── runner/                # Core orchestration engine
│   │   ├── runLoop.ts         # Main agent loop
│   │   ├── RunContext.ts      # Mutable run state
│   │   ├── RunResult.ts       # Structured run output
│   │   ├── RunState.ts        # Serializable/resumable state
│   │   ├── outputClassifier.ts
│   │   ├── turnPreparation.ts
│   │   ├── turnExecution.ts
│   │   ├── turnResolution.ts
│   │   └── responseProcessor.ts
│   ├── stream/                # SSE normalization
│   │   ├── normalizer.ts
│   │   ├── handlers.ts
│   │   ├── events.ts
│   │   ├── constants.ts
│   │   └── errorSanitizer.ts
│   ├── approval/              # HITL approval system
│   │   ├── ApprovalStore.ts
│   │   └── partitionByApproval.ts
│   └── guardrails/            # Input/output validation
│       ├── inputGuardrail.ts
│       └── outputGuardrail.ts
└── examples/
    ├── basic/                 # Single-agent usage
    ├── multi-agent/           # Router + specialists
    ├── mcp-tools/             # MCP tool integration
    └── human-in-the-loop/     # Approval workflows
```

## Multi-Agent Orchestration

Define agent graphs with typed handoffs:

```typescript
import { run, LlamaStackModel } from '@augment-adk/augment-adk';

const result = await run('How do I scale my deployment?', {
  model,
  agents: {
    router: {
      name: 'Router',
      instructions: 'Route to engineer for cluster questions.',
      handoffs: ['engineer'],
    },
    engineer: {
      name: 'Engineer',
      instructions: 'Expert in Kubernetes and infrastructure.',
    },
  },
  defaultAgent: 'router',
  config,
});

console.log(result.handoffPath); // ['router', 'engineer']
```

## MCP Tool Integration

Connect to any MCP server for tool discovery and execution:

```typescript
import {
  run,
  MCPToolManager,
  ToolResolver,
} from '@augment-adk/augment-adk';

const toolResolver = new ToolResolver(logger);
const mcpToolManager = new MCPToolManager({
  connectionFactory: createMcpConnection,
  logger,
});

const result = await run('List all namespaces', {
  model,
  agents: { engineer: agentConfig },
  defaultAgent: 'engineer',
  config,
  mcpServers: [{ id: 'ocp', name: 'OCP', type: 'streamable-http', url: mcpUrl }],
  toolResolver,
  mcpToolManager,
});
```

## Human-in-the-Loop

Require human approval for destructive operations:

```typescript
import { run, ApprovalStore } from '@augment-adk/augment-adk';

const approvalStore = new ApprovalStore();

const result = await run('Delete the staging namespace', {
  model,
  agents,
  defaultAgent: 'engineer',
  config,
  mcpServers: [{
    id: 'ocp',
    name: 'OCP',
    type: 'streamable-http',
    url: mcpUrl,
    requireApproval: 'always',
  }],
  approvalStore,
});

if (result.pendingApproval) {
  console.log('Approval needed:', result.pendingApproval.toolName);
  // Present to user, then resume with approved state
}
```

## Guardrails

Validate tool inputs and outputs:

```typescript
const agent = {
  name: 'Safe Agent',
  instructions: '...',
  toolGuardrails: [
    {
      toolName: 'delete_*',
      validation: 'block',
      reason: 'Destructive operations require elevated permissions',
    },
  ],
};
```

## Lifecycle Hooks

Track execution at every level:

```typescript
const result = await run(question, {
  // ...
  hooks: {
    onRunStart: () => console.log('Run started'),
    onRunEnd: (r) => console.log('Run ended:', r),
    onTurnStart: (turn, agent) => console.log(`Turn ${turn}: ${agent}`),
    onHandoff: (from, to, reason) => console.log(`${from} → ${to}: ${reason}`),
  },
});
```

## Examples

| Example | Description |
|---------|-------------|
| [basic](./examples/basic) | Single-agent question answering |
| [chat-completions](./examples/chat-completions) | OpenAI-compatible backend via ChatCompletionsModel |
| [multi-agent](./examples/multi-agent) | Router + specialist agent graph |
| [mcp-tools](./examples/mcp-tools) | MCP server tool calling |
| [human-in-the-loop](./examples/human-in-the-loop) | Approval workflow |

## Comparison with OpenAI Agents SDK

| Feature | OpenAI Agents SDK | Augment ADK |
|---------|-------------------|-------------|
| Backend | OpenAI API | LlamaStack + any OpenAI-compatible API |
| Multi-agent | Agent handoffs | Agent handoffs + graph validation |
| Tools | Function tools, hosted tools, MCP | Function tools, hosted tools, MCP + fuzzy resolution |
| HITL | — | Built-in approval store + MCP approval flow |
| Guardrails | Input/output guardrails | Input/output guardrails |
| Streaming | OpenAI SSE | LlamaStack SSE normalization |
| State | — | Serializable RunState with approval persistence |
| Dependencies | openai SDK | Zero runtime dependencies (Zod optional) |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Type-check
npm run typecheck

# Lint
npm run lint
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
