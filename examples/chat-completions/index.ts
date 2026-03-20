/**
 * ChatCompletionsModel example using any Chat Completions backend.
 *
 * Works with Ollama, vLLM, LiteLLM, OpenAI, or any provider
 * that implements the /v1/chat/completions endpoint.
 *
 * Requires the optional @augment-adk/adk-chat-completions package.
 *
 * Run: npx tsx examples/chat-completions/index.ts
 */
// Published packages:
//   import { run, type AgentConfig, type EffectiveConfig } from '@augment-adk/augment-adk';
//   import { ChatCompletionsModel } from '@augment-adk/adk-chat-completions';
import {
  run,
  type AgentConfig,
  type EffectiveConfig,
} from '../../packages/augment-adk/src/index';
import { ChatCompletionsModel } from '../../packages/adk-chat-completions/src/index';

const BASE_URL = process.env.OPENAI_BASE_URL || 'http://localhost:11434';
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.MODEL || 'llama3.1';

async function main() {
  const model = new ChatCompletionsModel({
    clientConfig: {
      baseUrl: BASE_URL,
      token: API_KEY,
      skipTlsVerify: BASE_URL.startsWith('https://localhost'),
    },
  });

  const conn = await model.testConnection();
  if (!conn.connected) {
    console.error(`Cannot connect to ${BASE_URL}: ${conn.error}`);
    process.exit(1);
  }
  console.log(`Connected to ${BASE_URL}`);

  const assistantConfig: AgentConfig = {
    name: 'Assistant',
    instructions: 'You are a helpful assistant. Answer concisely.',
  };

  const config: EffectiveConfig = {
    model: MODEL,
    baseUrl: BASE_URL,
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
    skipTlsVerify: false,
    zdrMode: false,
    verboseStreamLogging: false,
  };

  const result = await run('What are Kubernetes pods?', {
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
