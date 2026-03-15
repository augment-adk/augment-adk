/**
 * Human-in-the-loop (HITL) example with approval workflows.
 *
 * Demonstrates:
 * - ApprovalStore for pending tool approvals
 * - MCP server requireApproval configuration
 * - Approval flow with RunState resumption
 *
 * Run: npx tsx examples/human-in-the-loop/index.ts
 */
import {
  run,
  LlamaStackModel,
  ToolResolver,
  MCPToolManager,
  ApprovalStore,
  type AgentConfig,
  type EffectiveConfig,
  type MCPConnection,
  type MCPServerConfig,
} from '@augment-adk/augment-adk';

const LLAMA_STACK_URL = process.env.LLAMA_STACK_URL || 'http://localhost:8321';
const MODEL = process.env.MODEL || 'meta-llama/Llama-3.1-8B-Instruct';

const consoleLogger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  debug: (msg: string) => console.debug(`[DEBUG] ${msg}`),
};

async function createMcpConnection(): Promise<MCPConnection> {
  return {
    async listTools() {
      return [
        {
          name: 'delete_namespace',
          description: 'Delete a Kubernetes namespace (destructive!)',
          inputSchema: {
            type: 'object',
            properties: { namespace: { type: 'string' } },
            required: ['namespace'],
          },
        },
      ];
    },
    async callTool(_name: string, args: Record<string, unknown>) {
      return {
        content: [
          {
            type: 'text',
            text: `Namespace "${args.namespace}" deleted successfully.`,
          },
        ],
      };
    },
    async close() {},
  };
}

async function main() {
  const model = new LlamaStackModel({
    clientConfig: { baseUrl: LLAMA_STACK_URL, skipTlsVerify: true },
    logger: consoleLogger,
  });

  const toolResolver = new ToolResolver(consoleLogger);
  const mcpToolManager = new MCPToolManager({
    connectionFactory: createMcpConnection,
    logger: consoleLogger,
  });

  const approvalStore = new ApprovalStore();

  const mcpServers: MCPServerConfig[] = [
    {
      id: 'ocp-mcp',
      name: 'OpenShift MCP',
      type: 'streamable-http',
      url: 'http://localhost:3001/mcp',
      requireApproval: 'always',
    },
  ];

  const agent: AgentConfig = {
    name: 'Cluster Engineer',
    instructions: 'You manage Kubernetes clusters. Use available tools for operations.',
  };

  const config: EffectiveConfig = {
    model: MODEL,
    baseUrl: LLAMA_STACK_URL,
    systemPrompt: agent.instructions,
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

  const result = await run('Delete the test-namespace namespace', {
    model,
    agents: { engineer: agent },
    defaultAgent: 'engineer',
    config,
    mcpServers,
    toolResolver,
    mcpToolManager,
    approvalStore,
    logger: consoleLogger,
  });

  if (result.pendingApproval) {
    console.log('\n--- APPROVAL REQUIRED ---');
    console.log('Tool:', result.pendingApproval.toolName);
    console.log('Server:', result.pendingApproval.serverLabel);
    console.log('Arguments:', result.pendingApproval.arguments);
    console.log('Approval ID:', result.pendingApproval.approvalRequestId);
    console.log('\nPending approvals in store:', approvalStore.size);
  } else {
    console.log('Response:', result.content);
  }
}

main().catch(console.error);
