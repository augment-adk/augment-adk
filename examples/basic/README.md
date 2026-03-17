# Basic Example

Single-agent question answering using the LlamaStack Responses API.

## What it demonstrates

- Creating a `LlamaStackModel` with connection config
- Defining an `AgentConfig` with system instructions
- Running a single-turn conversation with `run()`
- Reading the `RunResult` (content, agent name, token usage)

## Run

```bash
# Default: connects to http://localhost:8321
npx tsx examples/basic/index.ts

# Custom server and model
LLAMA_STACK_URL=https://your-llamastack-server.com \
  MODEL=gemini/models/gemini-2.0-flash \
  npx tsx examples/basic/index.ts
```
