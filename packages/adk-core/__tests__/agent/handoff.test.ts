import { describe, it, expect } from 'vitest';
import {
  buildHandoffTool,
  buildAgentAsToolTool,
  applyHandoffInputFilter,
  nestHandoffHistory,
  parseHandoffReason,
} from '../../src/agent/handoff';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { ResponsesApiInputItem } from '../../src/types/responsesApi';

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Test Agent',
    instructions: 'You are a test agent.',
    ...overrides,
  };
}

describe('buildHandoffTool', () => {
  it('creates transfer_to_{name} tool without input schema', () => {
    const config = makeAgentConfig({
      name: 'Helper',
      handoffDescription: 'Assists users',
    });
    const tool = buildHandoffTool('helper', config);

    expect(tool.type).toBe('function');
    expect(tool.name).toBe('transfer_to_helper');
    expect(tool.description).toContain('Handoff to the Helper agent');
    expect(tool.description).toContain('Assists users');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(tool.strict).toBe(true);
  });

  it('creates transfer_to_{name} tool with input schema', () => {
    const config = makeAgentConfig({
      name: 'Specialist',
      handoffDescription: 'Expert agent',
      handoffInputSchema: {
        query: { type: 'string', description: 'User query' },
        priority: { type: 'number', description: 'Priority level' },
      },
    });
    const tool = buildHandoffTool('specialist', config);

    expect(tool.name).toBe('transfer_to_specialist');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'User query' },
        priority: { type: 'number', description: 'Priority level' },
      },
      additionalProperties: false,
    });
    expect(tool.strict).toBe(false);
  });

  it('sanitizes agent key with special characters', () => {
    const config = makeAgentConfig({ name: 'My Agent' });
    const tool = buildHandoffTool('my-agent', config);
    expect(tool.name).toBe('transfer_to_my_agent');
  });
});

describe('buildAgentAsToolTool', () => {
  it('creates call_{name} tool', () => {
    const config = makeAgentConfig({
      name: 'Calculator',
      handoffDescription: 'Performs math',
    });
    const tool = buildAgentAsToolTool('calculator', config);

    expect(tool.type).toBe('function');
    expect(tool.name).toBe('call_calculator');
    expect(tool.description).toContain('Call the Calculator agent');
    expect(tool.description).toContain('Performs math');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        input: {
          type: 'string',
          description: 'The input to send to the agent',
        },
      },
      required: ['input'],
      additionalProperties: false,
    });
    expect(tool.strict).toBe(true);
  });

  it('sanitizes agent key', () => {
    const config = makeAgentConfig({ name: 'Data Processor' });
    const tool = buildAgentAsToolTool('data-processor', config);
    expect(tool.name).toBe('call_data_processor');
  });
});

describe('applyHandoffInputFilter', () => {
  const messageItem: ResponsesApiInputItem = {
    type: 'message',
    role: 'user',
    content: 'Hello',
  };
  const functionCallOutputItem: ResponsesApiInputItem = {
    type: 'function_call_output',
    call_id: 'call_1',
    output: 'result',
  };
  const functionCallItem = {
    type: 'function_call',
    call_id: 'call_2',
    name: 'tool',
    arguments: '{}',
  } as ResponsesApiInputItem;

  it('returns all items when filter is "none"', () => {
    const input = [messageItem, functionCallOutputItem];
    const config = makeAgentConfig({ handoffInputFilter: 'none' });
    const result = applyHandoffInputFilter(input, config);
    expect(result).toEqual(input);
  });

  it('returns all items when handoffInputFilter is undefined (defaults to none)', () => {
    const input = [messageItem];
    const config = makeAgentConfig();
    const result = applyHandoffInputFilter(input, config);
    expect(result).toEqual(input);
  });

  it('removes function_call and function_call_output when filter is "removeToolCalls"', () => {
    const input = [messageItem, functionCallOutputItem, functionCallItem];
    const config = makeAgentConfig({ handoffInputFilter: 'removeToolCalls' });
    const result = applyHandoffInputFilter(input, config);
    expect(result).toEqual([messageItem]);
  });

  it('returns only last item when filter is "summaryOnly"', () => {
    const input = [messageItem, functionCallOutputItem];
    const config = makeAgentConfig({ handoffInputFilter: 'summaryOnly' });
    const result = applyHandoffInputFilter(input, config);
    expect(result).toEqual([functionCallOutputItem]);
  });
});

describe('nestHandoffHistory', () => {
  it('wraps items in handoff_context XML', () => {
    const input: ResponsesApiInputItem[] = [
      {
        type: 'function_call_output',
        call_id: 'fc_123',
        output: 'Tool result',
      },
      {
        type: 'message',
        role: 'user',
        content: 'Follow up',
      },
    ];
    const result = nestHandoffHistory(input, 'Router', 'Engineer');

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function_call_output');
    expect((result[0] as { call_id: string }).call_id).toBe('fc_123');
    const output = (result[0] as { output: string }).output;
    expect(output).toContain('<handoff_context from="Router" to="Engineer">');
    expect(output).toContain('</handoff_context>');
    expect(output).toContain('<tool_output call_id="fc_123">Tool result</tool_output>');
    expect(output).toContain('Follow up');
  });

  it('uses "handoff" as call_id when first item has no call_id', () => {
    const input: ResponsesApiInputItem[] = [
      { type: 'message', role: 'user', content: 'Hi' },
    ];
    const result = nestHandoffHistory(input, 'A', 'B');
    expect((result[0] as { call_id: string }).call_id).toBe('handoff');
  });
});

describe('parseHandoffReason', () => {
  it('parses JSON and returns reason string', () => {
    const metadata = JSON.stringify({ reason: 'User requested transfer' });
    expect(parseHandoffReason(metadata)).toBe('User requested transfer');
  });

  it('returns undefined for undefined metadata', () => {
    expect(parseHandoffReason(undefined)).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseHandoffReason('not valid json')).toBeUndefined();
  });

  it('returns undefined when reason is not a string', () => {
    expect(parseHandoffReason(JSON.stringify({ reason: 123 }))).toBeUndefined();
    expect(parseHandoffReason(JSON.stringify({ reason: null }))).toBeUndefined();
    expect(parseHandoffReason(JSON.stringify({}))).toBeUndefined();
  });
});
