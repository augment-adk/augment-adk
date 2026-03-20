# @augment-adk/adk-chat-completions

Optional Chat Completions API adapter for the Augment Agent Development Kit.

## Overview

This package implements the `Model` interface from `@augment-adk/adk-core` for any server exposing the `/v1/chat/completions` endpoint (Ollama, vLLM, OpenAI, LiteLLM, and other compatible backends).

It translates between the ADK's Responses-API-shaped runner interface and Chat Completions request/response formats, allowing the same agent orchestration logic to work against Chat Completions providers.

> **Note:** This is an **optional** package. The primary ADK experience uses the Responses API via LlamaStack (`@augment-adk/adk-llamastack`). Install this package only if you need Chat Completions support for local development or alternative providers.

## Installation

```bash
# The main SDK (Responses API via LlamaStack):
npm install @augment-adk/augment-adk

# This optional adapter:
npm install @augment-adk/adk-chat-completions
```

## Key exports

- **`ChatCompletionsModel`** -- `Model` implementation for `/v1/chat/completions`
- **`ChatCompletionsClient`** -- HTTP/SSE client with retry and TLS support

## Usage

```typescript
import { ChatCompletionsModel } from '@augment-adk/adk-chat-completions';
import { run } from '@augment-adk/adk-core';

const model = new ChatCompletionsModel({
  baseUrl: 'http://localhost:11434',  // Ollama
  model: 'llama3.1',
});

const result = await run('Explain quantum computing.', {
  model,
  agents: { assistant: { name: 'Assistant', instructions: 'You are a helpful assistant.' } },
});
```

## Documentation

See the [root README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) for full documentation.

## License

Apache-2.0
