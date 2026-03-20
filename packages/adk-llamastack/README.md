# @augment-adk/adk-llamastack

LlamaStack Responses API provider for the Augment Agent Development Kit.

## Overview

This package implements the `Model` interface from `@augment-adk/adk-core` for Meta's [LlamaStack](https://github.com/meta-llama/llama-stack) Responses API. It handles HTTP request construction, SSE streaming, server capability detection, and retries using Node's native `http`/`https` modules.

## Key exports

- **`LlamaStackModel`** -- `Model` implementation targeting `POST /v1/responses`
- **`ResponsesApiClient`** -- HTTP/SSE client with retry and TLS support
- **`buildTurnRequest()`** -- constructs `CreateResponseRequest` bodies from ADK config
- **`parseStreamEvent()`** / **`splitSseBuffer()`** -- SSE stream parsing utilities

## Usage

```typescript
import { LlamaStackModel } from '@augment-adk/adk-llamastack';
import { run } from '@augment-adk/adk-core';

const model = new LlamaStackModel({
  clientConfig: {
    baseUrl: process.env.LLAMA_STACK_URL || 'http://localhost:8321',
  },
});

const result = await run('What is the capital of France?', {
  model,
  agents: { assistant: { name: 'Assistant', instructions: 'You are a helpful assistant.' } },
  defaultAgent: 'assistant',
  config: {
    model: 'meta-llama/Llama-3.1-8B-Instruct',
    systemPrompt: '',
  },
});
```

## Documentation

See the [root README](../../README.md) and [ARCHITECTURE.md](../../ARCHITECTURE.md) for full documentation.

## License

Apache-2.0
