/**
 * Human-in-the-loop (HITL) approval example.
 *
 * Demonstrates the approval workflow used by the Backstage plugin's
 * BackendApprovalHandler: streaming a response, detecting approval
 * requests, and resuming after user decision.
 *
 * This example simulates the approval flow since it requires an MCP
 * server with `requireApproval: 'always'` configured on the LlamaStack
 * server. The patterns shown here match the real plugin integration.
 *
 * Run:
 *   LLAMA_STACK_URL=https://your-server.com npx tsx examples/human-in-the-loop/index.ts
 */
// Published package: import { ... } from '@augment-adk/augment-adk';
import {
  run,
  runStream,
  tool,
  LlamaStackModel,
  ApprovalStore,
  type AgentConfig,
  type EffectiveConfig,
  type RunStreamEvent,
  type MCPServerConfig,
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

// A "dangerous" tool that requires approval before execution
const deleteNamespace = tool<{ namespace: string }>({
  name: 'delete_namespace',
  description: 'Delete a Kubernetes namespace and all its resources. This is a destructive operation.',
  parameters: {
    type: 'object',
    properties: {
      namespace: { type: 'string', description: 'Namespace to delete' },
    },
    required: ['namespace'],
  },
  execute: async ({ namespace }) => {
    return JSON.stringify({
      deleted: true,
      namespace,
      message: `Namespace "${namespace}" and all its resources have been deleted.`,
    });
  },
});

// A safe tool that does not require approval
const listNamespaces = tool({
  name: 'list_namespaces',
  description: 'List all Kubernetes namespaces.',
  parameters: { type: 'object', properties: {} },
  execute: async () => {
    return JSON.stringify({
      namespaces: ['default', 'kube-system', 'monitoring', 'app-staging', 'app-prod'],
    });
  },
});

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

  // =========================================================================
  // Part 1: Streaming with approval event detection
  // =========================================================================
  // This shows the pattern used by the Backstage plugin's /chat/stream
  // endpoint: iterate over RunStreamEvents and detect approval_requested.

  console.log('=== Part 1: Streaming with event types ===\n');

  const agent: AgentConfig = {
    name: 'K8sAdmin',
    instructions:
      'You are a Kubernetes admin assistant. You can list and delete namespaces. ' +
      'Always confirm what you did after using a tool.',
  };

  const streamed = runStream('List all namespaces in the cluster.', {
    model,
    agents: { admin: agent },
    defaultAgent: 'admin',
    config: makeConfig(),
    functionTools: [listNamespaces, deleteNamespace],
  });

  console.log('Stream events:');
  for await (const event of streamed) {
    logEvent(event);
  }

  console.log(`\nResult: ${streamed.result.content}\n`);

  // =========================================================================
  // Part 2: ApprovalStore pattern (non-streaming)
  // =========================================================================
  // Shows how the ApprovalStore works for backend-managed approvals.
  // In the real Backstage plugin, BackendApprovalStore extends this pattern
  // with response tracking and conversation context.

  console.log('=== Part 2: ApprovalStore pattern ===\n');

  const approvalStore = new ApprovalStore();
  console.log(`ApprovalStore initialized (pending: ${approvalStore.size})`);

  // The approval store manages pending approvals with TTL-based expiry.
  // When the ADK encounters a tool call that requires approval
  // (via MCP requireApproval config), it stores the pending approval
  // and returns it in the RunResult.
  //
  // The flow is:
  // 1. run() -> result.pendingApprovals has items
  // 2. Present to user for approval/rejection
  // 3. Re-run with approvalDecisions to continue

  console.log('\nIn a real integration with MCP approval:');
  console.log('  1. Configure MCP server with requireApproval: "always"');
  console.log('  2. Pass approvalStore to run() options');
  console.log('  3. Check result.pendingApprovals for items needing approval');
  console.log('  4. Re-run with approvalDecisions: [{ callId, approved: true }]');
  console.log('  5. The ADK resumes execution with the approved tool calls');

  console.log('\nExample approval decision structure:');
  console.log(JSON.stringify({
    approvalDecisions: [
      { callId: 'call_abc123', approved: true },
      { callId: 'call_def456', approved: false, reason: 'Too risky' },
    ],
  }, null, 2));

  // =========================================================================
  // Part 3: Demonstrating function tool execution with streaming
  // =========================================================================

  console.log('\n=== Part 3: Tool execution with streaming ===\n');

  const streamedWithTool = runStream(
    'Delete the app-staging namespace.',
    {
      model,
      agents: { admin: agent },
      defaultAgent: 'admin',
      config: makeConfig(),
      functionTools: [listNamespaces, deleteNamespace],
    },
  );

  for await (const event of streamedWithTool) {
    logEvent(event);
  }

  const toolResult = streamedWithTool.result;
  console.log(`\nResult: ${toolResult.content}`);
  if (toolResult.toolCalls?.length) {
    console.log(`Tools executed: ${toolResult.toolCalls.map(t => t.name).join(', ')}`);
  }
}

function logEvent(event: RunStreamEvent): void {
  switch (event.type) {
    case 'agent_start':
      console.log(`  [agent] ${event.agentName} started (turn ${event.turn})`);
      break;
    case 'agent_end':
      console.log(`  [agent] ${event.agentName} ended`);
      break;
    case 'tool_called':
      console.log(`  [tool]  Calling ${event.toolName}(${event.arguments})`);
      break;
    case 'tool_output':
      console.log(`  [tool]  ${event.toolName} → ${event.output.slice(0, 100)}`);
      break;
    case 'approval_requested':
      console.log(`  [HITL]  Approval needed: ${event.toolName} (${event.serverLabel})`);
      console.log(`          Args: ${event.arguments}`);
      console.log(`          ID: ${event.approvalRequestId}`);
      break;
    case 'handoff_occurred':
      console.log(`  [handoff] ${event.fromAgent} → ${event.toAgent}`);
      break;
    case 'text_delta':
      process.stdout.write(event.delta);
      break;
    case 'error':
      console.error(`  [error] ${event.message}`);
      break;
    default:
      break;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
