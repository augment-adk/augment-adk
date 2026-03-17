import { describe, it, expect, vi } from 'vitest';
import { tool, toApiTool, type FunctionTool } from '../../src/tools/tool';

describe('tool', () => {
  it('wraps a definition into a FunctionTool with type function', () => {
    const execute = vi.fn().mockResolvedValue('ok');
    const ft = tool({
      name: 'greet',
      description: 'Greet someone',
      parameters: { type: 'object', properties: { name: { type: 'string' } } },
      execute,
    });

    expect(ft.type).toBe('function');
    expect(ft.name).toBe('greet');
    expect(ft.description).toBe('Greet someone');
    expect(ft.parameters).toEqual({ type: 'object', properties: { name: { type: 'string' } } });
    expect(ft.execute).toBe(execute);
  });

  it('passes through strict field', () => {
    const ft = tool({
      name: 'a',
      description: 'b',
      parameters: {},
      strict: true,
      execute: async () => '',
    });
    expect(ft.strict).toBe(true);
  });

  it('strict defaults to undefined when not provided', () => {
    const ft = tool({
      name: 'a',
      description: 'b',
      parameters: {},
      execute: async () => '',
    });
    expect(ft.strict).toBeUndefined();
  });
});

describe('toApiTool', () => {
  it('returns schema without execute handler', () => {
    const ft: FunctionTool = {
      type: 'function',
      name: 'greet',
      description: 'Greet',
      parameters: { type: 'object' },
      strict: true,
      execute: async () => 'hi',
    };
    const api = toApiTool(ft);
    expect(api).toEqual({
      type: 'function',
      name: 'greet',
      description: 'Greet',
      parameters: { type: 'object' },
      strict: true,
    });
    expect(api).not.toHaveProperty('execute');
  });
});
