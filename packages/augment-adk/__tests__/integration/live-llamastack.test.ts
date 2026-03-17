/**
 * Live integration tests against a running LlamaStack server.
 *
 * Skipped unless LLAMA_STACK_URL is set. Run with:
 *
 *   LLAMA_STACK_URL=https://your-server.com npx vitest run __tests__/integration/
 *
 * Optionally set LLAMA_STACK_MODEL (default: gemini/models/gemini-2.0-flash).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  run,
  runStream,
  tool,
  LlamaStackModel,
  noopLogger,
  type AgentConfig,
  type EffectiveConfig,
  type RunStreamEvent,
} from '../../src/index';

const LLAMA_STACK_URL = process.env.LLAMA_STACK_URL ?? '';
const MODEL_ID = process.env.LLAMA_STACK_MODEL ?? 'gemini/models/gemini-2.0-flash';

const enabled = LLAMA_STACK_URL.length > 0;
const describeIf = enabled ? describe : describe.skip;

function makeConfig(overrides: Partial<EffectiveConfig> = {}): EffectiveConfig {
  return {
    model: MODEL_ID,
    baseUrl: LLAMA_STACK_URL,
    systemPrompt: '',
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
    ...overrides,
  };
}

describeIf('Live LlamaStack Integration', () => {
  let model: LlamaStackModel;

  beforeAll(() => {
    model = new LlamaStackModel({
      clientConfig: { baseUrl: LLAMA_STACK_URL, skipTlsVerify: true },
      logger: noopLogger,
    });
  });

  // ── 1. Connectivity ──────────────────────────────────────────────────

  it('connects to the LlamaStack server', async () => {
    const result = await model.testConnection();
    expect(result.connected).toBe(true);
    console.log('  ✓ Server is reachable');
  }, 15_000);

  // ── 2. Single-agent non-streaming ─────────────────────────────────────

  it('runs a simple single-agent turn', async () => {
    const agent: AgentConfig = {
      name: 'Assistant',
      instructions: 'You are a helpful assistant. Reply in one short sentence.',
    };

    const result = await run('What is 2 + 2?', {
      model,
      agents: { assistant: agent },
      defaultAgent: 'assistant',
      config: makeConfig(),
      logger: noopLogger,
    });

    expect(result.content).toBeTruthy();
    expect(result.agentName).toBe('Assistant');
    console.log(`  ✓ Non-streaming: "${result.content}"`);
  }, 60_000);

  // ── 3. Streaming run ──────────────────────────────────────────────────

  it('runs a streaming turn and yields events', async () => {
    const agent: AgentConfig = {
      name: 'StreamBot',
      instructions: 'Reply in exactly one sentence.',
    };

    const streamed = runStream('Name one planet in our solar system.', {
      model,
      agents: { bot: agent },
      defaultAgent: 'bot',
      config: makeConfig(),
      logger: noopLogger,
    });

    const events: RunStreamEvent[] = [];
    for await (const event of streamed) {
      events.push(event);
    }

    expect(streamed.isComplete).toBe(true);
    const result = streamed.result;
    expect(result.content).toBeTruthy();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.type === 'agent_start')).toBe(true);
    console.log(`  ✓ Streaming (${events.length} events): "${result.content}"`);
  }, 60_000);

  // ── 4. Function tool calling ──────────────────────────────────────────

  it('invokes a function tool and uses the result', async () => {
    const addTool = tool<{ a: number; b: number }>({
      name: 'add_numbers',
      description: 'Add two numbers together and return the sum.',
      parameters: {
        type: 'object',
        properties: {
          a: { type: 'number', description: 'First number' },
          b: { type: 'number', description: 'Second number' },
        },
        required: ['a', 'b'],
      },
      execute: async ({ a, b }) => String(a + b),
    });

    const agent: AgentConfig = {
      name: 'Calculator',
      instructions:
        'You are a calculator. Always use the add_numbers tool to add. Report the tool result.',
    };

    const result = await run('What is 17 + 25?', {
      model,
      agents: { calc: agent },
      defaultAgent: 'calc',
      config: makeConfig(),
      functionTools: [addTool],
      logger: noopLogger,
    });

    expect(result.content).toBeTruthy();
    expect(result.content).toContain('42');
    console.log(`  ✓ Tool calling: "${result.content}"`);
    if (result.toolCalls?.length) {
      console.log(`    Tools invoked: ${result.toolCalls.map(t => t.name).join(', ')}`);
    }
  }, 90_000);

  // ── 5. Multi-agent handoff ────────────────────────────────────────────

  it('performs a multi-agent handoff', async () => {
    const triageAgent: AgentConfig = {
      name: 'Triage',
      instructions:
        'You are a triage agent. For math questions, hand off to math_expert using transfer_to_math_expert. Never answer math yourself.',
      handoffs: ['math_expert'],
    };

    const mathAgent: AgentConfig = {
      name: 'MathExpert',
      instructions: 'You are a math expert. Answer concisely in one sentence.',
    };

    const result = await run('What is the square root of 144?', {
      model,
      agents: { triage: triageAgent, math_expert: mathAgent },
      defaultAgent: 'triage',
      config: makeConfig(),
      logger: noopLogger,
    });

    expect(result.content).toBeTruthy();
    console.log(`  ✓ Handoff: "${result.content}"`);
    console.log(`    Final agent: ${result.agentName}`);
    if (result.handoffPath?.length) {
      console.log(`    Handoff path: ${result.handoffPath.join(' → ')}`);
    }
  }, 90_000);

  // ── 6. Streaming + tool use ───────────────────────────────────────────

  it('streams a tool-calling turn', async () => {
    const weatherTool = tool<{ city: string }>({
      name: 'get_weather',
      description: 'Get the current weather for a city.',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name' } },
        required: ['city'],
      },
      execute: async ({ city }) =>
        JSON.stringify({ city, temperature: '22°C', condition: 'Sunny' }),
    });

    const agent: AgentConfig = {
      name: 'WeatherBot',
      instructions:
        'You are a weather assistant. Always use get_weather. Summarize the result in one sentence.',
    };

    const streamed = runStream('What is the weather in Paris?', {
      model,
      agents: { weather: agent },
      defaultAgent: 'weather',
      config: makeConfig(),
      functionTools: [weatherTool],
      logger: noopLogger,
    });

    const events: RunStreamEvent[] = [];
    for await (const event of streamed) {
      events.push(event);
    }

    const result = streamed.result;
    expect(result.content).toBeTruthy();
    const toolEvents = events.filter(
      e => e.type === 'tool_called' || e.type === 'tool_output',
    );
    console.log(`  ✓ Stream+tool: "${result.content}"`);
    console.log(`    Tool events: ${toolEvents.length}`);
  }, 90_000);

  // ── 7. Abort signal ───────────────────────────────────────────────────

  it('respects abort signal', async () => {
    const controller = new AbortController();
    const agent: AgentConfig = {
      name: 'SlowBot',
      instructions: 'Write a very long essay about the history of computing.',
    };

    setTimeout(() => controller.abort(), 2_000);

    const streamed = runStream('Write a long essay.', {
      model,
      agents: { slow: agent },
      defaultAgent: 'slow',
      config: makeConfig(),
      signal: controller.signal,
      logger: noopLogger,
    });

    const events: RunStreamEvent[] = [];
    for await (const event of streamed) {
      events.push(event);
    }

    expect(streamed.isComplete).toBe(true);
    console.log(`  ✓ Abort respected (${events.length} events before abort)`);
  }, 30_000);
});
