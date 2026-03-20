# Chat Completions Example

Single-agent question answering using the optional `@augment-adk/adk-chat-completions` adapter.

## What it demonstrates

- Creating a `ChatCompletionsModel` with connection config and optional API key
- Works with Ollama, vLLM, LiteLLM, OpenAI, or any provider implementing `/v1/chat/completions`
- Same `run()` and `AgentConfig` API as the LlamaStack examples

## Prerequisites

Install the optional Chat Completions adapter alongside the main SDK:

```bash
npm install @augment-adk/augment-adk @augment-adk/adk-chat-completions
```

## Supported backends

| Backend | Base URL | Notes |
|---------|----------|-------|
| Ollama | `http://localhost:11434` | Default, no API key needed |
| OpenAI | `https://api.openai.com` | Requires `OPENAI_API_KEY` |
| vLLM | `http://localhost:8000` | No API key needed |
| LiteLLM | `http://localhost:4000` | Proxy for multiple providers |

## Run

```bash
# Ollama (default)
npx tsx examples/chat-completions/index.ts

# OpenAI
OPENAI_BASE_URL=https://api.openai.com \
  OPENAI_API_KEY=sk-... \
  MODEL=gpt-4o \
  npx tsx examples/chat-completions/index.ts

# vLLM
OPENAI_BASE_URL=http://localhost:8000 \
  MODEL=meta-llama/Llama-3.1-8B-Instruct \
  npx tsx examples/chat-completions/index.ts
```
