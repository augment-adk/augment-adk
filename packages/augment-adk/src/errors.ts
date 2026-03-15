/**
 * Base error class for the Augment ADK.
 * All ADK-specific errors extend this class.
 */
export class AdkError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, AdkError.prototype);
    this.name = 'AdkError';
  }
}

/**
 * Thrown when the runner exceeds the configured maximum number of turns.
 */
export class MaxTurnsError extends AdkError {
  readonly maxTurns: number;
  readonly agentPath: string[];

  constructor(maxTurns: number, agentPath: string[]) {
    super(
      `Multi-agent orchestration exceeded maximum turns (${maxTurns}). ` +
        `Path: ${agentPath.join(' -> ')}`,
    );
    Object.setPrototypeOf(this, MaxTurnsError.prototype);
    this.name = 'MaxTurnsError';
    this.maxTurns = maxTurns;
    this.agentPath = agentPath;
  }
}

/**
 * Thrown when an agent referenced by key does not exist in the graph.
 */
export class AgentNotFoundError extends AdkError {
  readonly agentKey: string;
  readonly availableKeys: string[];

  constructor(agentKey: string, availableKeys: string[]) {
    super(
      `Agent "${agentKey}" not found. Available: [${availableKeys.join(', ')}]`,
    );
    Object.setPrototypeOf(this, AgentNotFoundError.prototype);
    this.name = 'AgentNotFoundError';
    this.agentKey = agentKey;
    this.availableKeys = availableKeys;
  }
}

/**
 * Thrown when an agent graph fails validation (missing default, invalid handoffs, etc.).
 */
export class GraphValidationError extends AdkError {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, GraphValidationError.prototype);
    this.name = 'GraphValidationError';
  }
}

/**
 * Thrown when a guardrail check fails and blocks execution.
 */
export class GuardrailError extends AdkError {
  readonly guardrailName: string;

  constructor(guardrailName: string, message: string) {
    super(`Guardrail "${guardrailName}" blocked execution: ${message}`);
    Object.setPrototypeOf(this, GuardrailError.prototype);
    this.name = 'GuardrailError';
    this.guardrailName = guardrailName;
  }
}

/**
 * Thrown when a tool call references an unknown or unresolvable tool.
 */
export class ToolNotFoundError extends AdkError {
  readonly toolName: string;

  constructor(toolName: string) {
    super(`Unknown tool: ${toolName}`);
    Object.setPrototypeOf(this, ToolNotFoundError.prototype);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}

/**
 * Thrown when a cycle is detected in the agent graph at runtime.
 */
export class CycleDetectedError extends AdkError {
  readonly agentKey: string;
  readonly visitCount: number;

  constructor(agentKey: string, visitCount: number) {
    super(
      `Cycle detected: agent "${agentKey}" visited ${visitCount} times.`,
    );
    Object.setPrototypeOf(this, CycleDetectedError.prototype);
    this.name = 'CycleDetectedError';
    this.agentKey = agentKey;
    this.visitCount = visitCount;
  }
}

/**
 * Extract a human-readable error message from an unknown thrown value.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}
