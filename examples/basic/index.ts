/**
 * Basic single-agent example using Augment ADK with LlamaStack.
 *
 * Run: npx tsx examples/basic/index.ts
 */
import {
  run,
  LlamaStackModel,
  type AgentConfig,
  type EffectiveConfig,
} from '@augment-adk/augment-adk';

const LLAMA_STACK_URL = process.env.LLAMA_STACK_URL || 'http://localhost:8321';
const MODEL = process.env.MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

async function main() {
  const model = new LlamaStackModel({
    clientConfig: {
      baseUrl: LLAMA_STACK_URL,
      skipTlsVerify: true,
    },
  });

  const conn = await model.testConnection();
  if (!conn.connected) {
    console.error(`Cannot connect to LlamaStack: ${conn.error}`);
    process.exit(1);
  }

  const assistantConfig: AgentConfig = {
    name: 'Assistant',
    instructions: 'You are a helpful assistant. Answer questions concisely.',
  };

  const config: EffectiveConfig = {
    model: MODEL,
    baseUrl: LLAMA_STACK_URL,
    systemPrompt: assistantConfig.instructions,
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

  const result = await run('What is the capital of France?', {
    model,
    agents: { assistant: assistantConfig },
    defaultAgent: 'assistant',
    config,
  });

  console.log('Agent:', result.agentName);
  console.log('Response:', result.content);
  if (result.usage) {
    console.log('Tokens:', result.usage);
  }
}

main().catch(console.error);
