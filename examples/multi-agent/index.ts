/**
 * Multi-agent handoff example.
 *
 * Demonstrates a triage agent that routes user requests to
 * specialist agents (engineer or writer) based on the question type.
 *
 * Run:
 *   LLAMA_STACK_URL=https://your-server.com npx tsx examples/multi-agent/index.ts
 */
// Published package: import { run, LlamaStackModel, ... } from '@augment-adk/augment-adk';
import {
  run,
  LlamaStackModel,
  type AgentConfig,
  type EffectiveConfig,
} from '../../packages/augment-adk/src/index';

const BASE_URL = process.env.LLAMA_STACK_URL || 'http://localhost:8321';
const MODEL = process.env.MODEL || 'gemini/models/gemini-2.0-flash';

function makeConfig(): EffectiveConfig {
  return {
    model: MODEL,
    baseUrl: BASE_URL,
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
  };
}

const triage: AgentConfig = {
  name: 'Triage',
  instructions:
    'You are a triage agent. Route the user to the correct specialist:\n' +
    '- For infrastructure, DevOps, Kubernetes, or coding questions: hand off to engineer\n' +
    '- For writing, documentation, or creative tasks: hand off to writer\n' +
    'Never answer questions yourself. Always hand off.',
  handoffs: ['engineer', 'writer'],
};

const engineer: AgentConfig = {
  name: 'Engineer',
  instructions:
    'You are a senior platform engineer. Answer infrastructure, Kubernetes, ' +
    'and DevOps questions concisely in 2-3 sentences.',
  handoffDescription: 'Handles infrastructure, DevOps, Kubernetes, and coding questions.',
};

const writer: AgentConfig = {
  name: 'Writer',
  instructions:
    'You are a technical writer. Help with documentation, README files, ' +
    'and creative writing tasks. Be concise.',
  handoffDescription: 'Handles documentation, writing, and creative tasks.',
};

async function main() {
  const model = new LlamaStackModel({
    clientConfig: { baseUrl: BASE_URL, skipTlsVerify: true },
  });

  const conn = await model.testConnection();
  if (!conn.connected) {
    console.error(`Cannot connect to ${BASE_URL}: ${conn.error}`);
    process.exit(1);
  }
  console.log(`Connected to ${BASE_URL}\n`);

  const agents = { triage, engineer, writer };
  const config = makeConfig();

  // --- Question 1: Should route to engineer ---
  console.log('--- Question 1: Infrastructure ---');
  const q1 = await run('How do I set up a Kubernetes namespace with resource quotas?', {
    model,
    agents,
    defaultAgent: 'triage',
    config,
  });

  console.log(`Final agent:  ${q1.agentName}`);
  console.log(`Handoff path: ${q1.handoffPath?.join(' → ') ?? 'none'}`);
  console.log(`Response:     ${q1.content}\n`);

  // --- Question 2: Should route to writer ---
  console.log('--- Question 2: Documentation ---');
  const q2 = await run('Write a one-paragraph README intro for a CLI tool called "kube-lint".', {
    model,
    agents,
    defaultAgent: 'triage',
    config,
  });

  console.log(`Final agent:  ${q2.agentName}`);
  console.log(`Handoff path: ${q2.handoffPath?.join(' → ') ?? 'none'}`);
  console.log(`Response:     ${q2.content}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
