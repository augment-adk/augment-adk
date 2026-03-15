/**
 * MCP tools example with backend-executed tool calls.
 *
 * Demonstrates:
 * - MCPToolManager for discovering and executing MCP tools
 * - ToolResolver with fuzzy name matching
 * - Tool output truncation
 *
 * Run: npx tsx examples/mcp-tools/index.ts
 */
import {
  run,
  LlamaStackModel,
  ToolResolver,
  MCPToolManager,
  type AgentConfig,
  type EffectiveConfig,
  type MCPConnection,
  type MCPServerConfig,
} from '@augment-adk/augment-adk';

const LLAMA_STACK_URL = process.env.LLAMA_STACK_URL || 'http://localhost:8321';
const MODEL = process.env.MODEL || 'meta-llama/Llama-3.1-8B-Instruct';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3001/mcp';

const consoleLogger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  error: (msg: string) => console.error(`[ERROR] ${msg}`),
  debug: (msg: string) => console.debug(`[DEBUG] ${msg}`),
};

/**
 * Example MCP connection factory.
 * In production, use the @modelcontextprotocol/sdk Client.
 */
async function createMcpConnection(
  server: MCPServerConfig,
): Promise<MCPConnection> {
  // This is a placeholder — replace with actual MCP SDK connection
  return {
    async listTools() {
      return [
        {
          name: 'get_weather',
          description: 'Get current weather for a city',
          inputSchema: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ];
    },
    async callTool(name: string, args: Record<string, unknown>) {
      return {
        content: [
          { type: 'text', text: `Weather in ${args.city}: Sunny, 22°C` },
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

  const mcpServers: MCPServerConfig[] = [
    {
      id: 'weather',
      name: 'Weather Server',
      type: 'streamable-http',
      url: MCP_SERVER_URL,
    },
  ];

  const agent: AgentConfig = {
    name: 'Weather Assistant',
    instructions: 'You help users check the weather. Use the get_weather tool.',
    mcpServers: ['weather'],
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

  const result = await run("What's the weather in Paris?", {
    model,
    agents: { assistant: agent },
    defaultAgent: 'assistant',
    config,
    mcpServers,
    toolResolver,
    mcpToolManager,
    logger: consoleLogger,
  });

  console.log('Response:', result.content);
  if (result.toolCalls) {
    console.log('Tool calls:', result.toolCalls.map(t => t.name));
  }
}

main().catch(console.error);
