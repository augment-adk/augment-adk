# Backstage Plugin Integration Example

How to integrate the ADK into a Backstage backend plugin. Based on the real
implementation in [rhdh-plugins/workspaces/augment](https://github.com/rrbanda/rhdh-plugins/tree/feat/augment-workspace-v2/workspaces/augment).

## Architecture

The Backstage plugin does **not** use `LlamaStackModel` directly. Instead, it
implements the ADK's `Model` interface with an adapter that delegates to the
plugin's existing HTTP client and services. This allows shared connections,
retry logic, and config resolution across all Backstage features.

```
┌──────────────────────────────────────────────────────────────────┐
│ Backstage Backend Plugin                                         │
│                                                                  │
│  Express Router                                                  │
│    POST /chat  ─────► Orchestrator.chat()                        │
│    POST /chat/stream ► Orchestrator.chatStream()                 │
│                           │                                      │
│                           ▼                                      │
│                     ADK run() / runStream()                       │
│                           │                                      │
│                           ▼                                      │
│                   ModelAdapter (implements Model)                 │
│                           │                                      │
│                           ▼                                      │
│              Plugin's own ResponsesApiClient                     │
│                           │                                      │
│                           ▼                                      │
│                    LlamaStack Server                             │
└──────────────────────────────────────────────────────────────────┘
```

## Key adapter files

| File | Purpose |
|------|---------|
| `src/ModelAdapter.ts` | Implements `Model` interface, bridges to your existing HTTP client |
| `src/configAdapter.ts` | Strips Backstage-only fields from `EffectiveConfig` before passing to ADK |
| `src/Orchestrator.ts` | Bridges `run()`/`runStream()` to your Express routes |
| `src/streamEventMapper.ts` | Maps ADK `RunStreamEvent` to frontend SSE event format |

## Integration pattern

### 1. Implement the `Model` interface

The ADK's `Model` interface has three methods: `chatTurn()`, `chatTurnStream()`,
and `testConnection()`. Your adapter wraps your existing API client:

```typescript
import type { Model } from '@augment-adk/augment-adk';

class ModelAdapter implements Model {
  constructor(private client: YourApiClient) {}

  async chatTurn(input, instructions, tools, config, options?) {
    // Delegate to your existing client
    return this.client.post('/v1/responses', { input, instructions, tools, ... });
  }

  async chatTurnStream(input, instructions, tools, config, onEvent, options?, signal?) {
    // Delegate to your existing streaming client
    await this.client.stream('/v1/responses', body, onEvent, signal);
  }
}
```

### 2. Strip Backstage-specific config

Your plugin's `EffectiveConfig` likely has extra fields (branding, safety shields,
evaluation config). Strip these before passing to the ADK:

```typescript
function toAdkConfig(pluginConfig: PluginConfig): AdkEffectiveConfig {
  const { branding, safetyEnabled, inputShields, ...rest } = pluginConfig;
  return rest;
}
```

### 3. Wire into Express routes

```typescript
router.post('/chat', async (req, res) => {
  const orchestrator = new Orchestrator(model, logger);
  const result = await orchestrator.chat(req.body);
  res.json(result);
});

router.post('/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  const orchestrator = new Orchestrator(model, logger);
  await orchestrator.chatStream(req.body, event => {
    res.write(`data: ${event}\n\n`);
  });
  res.end();
});
```

### 4. Map stream events for the frontend

The ADK emits `RunStreamEvent` objects. Map them to your frontend's expected format:

```typescript
import { normalizeLlamaStackEvent, type RunStreamEvent } from '@augment-adk/augment-adk';

function mapEvent(event: RunStreamEvent): string[] {
  if (event.type === 'raw_model_event') {
    return normalizeLlamaStackEvent(event.data).map(e => JSON.stringify(e));
  }
  if (event.type === 'tool_called') {
    return [JSON.stringify({ type: 'stream.tool.started', name: event.toolName })];
  }
  // ... other event types
}
```

## app-config.yaml

```yaml
augment:
  llamaStack:
    baseUrl: ${AUGMENT_LLAMA_STACK_URL}
    model: ${AUGMENT_MODEL:-meta-llama/Llama-3.3-70B-Instruct}

  agents:
    triage:
      name: Triage
      instructions: "Route to the correct specialist agent."
      handoffs: [engineer, writer]
    engineer:
      name: Engineer
      instructions: "Answer infrastructure questions."
    writer:
      name: Writer
      instructions: "Help with documentation."
```

## Real-world reference

See the full production implementation:
- [AdkOrchestrator.ts](https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/workspaces/augment/plugins/augment-backend/src/providers/llamastack/adk-adapters/AdkOrchestrator.ts)
- [BackstageModelAdapter.ts](https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/workspaces/augment/plugins/augment-backend/src/providers/llamastack/adk-adapters/BackstageModelAdapter.ts)
- [configAdapter.ts](https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/workspaces/augment/plugins/augment-backend/src/providers/llamastack/adk-adapters/configAdapter.ts)
- [streamEventMapper.ts](https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/workspaces/augment/plugins/augment-backend/src/providers/llamastack/adk-adapters/streamEventMapper.ts)
- [responseAdapter.ts](https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/workspaces/augment/plugins/augment-backend/src/providers/llamastack/adk-adapters/responseAdapter.ts)
