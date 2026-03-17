/**
 * Backstage Model Adapter
 *
 * Implements the ADK's framework-agnostic `Model` interface by
 * delegating to your plugin's existing HTTP client.
 *
 * This is the pattern used by the real Backstage plugin — the plugin
 * already has its own ResponsesApiClient with connection pooling,
 * retries, and TLS config, so the adapter wraps it rather than
 * creating a separate LlamaStackModel.
 *
 * Simplified from:
 * https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/
 *   workspaces/augment/plugins/augment-backend/src/providers/llamastack/
 *   adk-adapters/BackstageModelAdapter.ts
 */
import type {
  Model,
  ModelTurnOptions,
  EffectiveConfig,
  ResponsesApiInputItem,
  ResponsesApiResponse,
  ResponsesApiTool,
} from '@augment-adk/augment-adk';

/**
 * Minimal interface for any HTTP client that can talk to a
 * Responses API endpoint. Your plugin likely already has one.
 */
export interface ResponsesApiClient {
  post<T>(endpoint: string, body: unknown): Promise<T>;
  stream(
    endpoint: string,
    body: unknown,
    onEvent: (data: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  get<T>(endpoint: string): Promise<T>;
}

/**
 * Adapts your plugin's existing API client to the ADK's Model interface.
 *
 * The ADK calls chatTurn() / chatTurnStream() on this adapter;
 * the adapter builds the Responses API request and delegates to
 * your client.
 */
export class BackstageModelAdapter implements Model {
  constructor(private readonly client: ResponsesApiClient) {}

  async chatTurn(
    input: string | ResponsesApiInputItem[],
    instructions: string,
    tools: ResponsesApiTool[],
    config: EffectiveConfig,
    options?: ModelTurnOptions,
  ): Promise<ResponsesApiResponse> {
    const body = this.buildRequest(input, instructions, tools, config, options);
    return this.client.post<ResponsesApiResponse>('/v1/responses', body);
  }

  async chatTurnStream(
    input: string | ResponsesApiInputItem[],
    instructions: string,
    tools: ResponsesApiTool[],
    config: EffectiveConfig,
    onEvent: (eventData: string) => void,
    options?: ModelTurnOptions,
    signal?: AbortSignal,
  ): Promise<void> {
    const body = this.buildRequest(input, instructions, tools, config, options, true);
    await this.client.stream('/v1/responses', body, onEvent, signal);
  }

  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      await this.client.get('/v1/models');
      return { connected: true };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildRequest(
    input: string | ResponsesApiInputItem[],
    instructions: string,
    tools: ResponsesApiTool[],
    config: EffectiveConfig,
    options?: ModelTurnOptions,
    stream = false,
  ): Record<string, unknown> {
    const request: Record<string, unknown> = {
      input,
      model: config.model,
      instructions,
      tools: tools.length > 0 ? tools : undefined,
      store: true,
    };

    if (stream) request.stream = true;
    if (options?.conversationId) request.conversation = options.conversationId;
    if (options?.previousResponseId) request.previous_response_id = options.previousResponseId;
    if (config.temperature !== undefined) request.temperature = config.temperature;
    if (config.maxOutputTokens) request.max_output_tokens = config.maxOutputTokens;

    return request;
  }
}
