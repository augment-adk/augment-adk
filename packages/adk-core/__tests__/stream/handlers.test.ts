import { describe, it, expect } from 'vitest';
import {
  handleResponseCreated,
  handleResponseCompleted,
  handleOutputItemAdded,
  handleOutputItemDone,
  handleContentPartDone,
  handleArgumentsDelta,
  handleMcpCallCompleted,
  handleMcpCallFailed,
  handleMcpCallRequiresApproval,
  extractResponseFailedError,
} from '../../src/stream/handlers';

describe('handleResponseCreated', () => {
  it('extracts responseId and model from response object', () => {
    const evt = handleResponseCreated({
      response: { id: 'resp-1', model: 'llama3', created_at: 1000 },
    });
    expect(evt).toEqual({
      type: 'stream.started',
      responseId: 'resp-1',
      model: 'llama3',
      createdAt: 1000,
    });
  });

  it('falls back to response_id when no response object', () => {
    const evt = handleResponseCreated({ response_id: 'resp-2' });
    expect(evt.type).toBe('stream.started');
    expect(evt).toHaveProperty('responseId', 'resp-2');
  });

  it('handles empty event', () => {
    const evt = handleResponseCreated({});
    expect(evt.type).toBe('stream.started');
    expect(evt).toHaveProperty('responseId', '');
  });
});

describe('handleResponseCompleted', () => {
  it('extracts usage from response', () => {
    const evt = handleResponseCompleted({
      response: {
        id: 'r1',
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
    });
    expect(evt.type).toBe('stream.completed');
    expect(evt).toHaveProperty('usage');
    const usage = (evt as Record<string, unknown>).usage as Record<string, unknown>;
    expect(usage.input_tokens).toBe(10);
    expect(usage.output_tokens).toBe(20);
  });

  it('returns undefined usage when response has no usage', () => {
    const evt = handleResponseCompleted({ response: { id: 'r2' } });
    expect(evt).toHaveProperty('usage', undefined);
  });

  it('handles missing response', () => {
    const evt = handleResponseCompleted({});
    expect(evt).toEqual({ type: 'stream.completed', responseId: undefined, usage: undefined });
  });
});

describe('handleOutputItemAdded', () => {
  it('returns tool.approval for mcp_approval_request items', () => {
    const events = handleOutputItemAdded({
      item: { type: 'mcp_approval_request', id: 'c1', name: 'tool_x', server_label: 'srv' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.approval');
  });

  it('returns tool.started for function_call items', () => {
    const events = handleOutputItemAdded({
      item: { type: 'function_call', id: 'c2', name: 'fn1' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.started');
  });

  it('returns tool.started for mcp_call items', () => {
    const events = handleOutputItemAdded({
      item: { type: 'mcp_call', id: 'c3', name: 'mcp_fn' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.started');
  });

  it('returns empty for unknown item types', () => {
    expect(handleOutputItemAdded({ item: { type: 'message' } })).toEqual([]);
  });

  it('returns empty when no item', () => {
    expect(handleOutputItemAdded({})).toEqual([]);
  });
});

describe('handleOutputItemDone', () => {
  it('maps file_search_call with results to rag event', () => {
    const events = handleOutputItemDone({
      item: {
        type: 'file_search_call',
        results: [{ filename: 'doc.txt', score: 0.9, text: 'hello' }],
      },
    });
    expect(events.some(e => e.type === 'stream.rag.results')).toBe(true);
  });

  it('maps function_call with output to tool.completed', () => {
    const events = handleOutputItemDone({
      item: { type: 'function_call', id: 'c1', name: 'fn1', output: 'result' },
    });
    expect(events.some(e => e.type === 'stream.tool.completed')).toBe(true);
  });

  it('maps function_call with error to tool.failed', () => {
    const events = handleOutputItemDone({
      item: { type: 'function_call', id: 'c1', name: 'fn1', error: 'boom' },
    });
    expect(events.some(e => e.type === 'stream.tool.failed')).toBe(true);
  });

  it('maps function_call_output to tool.completed', () => {
    const events = handleOutputItemDone({
      item: { type: 'function_call_output', call_id: 'c1', output: 'done' },
    });
    expect(events.some(e => e.type === 'stream.tool.completed')).toBe(true);
  });

  it('skips function_call_output without call_id', () => {
    const events = handleOutputItemDone({
      item: { type: 'function_call_output', output: 'done' },
    });
    expect(events).toHaveLength(0);
  });

  it('returns empty for no item', () => {
    expect(handleOutputItemDone({})).toEqual([]);
  });

  it('handles error as object with message', () => {
    const events = handleOutputItemDone({
      item: { type: 'mcp_call', id: 'c1', name: 'fn', error: { message: 'err msg' } },
    });
    const failed = events.find(e => e.type === 'stream.tool.failed');
    expect(failed).toBeDefined();
    expect((failed as Record<string, unknown>).error).toBe('err msg');
  });

  it('handles error as non-string non-object', () => {
    const events = handleOutputItemDone({
      item: { type: 'mcp_call', id: 'c1', name: 'fn', error: 42 },
    });
    const failed = events.find(e => e.type === 'stream.tool.failed');
    expect(failed).toBeDefined();
    expect((failed as Record<string, unknown>).error).toBe('42');
  });

  it('stringifies object output', () => {
    const events = handleOutputItemDone({
      item: { type: 'function_call', id: 'c1', name: 'fn', output: { key: 'val' } },
    });
    const completed = events.find(e => e.type === 'stream.tool.completed');
    expect(completed).toBeDefined();
    expect((completed as Record<string, unknown>).output).toContain('key');
  });
});

describe('handleContentPartDone', () => {
  it('returns text.done for output_text parts', () => {
    const events = handleContentPartDone({ part: { type: 'output_text', text: 'hello' } });
    expect(events).toEqual([{ type: 'stream.text.done', text: 'hello' }]);
  });

  it('returns empty for non-text parts', () => {
    expect(handleContentPartDone({ part: { type: 'image' } })).toEqual([]);
  });

  it('returns empty when no part', () => {
    expect(handleContentPartDone({})).toEqual([]);
  });
});

describe('handleArgumentsDelta', () => {
  it('returns tool.delta', () => {
    const events = handleArgumentsDelta({ delta: '{"x":', item_id: 'c1' });
    expect(events).toEqual([{ type: 'stream.tool.delta', callId: 'c1', delta: '{"x":' }]);
  });

  it('returns empty when delta is missing', () => {
    expect(handleArgumentsDelta({ item_id: 'c1' })).toEqual([]);
  });

  it('returns empty when item_id is missing', () => {
    expect(handleArgumentsDelta({ delta: 'x' })).toEqual([]);
  });
});

describe('handleMcpCallCompleted', () => {
  it('returns tool.completed', () => {
    const events = handleMcpCallCompleted({
      item_id: 'c1', name: 'tool', server_label: 'srv', output: 'done',
    });
    expect(events).toEqual([{
      type: 'stream.tool.completed',
      callId: 'c1',
      name: 'tool',
      serverLabel: 'srv',
      output: 'done',
    }]);
  });

  it('returns empty without item_id', () => {
    expect(handleMcpCallCompleted({})).toEqual([]);
  });
});

describe('handleMcpCallFailed', () => {
  it('sanitizes error and returns tool.failed', () => {
    const events = handleMcpCallFailed({
      item_id: 'c1', name: 'tool', error: 'something broke',
    });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.failed');
  });

  it('returns empty without item_id', () => {
    expect(handleMcpCallFailed({})).toEqual([]);
  });
});

describe('handleMcpCallRequiresApproval', () => {
  it('returns tool.approval from item_id', () => {
    const events = handleMcpCallRequiresApproval({
      item_id: 'c1', name: 'tool', server_label: 'srv',
    });
    expect(events).toEqual([{
      type: 'stream.tool.approval',
      callId: 'c1',
      name: 'tool',
      serverLabel: 'srv',
      arguments: undefined,
    }]);
  });

  it('falls back to id then call_id', () => {
    expect(handleMcpCallRequiresApproval({ id: 'c2', name: 't' })[0])
      .toHaveProperty('callId', 'c2');
    expect(handleMcpCallRequiresApproval({ call_id: 'c3', name: 't' })[0])
      .toHaveProperty('callId', 'c3');
  });

  it('returns empty without any id', () => {
    expect(handleMcpCallRequiresApproval({ name: 'tool' })).toEqual([]);
  });
});

describe('extractResponseFailedError', () => {
  it('extracts error from response.error string', () => {
    const msg = extractResponseFailedError({ response: { error: 'model down' } });
    expect(msg).toBe('model down');
  });

  it('extracts error from response.error.message', () => {
    const msg = extractResponseFailedError({ response: { error: { message: 'bad req' } } });
    expect(msg).toBe('bad req');
  });

  it('extracts from response.status_reason', () => {
    const msg = extractResponseFailedError({ response: { status_reason: 'overloaded' } });
    expect(msg).toBe('overloaded');
  });

  it('extracts from event.error string', () => {
    const msg = extractResponseFailedError({ error: 'event level error' });
    expect(msg).toBe('event level error');
  });

  it('extracts from event.error.message', () => {
    const msg = extractResponseFailedError({ error: { message: 'nested err' } });
    expect(msg).toBe('nested err');
  });

  it('extracts from event.message', () => {
    const msg = extractResponseFailedError({ message: 'top level msg' });
    expect(msg).toBe('top level msg');
  });

  it('falls back to default message', () => {
    const msg = extractResponseFailedError({});
    expect(msg).toBe('Response generation failed');
  });
});
