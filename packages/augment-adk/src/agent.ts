import type { AgentConfig } from './types/agentConfig';
import type { FunctionTool } from './tools/tool';
import type { MCPServerConfig } from './types/modelConfig';

/**
 * Instructions can be a static string or a dynamic function
 * that receives the agent key and returns instructions.
 */
export type DynamicInstructions =
  | string
  | ((agentKey: string) => string | Promise<string>);

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
  private dynamicInstructions?: DynamicInstructions;

  constructor(
    config: AgentConfig,
    options?: {
      functionTools?: FunctionTool[];
      mcpServers?: MCPServerConfig[];
      dynamicInstructions?: DynamicInstructions;
    },
  ) {
    this.name = config.name;
    this.config = config;
    this.functionTools = options?.functionTools ?? [];
    this.mcpServers = options?.mcpServers ?? [];
    this.dynamicInstructions = options?.dynamicInstructions;
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
      dynamicInstructions: this.dynamicInstructions,
    });
  }

  /**
   * Resolve the effective instructions for this agent.
   * If dynamic instructions were provided, they are resolved here.
   */
  async resolveInstructions(agentKey?: string): Promise<string> {
    if (!this.dynamicInstructions) {
      return this.config.instructions;
    }
    if (typeof this.dynamicInstructions === 'string') {
      return this.dynamicInstructions;
    }
    return this.dynamicInstructions(agentKey ?? this.name);
  }

  /**
   * Serialize the agent configuration to a plain JSON-safe object.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      config: this.config,
      functionTools: this.functionTools.map(ft => ({
        name: ft.name,
        description: ft.description,
        parameters: ft.parameters,
        strict: ft.strict,
      })),
      mcpServers: this.mcpServers.map(s => ({
        id: s.id,
        name: s.name,
        type: s.type,
        url: s.url,
      })),
    };
  }
}
