/**
 * Configuration for a single agent in a multi-agent system.
 *
 * Each agent has its own instructions, tools, and can hand off to
 * other agents via function calls. Follows the OpenAI Agents SDK pattern.
 */
export interface AgentConfig {
  name: string;
  instructions: string;
  handoffDescription?: string;
  model?: string;
  mcpServers?: string[];
  handoffs?: string[];
  asTools?: string[];
  enableRAG?: boolean;
  enableWebSearch?: boolean;
  enableCodeInterpreter?: boolean;
  functions?: FunctionDefinition[];
  toolChoice?: ToolChoiceConfig;
  reasoning?: ReasoningConfig;
  handoffInputSchema?: Record<string, unknown>;
  handoffInputFilter?: HandoffInputFilter;
  toolUseBehavior?: ToolUseBehavior;
  outputSchema?: OutputSchema;
  enabled?: boolean;
  toolGuardrails?: ToolGuardrailRule[];
  guardrails?: string[];
  maxToolCalls?: number;
  maxOutputTokens?: number;
  temperature?: number;
  resetToolChoice?: boolean;
  nestHandoffHistory?: boolean;
  promptRef?: PromptRef;
  truncation?: 'auto' | 'disabled';
}

export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export type HandoffInputFilter = 'none' | 'removeToolCalls' | 'summaryOnly';

export type ToolUseBehavior =
  | 'run_llm_again'
  | 'stop_on_first_tool'
  | { stopAtToolNames: string[] };

export interface OutputSchema {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ToolGuardrailRule {
  toolPattern: string;
  phase: 'input' | 'output';
  action: 'block' | 'warn' | 'require_approval';
  message: string;
  contentPattern?: string;
}

export type AllowedToolSpec =
  | { type: 'file_search' }
  | { type: 'web_search' }
  | { type: 'code_interpreter' }
  | { type: 'mcp'; server_label: string }
  | { type: 'function'; name: string };

export type ToolChoiceConfig =
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'function'; name: string }
  | { type: 'allowed_tools'; mode?: 'auto' | 'required'; tools: AllowedToolSpec[] };

export interface ReasoningConfig {
  effort?: 'low' | 'medium' | 'high';
  summary?: 'auto' | 'concise' | 'detailed' | 'none';
}

export interface PromptRef {
  id: string;
  version?: number;
  variables?: Record<string, string>;
}

/**
 * Deep-clone an agent config and apply partial overrides.
 */
export function cloneAgentConfig(
  base: AgentConfig,
  overrides: Partial<AgentConfig> = {},
): AgentConfig {
  const cloned = JSON.parse(JSON.stringify(base)) as AgentConfig;
  return { ...cloned, ...overrides };
}
