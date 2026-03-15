import type { AgentConfig } from './types/agentConfig';
import type { FunctionTool } from './tools/tool';
import type { MCPServerConfig } from './types/modelConfig';

/**
 * An Agent represents a single participant in a multi-agent system.
 *
 * Each agent has its own instructions, tools, and routing rules.
 * Agents are composed into a graph via `handoffs` and `asTools`
 * references, then orchestrated by the Runner.
 *
 * ```ts
 * const router = new Agent({
 *   name: 'Router',
 *   instructions: 'You are a triage agent...',
 *   handoffs: ['engineer', 'analyst'],
 * });
 * ```
 */
export class Agent {
  readonly name: string;
  readonly config: AgentConfig;
  readonly functionTools: FunctionTool[];
  readonly mcpServers: MCPServerConfig[];

  constructor(
    config: AgentConfig,
    options?: {
      functionTools?: FunctionTool[];
      mcpServers?: MCPServerConfig[];
    },
  ) {
    this.name = config.name;
    this.config = config;
    this.functionTools = options?.functionTools ?? [];
    this.mcpServers = options?.mcpServers ?? [];
  }

  /**
   * Create a shallow copy with partial overrides.
   */
  clone(overrides: Partial<AgentConfig> = {}): Agent {
    const merged: AgentConfig = {
      ...JSON.parse(JSON.stringify(this.config)),
      ...overrides,
    };
    return new Agent(merged, {
      functionTools: this.functionTools,
      mcpServers: this.mcpServers,
    });
  }
}
