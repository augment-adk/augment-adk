import type { ResponsesApiFunctionTool } from './types/responsesApi';
import type { AgentConfig, HandoffInputFilter } from './types/agentConfig';
import type { ResponsesApiInputItem, FunctionCallOutputItem } from './types/responsesApi';
import { sanitizeName } from './tools/toolNameUtils';

/**
 * A resolved handoff target with its generated transfer function tool.
 */
export interface HandoffTarget {
  targetKey: string;
  transferTool: ResponsesApiFunctionTool;
}

/**
 * Build a `transfer_to_{name}` function tool for handoff to a target agent.
 */
export function buildHandoffTool(
  targetKey: string,
  targetConfig: AgentConfig,
): ResponsesApiFunctionTool {
  const functionName = sanitizeName(targetKey);
  const hasInputSchema =
    targetConfig.handoffInputSchema &&
    Object.keys(targetConfig.handoffInputSchema).length > 0;

  const parameters = hasInputSchema
    ? {
        type: 'object' as const,
        properties: targetConfig.handoffInputSchema!,
        additionalProperties: false,
      }
    : {
        type: 'object' as const,
        properties: {},
        additionalProperties: false,
      };

  return {
    type: 'function',
    name: `transfer_to_${functionName}`,
    description:
      `Handoff to the ${targetConfig.name} agent. ${targetConfig.handoffDescription ?? ''}`.trim(),
    parameters,
    strict: !hasInputSchema,
  };
}

/**
 * Build a `call_{name}` function tool for invoking an agent as a tool.
 */
export function buildAgentAsToolTool(
  targetKey: string,
  targetConfig: AgentConfig,
): ResponsesApiFunctionTool {
  const functionName = sanitizeName(targetKey);

  return {
    type: 'function',
    name: `call_${functionName}`,
    description:
      `Call the ${targetConfig.name} agent as a tool. ${targetConfig.handoffDescription ?? ''}`.trim(),
    parameters: {
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'The input to send to the agent',
        },
      },
      required: ['input'],
      additionalProperties: false,
    },
    strict: true,
  };
}

/**
 * Apply the target agent's handoffInputFilter to the handoff input items.
 */
export function applyHandoffInputFilter(
  handoffInput: ResponsesApiInputItem[],
  targetConfig: AgentConfig,
): ResponsesApiInputItem[] {
  const filter: HandoffInputFilter = targetConfig.handoffInputFilter ?? 'none';
  switch (filter) {
    case 'removeToolCalls':
      return handoffInput.filter(
        item =>
          (item.type as string) !== 'function_call' &&
          item.type !== 'function_call_output',
      );
    case 'summaryOnly':
      return handoffInput.slice(-1);
    case 'none':
    default:
      return handoffInput;
  }
}

/**
 * Wrap conversation history into a single nested input item
 * to reduce context size for the target agent on handoff.
 */
export function nestHandoffHistory(
  handoffInput: ResponsesApiInputItem[],
  fromAgentName: string,
  toAgentName: string,
): ResponsesApiInputItem[] {
  const summary = handoffInput
    .map(item => {
      if (item.type === 'function_call_output') {
        const fco = item as FunctionCallOutputItem;
        return `<tool_output call_id="${fco.call_id}">${fco.output}</tool_output>`;
      }
      return JSON.stringify(item);
    })
    .join('\n');

  const nested = `<handoff_context from="${fromAgentName}" to="${toAgentName}">\n${summary}\n</handoff_context>`;

  return [
    {
      type: 'function_call_output' as const,
      call_id: (handoffInput[0] as FunctionCallOutputItem)?.call_id ?? 'handoff',
      output: nested,
    },
  ] as ResponsesApiInputItem[];
}

/**
 * Parse the reason field from handoff metadata (arguments JSON).
 */
export function parseHandoffReason(
  metadata: string | undefined,
): string | undefined {
  if (!metadata) return undefined;
  try {
    const parsed = JSON.parse(metadata);
    return typeof parsed.reason === 'string' ? parsed.reason : undefined;
  } catch {
    return undefined;
  }
}
