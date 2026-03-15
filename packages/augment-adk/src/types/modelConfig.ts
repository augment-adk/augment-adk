import type {
  ReasoningConfig,
  ToolChoiceConfig,
  PromptRef,
  FunctionDefinition,
} from './agentConfig';

/**
 * MCP server connection configuration.
 * Framework-agnostic — no Backstage types.
 */
export interface MCPServerConfig {
  id: string;
  name: string;
  type: 'streamable-http' | 'sse' | 'stdio';
  url: string;
  headers?: Record<string, string>;
  requireApproval?: 'never' | 'always' | { always?: string[]; never?: string[] };
  allowedTools?: string[];
}

/**
 * Runtime-effective configuration that merges baseline and per-agent overrides.
 * Consumers should read from this interface at chat time.
 */
export interface EffectiveConfig {
  model: string;
  baseUrl: string;
  systemPrompt: string;
  toolChoice?: ToolChoiceConfig;
  parallelToolCalls?: boolean;
  textFormat?: {
    type: 'json_schema';
    json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean };
  };
  enableWebSearch: boolean;
  enableCodeInterpreter: boolean;
  fileSearchMaxResults?: number;
  fileSearchScoreThreshold?: number;
  vectorStoreIds: string[];
  vectorStoreName: string;
  embeddingModel: string;
  embeddingDimension: number;
  searchMode?: 'semantic' | 'keyword' | 'hybrid';
  bm25Weight?: number;
  semanticWeight?: number;
  chunkingStrategy: 'auto' | 'static';
  maxChunkSizeTokens: number;
  chunkOverlapTokens: number;
  skipTlsVerify: boolean;
  zdrMode: boolean;
  functions?: FunctionDefinition[];
  token?: string;
  verboseStreamLogging: boolean;
  safetyPatterns?: string[];
  mcpServers?: MCPServerConfig[];
  reasoning?: ReasoningConfig;
  toolScoping?: ToolScopingConfig;
  guardrails?: string[];
  maxToolCalls?: number;
  maxOutputTokens?: number;
  temperature?: number;
  safetyIdentifier?: string;
  maxInferIters?: number;
  postToolInstructions?: string;
  truncation?: 'auto' | 'disabled';
  agents?: Record<string, import('./agentConfig').AgentConfig>;
  defaultAgent?: string;
  maxAgentTurns?: number;
  promptRef?: PromptRef;
}

/**
 * Semantic tool scoping configuration.
 */
export interface ToolScopingConfig {
  enabled: boolean;
  maxToolsPerTurn: number;
  activationThreshold: number;
  minScore: number;
}

/**
 * Server capability flags for runtime parameter gating.
 */
export interface CapabilityInfo {
  functionTools: boolean;
  strictField: boolean;
  maxOutputTokens: boolean;
  mcpTools: boolean;
  parallelToolCalls: boolean;
  truncation: boolean;
}
