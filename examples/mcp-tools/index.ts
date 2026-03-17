/**
 * MCP tools example — function tools and hosted MCP tool factories.
 *
 * Demonstrates two tool integration patterns:
 *
 * 1. **Function tools**: Local tools defined with `tool()` that execute
 *    in the ADK process. This is the same pattern used by the Backstage
 *    plugin's BackendToolExecutor, which discovers MCP tools and wraps
 *    them as function tools with remote execute handlers.
 *
 * 2. **Hosted MCP tools**: Declared via `hostedMcpTool()` so the
 *    LlamaStack server connects to the MCP server directly.
 *
 * Run:
 *   LLAMA_STACK_URL=https://your-server.com npx tsx examples/mcp-tools/index.ts
 */
// Published package: import { ... } from '@augment-adk/augment-adk';
import {
  run,
  runStream,
  tool,
  hostedMcpTool,
  LlamaStackModel,
  type AgentConfig,
  type EffectiveConfig,
  type RunStreamEvent,
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

// =============================================================================
// Pattern 1: Function tools (local execution)
// =============================================================================

const getNamespaces = tool<{ cluster?: string }>({
  name: 'list_namespaces',
  description: 'List all Kubernetes namespaces in a cluster.',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Cluster name (optional)' },
    },
  },
  execute: async ({ cluster }) => {
    // In a real app this would call the K8s API
    const ns = ['default', 'kube-system', 'monitoring', 'app-staging', 'app-prod'];
    return JSON.stringify({
      cluster: cluster ?? 'default',
      namespaces: ns,
      count: ns.length,
    });
  },
});

const getPodCount = tool<{ namespace: string }>({
  name: 'get_pod_count',
  description: 'Get the number of running pods in a namespace.',
  parameters: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Kubernetes namespace' },
    },
    required: ['namespace'],
  },
  execute: async ({ namespace }) => {
    const counts: Record<string, number> = {
      'default': 3, 'kube-system': 12, 'monitoring': 8,
      'app-staging': 5, 'app-prod': 15,
    };
    return JSON.stringify({
      namespace,
      podCount: counts[namespace] ?? 0,
      status: 'healthy',
    });
  },
});

// =============================================================================
// Pattern 2: Hosted MCP tool (server-side execution)
// =============================================================================

// This declares an MCP tool that the LlamaStack server connects to directly.
// Useful when the MCP server is network-accessible from the LlamaStack server.
const githubMcpTool = hostedMcpTool({
  serverLabel: 'github',
  serverUrl: process.env.GITHUB_MCP_URL || 'https://github-mcp.example.com/sse',
  requireApproval: 'never',
});

// =============================================================================
// Demo
// =============================================================================

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

  // --- Demo: Function tools with streaming ---
  console.log('--- Function Tools (streaming) ---');

  const k8sAgent: AgentConfig = {
    name: 'K8sAssistant',
    instructions:
      'You are a Kubernetes assistant. Use the available tools to answer questions ' +
      'about clusters, namespaces, and pods. Always use tools before answering.',
  };

  const streamed = runStream(
    'How many pods are running in the monitoring namespace?',
    {
      model,
      agents: { k8s: k8sAgent },
      defaultAgent: 'k8s',
      config: makeConfig(),
      functionTools: [getNamespaces, getPodCount],
    },
  );

  for await (const event of streamed) {
    switch (event.type) {
      case 'tool_called':
        console.log(`  [tool] Calling ${event.toolName}(${event.arguments})`);
        break;
      case 'tool_output':
        console.log(`  [tool] ${event.toolName} → ${event.output}`);
        break;
      case 'text_delta':
        process.stdout.write(event.delta);
        break;
      default:
        break;
    }
  }

  const result = streamed.result;
  console.log(`\n\nAgent: ${result.agentName}`);
  if (result.toolCalls?.length) {
    console.log(`Tools used: ${result.toolCalls.map(t => t.name).join(', ')}`);
  }

  // --- Note about hosted MCP tools ---
  console.log('\n--- Hosted MCP Tool (declaration only) ---');
  console.log('Hosted MCP tool definition (passed to LlamaStack server):');
  console.log(JSON.stringify(githubMcpTool, null, 2));
  console.log(
    '\nTo use hosted MCP tools, pass them in the config or as tools[] in the ' +
    'Responses API request. The LlamaStack server connects to the MCP server directly.',
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
