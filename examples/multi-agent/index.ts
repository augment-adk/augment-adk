/**
 * Multi-agent example with a Router + two specialist agents.
 *
 * Demonstrates:
 * - Agent graph with handoffs
 * - Lifecycle event hooks
 * - Per-agent model/temperature overrides
 *
 * Run: npx tsx examples/multi-agent/index.ts
 */
import {
  run,
  LlamaStackModel,
  type AgentConfig,
  type EffectiveConfig,
  type AgentHooks,
} from '@augment-adk/augment-adk';

const LLAMA_STACK_URL = process.env.LLAMA_STACK_URL || 'http://localhost:8321';
const MODEL = process.env.MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

const agents: Record<string, AgentConfig> = {
  router: {
    name: 'Router',
    instructions: `You are a triage agent. Analyze the user's question and route to:
- "engineer" for infrastructure, Kubernetes, and cluster questions
- "analyst" for data analysis, metrics, and reporting questions
Always hand off — never answer directly.`,
    handoffs: ['engineer', 'analyst'],
    temperature: 0.1,
    handoffDescription: 'Routes questions to specialist agents',
  },
  engineer: {
    name: 'Cluster Engineer',
    instructions: 'You are a Kubernetes and infrastructure expert. Provide detailed technical answers.',
    handoffDescription: 'Handles infrastructure, Kubernetes, and cluster operations',
    temperature: 0.3,
  },
  analyst: {
    name: 'Data Analyst',
    instructions: 'You are a data analysis expert. Provide insights based on metrics and data.',
    handoffDescription: 'Handles data analysis, metrics, and reporting',
    temperature: 0.5,
  },
};

async function main() {
  const model = new LlamaStackModel({
    clientConfig: { baseUrl: LLAMA_STACK_URL, skipTlsVerify: true },
  });

  const config: EffectiveConfig = {
    model: MODEL,
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
    maxAgentTurns: 10,
  };

  const result = await run('How many nodes are in my Kubernetes cluster?', {
    model,
    agents,
    defaultAgent: 'router',
    config,
    hooks: {
      onRunStart: () => console.log('--- Run started ---'),
      onRunEnd: (result) => console.log(`--- Run ended: ${result} ---`),
      onTurnStart: (turn, agentKey) =>
        console.log(`  Turn ${turn}: ${agentKey}`),
    },
  });

  console.log('\nAgent:', result.agentName);
  console.log('Handoff Path:', result.handoffPath?.join(' → ') ?? 'direct');
  console.log('Response:', result.content);
}

main().catch(console.error);
