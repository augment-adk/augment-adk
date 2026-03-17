import { describe, it, expect } from 'vitest';
import {
  applyHandoffInputFilter,
  handoffFilters,
  promptWithHandoffInstructions,
} from '../../src/agent/handoff';
import type { AgentConfig, HandoffInputFilterContext } from '../../src/types/agentConfig';
import type { ResponsesApiInputItem } from '../../src/types/responsesApi';

interface MessageItem extends ResponsesApiInputItem {
  role: string;
  content: string;
}

interface FunctionCallOutputItem extends ResponsesApiInputItem {
  call_id: string;
  output: string;
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return { name: 'Target', instructions: 'test', ...overrides };
}

const sampleItems: ResponsesApiInputItem[] = [
  { type: 'message', role: 'user', content: 'hi' } as ResponsesApiInputItem,
  { type: 'function_call', name: 'calc', arguments: '{}' } as ResponsesApiInputItem,
  { type: 'function_call_output', call_id: 'c1', output: '42' } as ResponsesApiInputItem,
  { type: 'message', role: 'assistant', content: 'result is 42' } as ResponsesApiInputItem,
];

describe('applyHandoffInputFilter', () => {
  it('returns all items for "none" filter', () => {
    const result = applyHandoffInputFilter(sampleItems, makeConfig());
    expect(result).toHaveLength(4);
  });

  it('removes tool calls for "removeToolCalls"', () => {
    const result = applyHandoffInputFilter(
      sampleItems,
      makeConfig({ handoffInputFilter: 'removeToolCalls' }),
    );
    expect(result).toHaveLength(2);
    expect(result.every(i => i.type === 'message')).toBe(true);
  });

  it('keeps only last item for "summaryOnly"', () => {
    const result = applyHandoffInputFilter(
      sampleItems,
      makeConfig({ handoffInputFilter: 'summaryOnly' }),
    );
    expect(result).toHaveLength(1);
    expect((result[0] as MessageItem).content).toBe('result is 42');
  });

  it('supports custom function filter', () => {
    const customFilter = (items: ResponsesApiInputItem[], ctx: HandoffInputFilterContext) => {
      return items.filter(i => i.type === 'message' && (i as MessageItem).role === 'user');
    };

    const result = applyHandoffInputFilter(
      sampleItems,
      makeConfig({ handoffInputFilter: customFilter }),
    );
    expect(result).toHaveLength(1);
    expect((result[0] as MessageItem).content).toBe('hi');
  });

  it('passes context to custom function filter', () => {
    const customFilter = (items: ResponsesApiInputItem[], ctx: HandoffInputFilterContext) => {
      expect(ctx.fromAgentName).toBe('Router');
      expect(ctx.toAgentName).toBe('Target');
      expect(ctx.reason).toBe('need specialist');
      return items;
    };

    applyHandoffInputFilter(
      sampleItems,
      makeConfig({ handoffInputFilter: customFilter }),
      {
        fromAgentName: 'Router',
        toAgentName: 'Target',
        reason: 'need specialist',
      },
    );
  });
});

describe('handoffFilters', () => {
  it('removeToolCalls filters function_call and function_call_output', () => {
    const result = handoffFilters.removeToolCalls(sampleItems);
    expect(result).toHaveLength(2);
    expect(result.every(i => i.type === 'message')).toBe(true);
  });

  it('lastN keeps only last N items', () => {
    const filter = handoffFilters.lastN(2);
    const result = filter(sampleItems);
    expect(result).toHaveLength(2);
    expect((result[0] as FunctionCallOutputItem).call_id).toBe('c1');
    expect((result[1] as MessageItem).content).toBe('result is 42');
  });

  it('keepTypes filters by type', () => {
    const filter = handoffFilters.keepTypes('message');
    const result = filter(sampleItems);
    expect(result).toHaveLength(2);
  });

  it('compose chains filters sequentially', () => {
    const filter = handoffFilters.compose(
      handoffFilters.removeToolCalls,
      handoffFilters.lastN(1),
    );
    const result = filter(sampleItems);
    expect(result).toHaveLength(1);
    expect((result[0] as MessageItem).content).toBe('result is 42');
  });
});

describe('promptWithHandoffInstructions', () => {
  it('returns original instructions when no targets', () => {
    const config = makeConfig({ instructions: 'Be helpful.' });
    const result = promptWithHandoffInstructions(config, []);
    expect(result).toBe('Be helpful.');
  });

  it('appends handoff section when targets exist', () => {
    const config = makeConfig({ instructions: 'You are a router.' });
    const targets = [
      {
        key: 'engineer',
        config: makeConfig({
          name: 'Engineer',
          handoffDescription: 'Handles technical tasks',
        }),
      },
      {
        key: 'writer',
        config: makeConfig({
          name: 'Writer',
          handoffDescription: 'Writes content',
        }),
      },
    ];

    const result = promptWithHandoffInstructions(config, targets);
    expect(result).toContain('You are a router.');
    expect(result).toContain('## Available Handoffs');
    expect(result).toContain('**Engineer**');
    expect(result).toContain('transfer_to_engineer');
    expect(result).toContain('Handles technical tasks');
    expect(result).toContain('**Writer**');
    expect(result).toContain('transfer_to_writer');
  });
});
