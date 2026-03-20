import { describe, it, expect } from 'vitest';
import {
  shouldStopAtToolNames,
  evaluateToolUseBehavior,
  validateOutput,
  mergeAccumulatedToolCalls,
  isContextOverflowMessage,
  extractResponseFailedMessage,
} from '../../src/runner/turnPolicy';
import type { AgentConfig, ToolUseBehaviorContext, ToolUseBehaviorToolResult } from '../../src/types/agentConfig';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: 'Test',
    instructions: 'test',
    ...overrides,
  };
}

describe('shouldStopAtToolNames', () => {
  it('returns false for no behavior set', () => {
    expect(shouldStopAtToolNames(makeConfig(), [{ name: 'foo' }])).toBe(false);
  });

  it('returns false for run_llm_again', () => {
    expect(
      shouldStopAtToolNames(makeConfig({ toolUseBehavior: 'run_llm_again' }), [{ name: 'foo' }]),
    ).toBe(false);
  });

  it('returns false for stop_on_first_tool', () => {
    expect(
      shouldStopAtToolNames(makeConfig({ toolUseBehavior: 'stop_on_first_tool' }), [{ name: 'foo' }]),
    ).toBe(false);
  });

  it('returns true for stopAtToolNames match', () => {
    expect(
      shouldStopAtToolNames(
        makeConfig({ toolUseBehavior: { stopAtToolNames: ['calc'] } }),
        [{ name: 'calc' }],
      ),
    ).toBe(true);
  });

  it('returns false for stopAtToolNames non-match', () => {
    expect(
      shouldStopAtToolNames(
        makeConfig({ toolUseBehavior: { stopAtToolNames: ['calc'] } }),
        [{ name: 'other' }],
      ),
    ).toBe(false);
  });

  it('returns false for function behavior', () => {
    expect(
      shouldStopAtToolNames(
        makeConfig({ toolUseBehavior: () => ({ isFinalOutput: true }) }),
        [{ name: 'foo' }],
      ),
    ).toBe(false);
  });
});

describe('evaluateToolUseBehavior', () => {
  const ctx = { agentName: 'Test', agentKey: 'test', turn: 0 };
  const calls = [{ name: 'calc', callId: 'c1', output: '42' }];

  it('returns not final for undefined behavior', () => {
    const result = evaluateToolUseBehavior(makeConfig(), calls, ctx);
    expect(result.isFinalOutput).toBe(false);
  });

  it('returns not final for run_llm_again', () => {
    const result = evaluateToolUseBehavior(
      makeConfig({ toolUseBehavior: 'run_llm_again' }),
      calls,
      ctx,
    );
    expect(result.isFinalOutput).toBe(false);
  });

  it('returns final for stop_on_first_tool', () => {
    const result = evaluateToolUseBehavior(
      makeConfig({ toolUseBehavior: 'stop_on_first_tool' }),
      calls,
      ctx,
    );
    expect(result.isFinalOutput).toBe(true);
    expect(result.finalOutput).toBe('42');
  });

  it('returns final for matching stopAtToolNames', () => {
    const result = evaluateToolUseBehavior(
      makeConfig({ toolUseBehavior: { stopAtToolNames: ['calc'] } }),
      calls,
      ctx,
    );
    expect(result.isFinalOutput).toBe(true);
    expect(result.finalOutput).toBe('42');
  });

  it('returns not final for non-matching stopAtToolNames', () => {
    const result = evaluateToolUseBehavior(
      makeConfig({ toolUseBehavior: { stopAtToolNames: ['other'] } }),
      calls,
      ctx,
    );
    expect(result.isFinalOutput).toBe(false);
  });

  it('delegates to custom function', () => {
    const customFn = (fnCtx: ToolUseBehaviorContext, results: ToolUseBehaviorToolResult[]) => ({
      isFinalOutput: results[0].toolName === 'calc',
      finalOutput: `Custom: ${results[0].output}`,
    });

    const result = evaluateToolUseBehavior(
      makeConfig({ toolUseBehavior: customFn }),
      calls,
      ctx,
    );
    expect(result.isFinalOutput).toBe(true);
    expect(result.finalOutput).toBe('Custom: 42');
  });

  it('custom function receives context', () => {
    const customFn = (fnCtx: ToolUseBehaviorContext) => ({
      isFinalOutput: fnCtx.agentName === 'Test' && fnCtx.turn === 0,
    });

    const result = evaluateToolUseBehavior(
      makeConfig({ toolUseBehavior: customFn }),
      calls,
      ctx,
    );
    expect(result.isFinalOutput).toBe(true);
  });

  it('joins outputs for multi-tool stop_on_first_tool', () => {
    const multiCalls = [
      { name: 'a', callId: 'c1', output: 'first' },
      { name: 'b', callId: 'c2', output: 'second' },
    ];
    const result = evaluateToolUseBehavior(
      makeConfig({ toolUseBehavior: 'stop_on_first_tool' }),
      multiCalls,
      ctx,
    );
    expect(result.isFinalOutput).toBe(true);
    expect(result.finalOutput).toBe('first\nsecond');
  });

  it('custom function that throws propagates error', () => {
    const throwingFn = () => { throw new Error('custom fn broke'); };
    expect(() =>
      evaluateToolUseBehavior(
        makeConfig({ toolUseBehavior: throwingFn }),
        calls,
        ctx,
      ),
    ).toThrow('custom fn broke');
  });

  it('returns not final for unknown behavior object', () => {
    const config = makeConfig();
    (config as Record<string, unknown>).toolUseBehavior = { unknownField: true };
    const result = evaluateToolUseBehavior(config, calls, ctx);
    expect(result.isFinalOutput).toBe(false);
  });
});

describe('validateOutput', () => {
  it('returns valid for correct JSON with required fields', () => {
    const result = validateOutput(
      '{"name":"test","value":42}',
      { name: 'TestOutput', schema: { required: ['name', 'value'] } },
    );
    expect(result.valid).toBe(true);
  });

  it('returns invalid for missing required field', () => {
    const result = validateOutput(
      '{"name":"test"}',
      { name: 'TestOutput', schema: { required: ['name', 'value'] } },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toContain('value');
  });

  it('returns invalid for non-JSON', () => {
    const result = validateOutput(
      'not json at all',
      { name: 'TestOutput', schema: { required: ['name'] } },
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Output is not valid JSON');
  });

  it('returns valid when no required fields specified', () => {
    const result = validateOutput(
      '{"anything":"goes"}',
      { name: 'TestOutput', schema: {} },
    );
    expect(result.valid).toBe(true);
  });
});

describe('mergeAccumulatedToolCalls', () => {
  it('returns result unchanged when no accumulated calls', () => {
    const result = { content: 'hello', agentName: 'A' };
    expect(mergeAccumulatedToolCalls(result, [])).toBe(result);
  });

  it('prepends accumulated tool calls', () => {
    const result = { content: 'hello', agentName: 'A', toolCalls: [{ id: 'existing', name: 'x' }] };
    const accumulated = [{ id: 'acc1', name: 'y' }];
    const merged = mergeAccumulatedToolCalls(result, accumulated as any);
    expect(merged.toolCalls).toHaveLength(2);
    expect(merged.toolCalls![0].id).toBe('acc1');
    expect(merged.toolCalls![1].id).toBe('existing');
  });
});

describe('isContextOverflowMessage', () => {
  it('detects vLLM overflow message', () => {
    expect(isContextOverflowMessage('max_tokens must be at least 1, got -123')).toBe(true);
  });

  it('returns false for unrelated messages', () => {
    expect(isContextOverflowMessage('Something else')).toBe(false);
  });
});

describe('extractResponseFailedMessage', () => {
  it('extracts from response.error.message', () => {
    const msg = extractResponseFailedMessage({
      response: { error: { message: 'Model failed' } },
    });
    expect(msg).toBe('Model failed');
  });

  it('extracts from top-level error string', () => {
    const msg = extractResponseFailedMessage({ error: 'Top-level error' });
    expect(msg).toBe('Top-level error');
  });

  it('returns undefined for no error', () => {
    const msg = extractResponseFailedMessage({ response: {} });
    expect(msg).toBeUndefined();
  });
});
