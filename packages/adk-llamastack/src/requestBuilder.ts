import type { EffectiveConfig, CapabilityInfo } from '@augment-adk/adk-core';
import type { ResponsesApiInputItem, ResponsesApiTool } from '@augment-adk/adk-core';
import { isParamSupported } from './serverCapabilities';

export interface BuildRequestOptions {
  previousResponseId?: string;
  conversationId?: string;
  stream?: boolean;
  store?: boolean;
  /** Optional list of include field selectors for the response. */
  include?: string[];
}

/**
 * Build a Responses API `/v1/responses` request body from config and inputs.
 *
 * Maps 1:1 to the LlamaStack CreateResponseRequest:
 * input, model, instructions|prompt, tools, tool_choice, temperature,
 * max_output_tokens, max_tool_calls, reasoning, guardrails, text.format,
 * parallel_tool_calls, stream, store, previous_response_id, conversation.
 */
export function buildTurnRequest(
  input: string | ResponsesApiInputItem[],
  instructions: string,
  tools: ResponsesApiTool[],
  config: EffectiveConfig,
  capabilities: CapabilityInfo,
  options?: BuildRequestOptions,
): Record<string, unknown> {
  const isZdrMode = config.zdrMode === true;
  const storeValue = options?.store ?? !isZdrMode;

  const request: Record<string, unknown> = {
    input,
    model: config.model,
    tools: tools.length > 0 ? tools : undefined,
    store: storeValue,
  };

  if (options?.include && options.include.length > 0) {
    request.include = options.include;
  }

  if (config.promptRef) {
    const prompt: Record<string, unknown> = { id: config.promptRef.id };
    if (config.promptRef.version !== undefined) prompt.version = config.promptRef.version;
    if (config.promptRef.variables) prompt.variables = config.promptRef.variables;
    request.prompt = prompt;
  } else {
    request.instructions = instructions;
  }

  if (options?.stream) {
    request.stream = true;
  }

  if (config.toolChoice) {
    request.tool_choice = config.toolChoice;
  }
  if (config.parallelToolCalls !== undefined) {
    request.parallel_tool_calls = config.parallelToolCalls;
  }

  if (config.textFormat) {
    request.text = { format: config.textFormat };
  }

  if (config.reasoning) {
    const reasoning: Record<string, unknown> = {};
    if (config.reasoning.effort) reasoning.effort = config.reasoning.effort;
    if (config.reasoning.summary) reasoning.summary = config.reasoning.summary;
    if (Object.keys(reasoning).length > 0) {
      request.reasoning = reasoning;
    }
  }

  // conversation and previous_response_id are mutually exclusive in
  // Llama Stack.  Prefer conversation so every turn is stored in the
  // conversation container and retrievable via GET /conversations/{id}/items.
  if (options?.conversationId) {
    request.conversation = options.conversationId;
  } else if (options?.previousResponseId) {
    request.previous_response_id = options.previousResponseId;
  }

  applyProductionParams(request, config, capabilities);

  if (config.truncation && isParamSupported(capabilities, 'truncation')) {
    request.truncation = config.truncation;
  }

  if (config.metadata && Object.keys(config.metadata).length > 0) {
    request.metadata = config.metadata;
  }

  return request;
}

function applyProductionParams(
  request: Record<string, unknown>,
  config: EffectiveConfig,
  capabilities: CapabilityInfo,
): void {
  if (config.guardrails && config.guardrails.length > 0) {
    request.guardrails = config.guardrails;
  }
  if (config.maxToolCalls !== undefined && config.maxToolCalls > 0) {
    request.max_tool_calls = config.maxToolCalls;
  }
  if (
    config.maxOutputTokens !== undefined &&
    config.maxOutputTokens > 0 &&
    isParamSupported(capabilities, 'max_output_tokens')
  ) {
    request.max_output_tokens = config.maxOutputTokens;
  }
  if (config.temperature !== undefined) {
    request.temperature = config.temperature;
  }
  if (config.safetyIdentifier) {
    request.safety_identifier = config.safetyIdentifier;
  }
  if (config.maxInferIters !== undefined && config.maxInferIters > 0) {
    request.max_infer_iters = config.maxInferIters;
  }
}
