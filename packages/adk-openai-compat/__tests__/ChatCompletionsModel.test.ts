import { describe, it, expect } from 'vitest';
import { ChatCompletionsModel } from '../src/ChatCompletionsModel';

function createModel() {
  return new ChatCompletionsModel({
    clientConfig: { baseUrl: 'http://localhost:9999', token: 'test-token' },
  });
}

describe('ChatCompletionsModel', () => {
  it('builds messages from string input with system instructions', () => {
    const model = createModel();
    const messages = (model as any).buildMessages('Hello', 'Be helpful');
    expect(messages).toEqual([
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('omits system message when instructions are empty', () => {
    const model = createModel();
    const messages = (model as any).buildMessages('Hello', '');
    expect(messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('builds messages from ResponsesApiInputItem array', () => {
    const model = createModel();
    const input = [
      { type: 'message' as const, role: 'user' as const, content: 'What is 2+2?' },
      { type: 'message' as const, role: 'assistant' as const, content: '4' },
      { type: 'message' as const, role: 'user' as const, content: 'Thanks' },
    ];
    const messages = (model as any).buildMessages(input, 'You are a calculator.');
    expect(messages).toEqual([
      { role: 'system', content: 'You are a calculator.' },
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: 'Thanks' },
    ]);
  });

  it('maps function_call_output to tool messages', () => {
    const model = createModel();
    const input = [
      { type: 'function_call_output' as const, call_id: 'call_1', output: '42' },
    ];
    const messages = (model as any).buildMessages(input, '');
    expect(messages).toEqual([
      { role: 'tool', tool_call_id: 'call_1', content: '42' },
    ]);
  });

  it('skips item_reference inputs', () => {
    const model = createModel();
    const input = [
      { type: 'item_reference' as const, id: 'ref_1' },
      { type: 'message' as const, role: 'user' as const, content: 'Hello' },
    ];
    const messages = (model as any).buildMessages(input, '');
    expect(messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('converts function tools to chat completion format', () => {
    const model = createModel();
    const tools = [
      {
        type: 'function' as const,
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
        strict: true,
      },
    ];
    const converted = (model as any).convertTools(tools);
    expect(converted).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
          strict: true,
        },
      },
    ]);
  });

  it('skips non-function tools during conversion', () => {
    const model = createModel();
    const tools = [
      { type: 'web_search' as const },
      { type: 'file_search' as const, vector_store_ids: ['vs_1'] },
      { type: 'function' as const, name: 'greet', description: 'Greet', parameters: {} },
    ];
    const converted = (model as any).convertTools(tools);
    expect(converted).toHaveLength(1);
    expect(converted[0].function.name).toBe('greet');
  });

  it('converts chat completion response to ResponsesApiResponse', () => {
    const model = createModel();
    const chatResponse = {
      id: 'chatcmpl-123',
      choices: [{
        index: 0,
        message: {
          role: 'assistant' as const,
          content: 'Hello world!',
          tool_calls: undefined,
        },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      model: 'gpt-4',
    };

    const result = (model as any).toResponsesApiResponse(chatResponse);
    expect(result.id).toBe('chatcmpl-123');
    expect(result.output).toHaveLength(1);
    expect(result.output[0]).toMatchObject({
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello world!' }],
    });
    expect(result.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });

  it('converts tool calls in response', () => {
    const model = createModel();
    const chatResponse = {
      id: 'chatcmpl-456',
      choices: [{
        index: 0,
        message: {
          role: 'assistant' as const,
          content: null,
          tool_calls: [{
            id: 'call_abc',
            type: 'function' as const,
            function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    };

    const result = (model as any).toResponsesApiResponse(chatResponse);
    expect(result.output).toHaveLength(1);
    expect(result.output[0]).toMatchObject({
      type: 'function_call',
      call_id: 'call_abc',
      name: 'get_weather',
      arguments: '{"city":"Paris"}',
    });
  });

  it('handles empty choices gracefully', () => {
    const model = createModel();
    const chatResponse = { id: 'chatcmpl-empty', choices: [] };
    const result = (model as any).toResponsesApiResponse(chatResponse);
    expect(result.id).toBe('chatcmpl-empty');
    expect(result.output).toEqual([]);
  });

  it('maps developer/system roles correctly', () => {
    const model = createModel();
    const input = [
      { type: 'message' as const, role: 'developer' as const, content: 'System level instruction' },
      { type: 'message' as const, role: 'system' as const, content: 'Another system prompt' },
    ];
    const messages = (model as any).buildMessages(input, '');
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('system');
  });
});
