/**
 * Basic single-agent example using LlamaStack Responses API.
 *
 * Run:
 *   LLAMA_STACK_URL=https://your-server.com npx tsx examples/basic/index.ts
 *
 * Environment variables:
 *   LLAMA_STACK_URL  - LlamaStack server URL (default: http://localhost:8321)
 *   MODEL            - Model identifier (default: meta-llama/Llama-3.3-70B-Instruct)
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

async function main() {
  const model = new LlamaStackModel({
    clientConfig: { baseUrl: BASE_URL, skipTlsVerify: true },
  });

  // Verify connectivity before running
  const conn = await model.testConnection();
  if (!conn.connected) {
    console.error(`Cannot connect to ${BASE_URL}: ${conn.error}`);
    process.exit(1);
  }
  console.log(`Connected to ${BASE_URL} (model: ${MODEL})\n`);

  const assistant: AgentConfig = {
    name: 'Assistant',
    instructions:
      'You are a helpful assistant specializing in cloud-native technologies. ' +
      'Answer concisely in 2-3 sentences.',
  };

  const result = await run('What are Kubernetes pods and why are they useful?', {
    model,
    agents: { assistant },
    defaultAgent: 'assistant',
    config: makeConfig(),
  });

  console.log(`Agent:    ${result.agentName}`);
  console.log(`Response: ${result.content}`);
  if (result.usage) {
    console.log(`Tokens:   input=${result.usage.input_tokens}, output=${result.usage.output_tokens}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
