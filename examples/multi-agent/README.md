# Multi-Agent Handoff Example

Router pattern with a triage agent that delegates to specialist agents.

## What it demonstrates

- Defining multiple agents with `handoffs` and `handoffDescription`
- The triage agent routes questions to `engineer` or `writer`
- Reading `result.handoffPath` to see the delegation chain (e.g. `triage → engineer`)
- Reading `result.agentName` to see which agent produced the final answer

## Agent graph

```
         ┌──────────┐
         │  Triage   │
         └────┬──┬───┘
              │  │
    ┌─────────┘  └──────────┐
    ▼                       ▼
┌──────────┐         ┌──────────┐
│ Engineer │         │  Writer  │
└──────────┘         └──────────┘
```

## Run

```bash
LLAMA_STACK_URL=https://your-llamastack-server.com \
  npx tsx examples/multi-agent/index.ts
```
