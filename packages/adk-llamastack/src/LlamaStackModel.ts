import {
  type Model,
  type ModelTurnOptions,
  type ILogger,
  type EffectiveConfig,
  type CapabilityInfo,
  type ResponsesApiInputItem,
  type ResponsesApiResponse,
  type ResponsesApiTool,
  toErrorMessage,
} from '@augment-adk/adk-core';
import { ResponsesApiClient, type ResponsesApiClientConfig } from './ResponsesApiClient';
import { buildTurnRequest } from './requestBuilder';
import { defaultCapabilities, mergeCapabilities } from './serverCapabilities';

export interface LlamaStackModelOptions {
  clientConfig: ResponsesApiClientConfig;
  logger?: ILogger;
  capabilities?: Partial<CapabilityInfo>;
}

/**
 * LlamaStack Responses API model implementation.
 *
 * Wraps the ResponsesApiClient with request building and
 * capability-aware parameter gating.
 */
export class LlamaStackModel implements Model {
  readonly client: ResponsesApiClient;
  private readonly logger?: ILogger;
  private capabilities: CapabilityInfo;

  constructor(options: LlamaStackModelOptions) {
    this.client = new ResponsesApiClient(options.clientConfig, options.logger);
    this.logger = options.logger;
    this.capabilities = options.capabilities
      ? mergeCapabilities(options.capabilities)
      : defaultCapabilities();
  }

  getCapabilities(): CapabilityInfo {
    return this.capabilities;
  }

  setCapabilities(caps: Partial<CapabilityInfo>): void {
    this.capabilities = mergeCapabilities(caps);
  }

  async chatTurn(
    input: string | ResponsesApiInputItem[],
    instructions: string,
    tools: ResponsesApiTool[],
    config: EffectiveConfig,
    options?: ModelTurnOptions,
  ): Promise<ResponsesApiResponse> {
    const request = buildTurnRequest(input, instructions, tools, config, this.capabilities, options);

    this.logger?.info('[LlamaStackModel] chatTurn', {
      model: config.model,
      inputType: typeof input === 'string' ? 'string' : 'items',
      toolCount: tools.length,
    });

    return this.client.requestWithRetry<ResponsesApiResponse>('/v1/responses', {
      method: 'POST',
      body: JSON.stringify(request),
    });
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
    const request = buildTurnRequest(
      input,
      instructions,
      tools,
      config,
      this.capabilities,
      { ...options, stream: true },
    );

    this.logger?.info('[LlamaStackModel] chatTurnStream', {
      model: config.model,
      inputType: typeof input === 'string' ? 'string' : 'items',
      toolCount: tools.length,
    });

    await this.client.streamRequest('/v1/responses', request, onEvent, signal);
  }

  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      return await this.client.testConnection();
    } catch (error) {
      return { connected: false, error: toErrorMessage(error) };
    }
  }
}
