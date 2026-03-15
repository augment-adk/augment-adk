import type { AgentConfig, OutputSchema } from '../types/agentConfig';
import type { ToolCallInfo } from './steps';
import type { RunResult } from './RunResult';

/**
 * Check if the agent's toolUseBehavior requires stopping at specific tool names.
 */
export function shouldStopAtToolNames(
  agentConfig: AgentConfig,
  executedCalls: Array<{ name: string }>,
): boolean {
  const behavior = agentConfig.toolUseBehavior;
  if (!behavior || typeof behavior === 'string') return false;
  const stopNames = new Set(behavior.stopAtToolNames);
  return executedCalls.some(call => stopNames.has(call.name));
}

/**
 * Client-side structured output validation.
 * Validates the final output text against the agent's outputSchema.
 */
export function validateOutput(
  text: string,
  schema: OutputSchema,
): { valid: boolean; error?: string } {
  try {
    const parsed = JSON.parse(text);
    if (schema.schema.required && Array.isArray(schema.schema.required)) {
      for (const field of schema.schema.required as string[]) {
        if (!(field in parsed)) {
          return { valid: false, error: `Missing required field: "${field}"` };
        }
      }
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Output is not valid JSON' };
  }
}

/**
 * Merge accumulated backend tool calls into a RunResult.
 */
export function mergeAccumulatedToolCalls(
  result: RunResult,
  accumulated: ToolCallInfo[],
): RunResult {
  if (accumulated.length === 0) return result;
  return { ...result, toolCalls: [...accumulated, ...(result.toolCalls ?? [])] };
}

/**
 * Detect context overflow errors in stream events
 * (vLLM returns "max_tokens must be at least 1, got -N").
 */
export function isContextOverflowMessage(msg: string): boolean {
  return /max_tokens\s+must\s+be\s+at\s+least\s+1,\s+got\s+-?\d+/i.test(msg);
}

/**
 * Extract the error message from a response.failed stream event payload.
 */
export function extractResponseFailedMessage(
  parsed: Record<string, unknown>,
): string | undefined {
  const response = parsed.response as Record<string, unknown> | undefined;
  if (response?.error) {
    const err = response.error as Record<string, unknown>;
    if (typeof err.message === 'string') return err.message;
    if (typeof err === 'string') return err;
  }
  if (typeof parsed.error === 'string') return parsed.error;
  if (typeof (parsed.error as Record<string, unknown>)?.message === 'string') {
    return (parsed.error as Record<string, unknown>).message as string;
  }
  return undefined;
}
