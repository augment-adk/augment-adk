import {
  toErrorMessage,
  type Model,
  type ModelTurnOptions,
  type ILogger,
  type EffectiveConfig,
  type ResponsesApiInputItem,
  type ResponsesApiResponse,
  type ResponsesApiTool,
  type ResponsesApiFunctionTool,
  type ResponsesApiFunctionCall,
  type ResponsesApiMessage,
} from '@augment-adk/adk-core';
import { ChatCompletionsClient, type ChatCompletionsClientConfig } from './ChatCompletionsClient';

export interface ChatCompletionsModelOptions {
  clientConfig: ChatCompletionsClientConfig;
  logger?: ILogger;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

interface ChatCompletionChoice {
  index: number;
  message: {
    role: 'assistant';
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason: string;
}

interface ChatCompletionResponse {
  id: string;
  choices: ChatCompletionChoice[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
  created?: number;
}

interface ChatCompletionStreamDelta {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  model?: string;
  created?: number;
}

/**
 * Model implementation backed by the OpenAI-compatible Chat Completions API.
 *
 * Translates between the runner's Responses API interface and the
 * `/v1/chat/completions` endpoint, enabling use with any provider
 * that implements the Chat Completions spec.
 */
export class ChatCompletionsModel implements Model {
  readonly client: ChatCompletionsClient;
  private readonly logger?: ILogger;

  constructor(options: ChatCompletionsModelOptions) {
    this.client = new ChatCompletionsClient(options.clientConfig, options.logger);
    this.logger = options.logger;
  }

  async chatTurn(
    input: string | ResponsesApiInputItem[],
    instructions: string,
    tools: ResponsesApiTool[],
    config: EffectiveConfig,
    _options?: ModelTurnOptions,
  ): Promise<ResponsesApiResponse> {
    const messages = this.buildMessages(input, instructions);
    const chatTools = this.convertTools(tools);

    const request: Record<string, unknown> = {
      model: config.model,
      messages,
    };

    if (chatTools.length > 0) {
      request.tools = chatTools;
    }

    if (config.temperature !== undefined) {
      request.temperature = config.temperature;
    }
    if (config.maxOutputTokens !== undefined && config.maxOutputTokens > 0) {
      request.max_tokens = config.maxOutputTokens;
    }
    if (config.textFormat?.type === 'json_schema') {
      request.response_format = {
        type: 'json_schema',
        json_schema: config.textFormat.json_schema,
      };
    }

    this.logger?.info('[ChatCompletionsModel] chatTurn', {
      model: config.model,
      messageCount: messages.length,
      toolCount: chatTools.length,
    });

    const response = await this.client.requestWithRetry<ChatCompletionResponse>(
      '/v1/chat/completions',
      { method: 'POST', body: JSON.stringify(request) },
    );

    return this.toResponsesApiResponse(response);
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
    const messages = this.buildMessages(input, instructions);
    const chatTools = this.convertTools(tools);

    const request: Record<string, unknown> = {
      model: config.model,
      messages,
      stream: true,
    };

    if (chatTools.length > 0) {
      request.tools = chatTools;
    }

    if (config.temperature !== undefined) {
      request.temperature = config.temperature;
    }
    if (config.maxOutputTokens !== undefined && config.maxOutputTokens > 0) {
      request.max_tokens = config.maxOutputTokens;
    }

    this.logger?.info('[ChatCompletionsModel] chatTurnStream', {
      model: config.model,
      messageCount: messages.length,
      toolCount: chatTools.length,
    });

    let responseId = '';
    let accumulatedContent = '';
    const accumulatedToolCalls = new Map<number, {
      id: string;
      name: string;
      arguments: string;
    }>();

    await this.client.streamRequest(
      '/v1/chat/completions',
      request,
      (rawChunk: string) => {
        let chunk: ChatCompletionStreamDelta;
        try {
          chunk = JSON.parse(rawChunk);
        } catch {
          this.logger?.warn('[ChatCompletionsModel] Malformed JSON chunk in stream, skipping', {
            chunk: rawChunk.substring(0, 200),
          });
          return;
        }

        if (chunk.id) responseId = chunk.id;

        for (const choice of chunk.choices ?? []) {
          const delta = choice.delta;

          if (delta.content) {
            accumulatedContent += delta.content;
            const syntheticEvent = {
              type: 'response.output_text.delta',
              delta: delta.content,
            };
            onEvent(JSON.stringify(syntheticEvent));
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = accumulatedToolCalls.get(tc.index);
              if (existing) {
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                }
              } else {
                accumulatedToolCalls.set(tc.index, {
                  id: tc.id ?? `call_${tc.index}`,
                  name: tc.function?.name ?? '',
                  arguments: tc.function?.arguments ?? '',
                });
              }
            }
          }

          if (choice.finish_reason) {
            const syntheticResponse = this.buildSyntheticResponse(
              responseId,
              accumulatedContent,
              accumulatedToolCalls,
              chunk.usage,
            );
            onEvent(JSON.stringify({
              type: 'response.completed',
              response: syntheticResponse,
            }));
          }
        }
      },
      signal,
    );
  }

  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      return await this.client.testConnection();
    } catch (error) {
      return { connected: false, error: toErrorMessage(error) };
    }
  }

  private buildMessages(
    input: string | ResponsesApiInputItem[],
    instructions: string,
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    if (instructions) {
      messages.push({ role: 'system', content: instructions });
    }

    if (typeof input === 'string') {
      messages.push({ role: 'user', content: input });
    } else {
      for (const item of input) {
        switch (item.type) {
          case 'message':
            messages.push({
              role: item.role === 'assistant' ? 'assistant' : item.role === 'system' || item.role === 'developer' ? 'system' : 'user',
              content: typeof item.content === 'string' ? item.content : JSON.stringify(item.content),
            });
            break;
          case 'function_call_output':
            messages.push({
              role: 'tool',
              tool_call_id: item.call_id,
              content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
            });
            break;
          case 'item_reference':
            break;
        }
      }
    }

    return messages;
  }

  private convertTools(
    tools: ResponsesApiTool[],
  ): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean } }> {
    const chatTools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown>; strict?: boolean } }> = [];

    for (const tool of tools) {
      if (tool.type === 'function') {
        const ft = tool as ResponsesApiFunctionTool;
        chatTools.push({
          type: 'function',
          function: {
            name: ft.name,
            description: ft.description ?? '',
            parameters: ft.parameters,
            strict: ft.strict,
          },
        });
      }
    }

    return chatTools;
  }

  private toResponsesApiResponse(response: ChatCompletionResponse): ResponsesApiResponse {
    const output: (ResponsesApiMessage | ResponsesApiFunctionCall)[] = [];
    const choice = response.choices[0];

    if (!choice) {
      return {
        id: response.id,
        output: [],
        usage: response.usage
          ? {
              input_tokens: response.usage.prompt_tokens,
              output_tokens: response.usage.completion_tokens,
              total_tokens: response.usage.total_tokens,
            }
          : undefined,
        model: response.model,
        created_at: response.created,
      };
    }

    if (choice.message.content) {
      output.push({
        type: 'message',
        id: `msg_${response.id}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: choice.message.content }],
      });
    }

    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        output.push({
          type: 'function_call',
          id: tc.id,
          call_id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
          status: 'completed',
        });
      }
    }

    return {
      id: response.id,
      output,
      usage: response.usage
        ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : undefined,
      model: response.model,
      created_at: response.created,
    };
  }

  private buildSyntheticResponse(
    id: string,
    content: string,
    toolCalls: Map<number, { id: string; name: string; arguments: string }>,
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number },
  ): ResponsesApiResponse {
    const output: (ResponsesApiMessage | ResponsesApiFunctionCall)[] = [];

    if (content) {
      output.push({
        type: 'message',
        id: `msg_${id}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: content }],
      });
    }

    for (const [, tc] of toolCalls) {
      output.push({
        type: 'function_call',
        id: tc.id,
        call_id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        status: 'completed',
      });
    }

    return {
      id: id || `chatcmpl_${Date.now()}`,
      output,
      usage: usage
        ? {
            input_tokens: usage.prompt_tokens,
            output_tokens: usage.completion_tokens,
            total_tokens: usage.total_tokens,
          }
        : undefined,
    };
  }
}
