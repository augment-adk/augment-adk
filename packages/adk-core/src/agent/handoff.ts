import type { ResponsesApiFunctionTool } from '../types/responsesApi';
import type {
  AgentConfig,
  HandoffInputFilter,
  HandoffInputFilterContext,
} from '../types/agentConfig';
import type { ResponsesApiInputItem, FunctionCallOutputItem } from '../types/responsesApi';
import { sanitizeName } from '../tools/toolNameUtils';

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
  context?: HandoffInputFilterContext,
): ResponsesApiInputItem[] {
  const filter: HandoffInputFilter = targetConfig.handoffInputFilter ?? 'none';

  if (typeof filter === 'function') {
    return filter(handoffInput, context ?? {
      fromAgentName: '',
      toAgentName: targetConfig.name,
    });
  }

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
 * Built-in handoff input filter helpers for common patterns.
 */
export const handoffFilters = {
  /** Keep only user and assistant messages, drop tool calls/outputs. */
  removeToolCalls: (items: ResponsesApiInputItem[]): ResponsesApiInputItem[] =>
    items.filter(
      item =>
        (item.type as string) !== 'function_call' &&
        item.type !== 'function_call_output',
    ),

  /** Keep only the last N items from the handoff input. */
  lastN: (n: number) => (items: ResponsesApiInputItem[]): ResponsesApiInputItem[] =>
    items.slice(-n),

  /** Keep only items matching specific types. */
  keepTypes: (...types: string[]) => (items: ResponsesApiInputItem[]): ResponsesApiInputItem[] => {
    const typeSet = new Set(types);
    return items.filter(item => typeSet.has(item.type as string));
  },

  /** Compose multiple filters sequentially. */
  compose: (...filters: Array<(items: ResponsesApiInputItem[]) => ResponsesApiInputItem[]>) =>
    (items: ResponsesApiInputItem[]): ResponsesApiInputItem[] =>
      filters.reduce((acc, fn) => fn(acc), items),
} as const;

/**
 * Wrap the handoff output items in XML context tags for the target agent.
 *
 * In a server-managed conversation model (where `previousResponseId`
 * carries full history), this wraps only the handoff acknowledgement.
 * The function is useful for marking the handoff boundary in the
 * target agent's input.
 */
export function wrapHandoffOutput(
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

/** @deprecated Use {@link wrapHandoffOutput} instead. */
export const nestHandoffHistory = wrapHandoffOutput;

/**
 * Generate handoff-aware instructions to append to an agent's system prompt.
 * Describes available handoff targets and when to use them.
 */
export function promptWithHandoffInstructions(
  agentConfig: AgentConfig,
  handoffTargets: Array<{ key: string; config: AgentConfig }>,
): string {
  if (handoffTargets.length === 0) return agentConfig.instructions;

  const descriptions = handoffTargets.map(target => {
    const desc = target.config.handoffDescription || target.config.name;
    return `- **${target.config.name}** (transfer_to_${sanitizeName(target.key)}): ${desc}`;
  });

  const handoffBlock = [
    '',
    '## Available Handoffs',
    '',
    'You can transfer the conversation to the following agents when appropriate:',
    '',
    ...descriptions,
    '',
    'To transfer, call the corresponding transfer function. Only transfer when ' +
    'the other agent is better suited to handle the user\'s current request.',
  ].join('\n');

  return agentConfig.instructions + '\n' + handoffBlock;
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
