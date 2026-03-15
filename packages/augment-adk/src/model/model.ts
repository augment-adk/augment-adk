import type { EffectiveConfig } from '../types/modelConfig';
import type {
  ResponsesApiInputItem,
  ResponsesApiResponse,
  ResponsesApiTool,
} from '../types/responsesApi';

/**
 * Abstract model interface for the Responses API.
 *
 * The runner interacts with models exclusively through this interface,
 * making the framework model-agnostic. The built-in `LlamaStackModel`
 * is one implementation; consumers can provide their own.
 */
export interface Model {
  /**
   * Execute a single non-streaming turn against the model.
   */
  chatTurn(
    input: string | ResponsesApiInputItem[],
    instructions: string,
    tools: ResponsesApiTool[],
    config: EffectiveConfig,
    options?: ModelTurnOptions,
  ): Promise<ResponsesApiResponse>;

  /**
   * Execute a single streaming turn, emitting raw SSE event strings.
   */
  chatTurnStream(
    input: string | ResponsesApiInputItem[],
    instructions: string,
    tools: ResponsesApiTool[],
    config: EffectiveConfig,
    onEvent: (eventData: string) => void,
    options?: ModelTurnOptions,
    signal?: AbortSignal,
  ): Promise<void>;

  /**
   * Test connectivity to the model backend.
   */
  testConnection(): Promise<{ connected: boolean; error?: string }>;
}

export interface ModelTurnOptions {
  previousResponseId?: string;
  conversationId?: string;
  store?: boolean;
}

/**
 * Factory for creating Model instances from configuration.
 */
export interface ModelProvider {
  createModel(config: EffectiveConfig): Model;
}
