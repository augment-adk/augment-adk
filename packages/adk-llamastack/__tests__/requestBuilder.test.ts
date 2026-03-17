import { describe, it, expect } from 'vitest';
import { buildTurnRequest } from '../src/requestBuilder';
import type { EffectiveConfig, CapabilityInfo } from '@augment-adk/adk-core';
import { defaultCapabilities } from '../src/serverCapabilities';

function minimalConfig(overrides: Partial<EffectiveConfig> = {}): EffectiveConfig {
  return {
    model: 'test-model',
    baseUrl: 'https://api.example.com',
    systemPrompt: '',
    enableWebSearch: false,
    enableCodeInterpreter: false,
    vectorStoreIds: [],
    vectorStoreName: '',
    embeddingModel: '',
    embeddingDimension: 0,
    chunkingStrategy: 'auto',
    maxChunkSizeTokens: 0,
    chunkOverlapTokens: 0,
    skipTlsVerify: false,
    zdrMode: false,
    verboseStreamLogging: false,
    ...overrides,
  };
}

describe('buildTurnRequest', () => {
  it('builds a minimal request with string input', () => {
    const config = minimalConfig();
    const caps = defaultCapabilities();
    const result = buildTurnRequest('Hello', 'Be helpful', [], config, caps);

    expect(result.input).toBe('Hello');
    expect(result.model).toBe('test-model');
    expect(result.instructions).toBe('Be helpful');
    expect(result.tools).toBeUndefined();
    expect(result.store).toBe(true);
    expect(result.include).toBeDefined();
  });

  it('includes tools when provided', () => {
    const config = minimalConfig();
    const caps = defaultCapabilities();
    const tools = [
      {
        type: 'function' as const,
        name: 'get_weather',
        description: 'Get weather',
        parameters: { type: 'object' as const, properties: {} },
      },
    ];
    const result = buildTurnRequest('What is the weather?', 'Be helpful', tools, config, caps);

    expect(result.tools).toEqual(tools);
  });

  it('respects capability flags - omits max_output_tokens when capability is false', () => {
    const config = minimalConfig({ maxOutputTokens: 100 });
    const caps = { ...defaultCapabilities(), maxOutputTokens: false };
    const result = buildTurnRequest('Hello', '', [], config, caps);

    expect(result.max_output_tokens).toBeUndefined();
  });

  it('includes max_output_tokens when capability is true', () => {
    const config = minimalConfig({ maxOutputTokens: 100 });
    const caps = defaultCapabilities();
    const result = buildTurnRequest('Hello', '', [], config, caps);

    expect(result.max_output_tokens).toBe(100);
  });

  it('respects capability flags - omits truncation when capability is false', () => {
    const config = minimalConfig({ truncation: 'auto' });
    const caps = { ...defaultCapabilities(), truncation: false };
    const result = buildTurnRequest('Hello', '', [], config, caps);

    expect(result.truncation).toBeUndefined();
  });

  it('includes truncation when capability is true', () => {
    const config = minimalConfig({ truncation: 'auto' });
    const caps = { ...defaultCapabilities(), truncation: true };
    const result = buildTurnRequest('Hello', '', [], config, caps);

    expect(result.truncation).toBe('auto');
  });

  it('includes previous_response_id when provided in options', () => {
    const config = minimalConfig();
    const caps = defaultCapabilities();
    const result = buildTurnRequest('Hello', '', [], config, caps, {
      previousResponseId: 'resp_123',
    });

    expect(result.previous_response_id).toBe('resp_123');
  });

  it('includes conversation when conversationId provided in options', () => {
    const config = minimalConfig();
    const caps = defaultCapabilities();
    const result = buildTurnRequest('Hello', '', [], config, caps, {
      conversationId: 'conv_456',
    });

    expect(result.conversation).toBe('conv_456');
  });

  it('uses prompt when promptRef is set', () => {
    const config = minimalConfig({
      promptRef: { id: 'prompt_1', version: 2 },
    });
    const caps = defaultCapabilities();
    const result = buildTurnRequest('Hello', 'ignored', [], config, caps);

    expect(result.prompt).toEqual({ id: 'prompt_1', version: 2 });
    expect(result.instructions).toBeUndefined();
  });
});
