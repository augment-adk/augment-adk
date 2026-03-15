import type { ResponsesApiFunctionTool } from '../types/responsesApi';

/**
 * A user-defined function tool that the model can invoke.
 *
 * The `execute` handler is called by the runner when the model
 * produces a `function_call` matching this tool's name.
 */
export interface FunctionTool<TArgs = Record<string, unknown>> {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
  execute: (args: TArgs) => Promise<string>;
}

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
  execute: (args: TArgs) => Promise<string>;
}

/**
 * Helper to define a typed function tool with execution handler.
 *
 * ```ts
 * const greetTool = tool({
 *   name: 'greet',
 *   description: 'Greet a person by name',
 *   parameters: {
 *     type: 'object',
 *     properties: { name: { type: 'string' } },
 *     required: ['name'],
 *   },
 *   execute: async (args) => `Hello, ${args.name}!`,
 * });
 * ```
 */
export function tool<TArgs = Record<string, unknown>>(
  definition: ToolDefinition<TArgs>,
): FunctionTool<TArgs> {
  return {
    type: 'function',
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    strict: definition.strict,
    execute: definition.execute,
  };
}

/**
 * Convert a FunctionTool into a Responses API function tool definition
 * (without the execute handler — just the schema for the API).
 */
export function toApiTool(ft: FunctionTool): ResponsesApiFunctionTool {
  return {
    type: 'function',
    name: ft.name,
    description: ft.description,
    parameters: ft.parameters,
    strict: ft.strict,
  };
}
