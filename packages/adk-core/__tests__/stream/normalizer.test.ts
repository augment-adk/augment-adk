import { describe, it, expect, vi } from 'vitest';
import { normalizeLlamaStackEvent } from '../../src/stream/normalizer';

function json(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

describe('normalizeLlamaStackEvent', () => {
  it('returns empty for invalid JSON', () => {
    expect(normalizeLlamaStackEvent('not json')).toEqual([]);
  });

  it('returns stream.error for event with error but no type', () => {
    const events = normalizeLlamaStackEvent(json({ error: 'server fail' }));
    expect(events).toEqual([{ type: 'stream.error', error: 'server fail' }]);
  });

  it('handles error object with message when no type', () => {
    const events = normalizeLlamaStackEvent(json({ error: { message: 'obj err' } }));
    expect(events).toEqual([{ type: 'stream.error', error: 'obj err' }]);
  });

  it('returns empty for event with no type and no error', () => {
    expect(normalizeLlamaStackEvent(json({}))).toEqual([]);
  });

  it('handles response.created', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.created',
      response: { id: 'r1', model: 'llama3', created_at: 100 },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.started');
  });

  it('handles response.in_progress (empty)', () => {
    const events = normalizeLlamaStackEvent(json({ type: 'response.in_progress' }));
    expect(events).toEqual([]);
  });

  it('handles response.completed', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.completed',
      response: { id: 'r1', usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 } },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.completed');
  });

  it('handles response.failed', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.failed',
      response: { error: 'model crashed' },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.error');
  });

  it('handles error event', () => {
    const events = normalizeLlamaStackEvent(json({ type: 'error', message: 'bad' }));
    expect(events).toEqual([{ type: 'stream.error', error: 'bad' }]);
  });

  it('handles error event with error string fallback', () => {
    const events = normalizeLlamaStackEvent(json({ type: 'error', error: 'err str' }));
    expect(events).toEqual([{ type: 'stream.error', error: 'err str' }]);
  });

  it('handles error event with no message or error', () => {
    const events = normalizeLlamaStackEvent(json({ type: 'error' }));
    expect(events).toEqual([{ type: 'stream.error', error: 'Unknown error' }]);
  });

  it('handles mcp_list_tools.in_progress', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.mcp_list_tools.in_progress',
      server_label: 'my-mcp',
    }));
    expect(events).toEqual([{
      type: 'stream.tool.discovery',
      serverLabel: 'my-mcp',
      status: 'in_progress',
    }]);
  });

  it('handles mcp_list_tools.completed', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.mcp_list_tools.completed',
      server_label: 'my-mcp',
      tool_count: 5,
    }));
    expect(events).toEqual([{
      type: 'stream.tool.discovery',
      serverLabel: 'my-mcp',
      status: 'completed',
      toolCount: 5,
    }]);
  });

  it('handles output_item.added', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.output_item.added',
      item: { type: 'function_call', id: 'c1', name: 'fn' },
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.started');
  });

  it('handles output_item.done', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.output_item.done',
      item: { type: 'function_call', id: 'c1', name: 'fn', output: 'ok' },
    }));
    expect(events.length).toBeGreaterThan(0);
  });

  it('handles function_call_arguments.delta', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.function_call_arguments.delta',
      delta: '{"x":',
      item_id: 'c1',
    }));
    expect(events).toEqual([{ type: 'stream.tool.delta', callId: 'c1', delta: '{"x":' }]);
  });

  it('handles mcp_call.arguments.delta', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.mcp_call.arguments.delta',
      delta: 'abc',
      item_id: 'c2',
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.delta');
  });

  it('handles mcp_call_arguments.delta (legacy)', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.mcp_call_arguments.delta',
      delta: 'x',
      item_id: 'c3',
    }));
    expect(events).toHaveLength(1);
  });

  it('handles function_call_arguments.done (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.function_call_arguments.done' }))).toEqual([]);
  });

  it('handles mcp_call.arguments.done (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.mcp_call.arguments.done' }))).toEqual([]);
  });

  it('handles mcp_call.in_progress (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.mcp_call.in_progress' }))).toEqual([]);
  });

  it('handles mcp_call.completed', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.mcp_call.completed',
      item_id: 'c1',
      name: 'tool',
      output: 'result',
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.completed');
  });

  it('handles mcp_call.failed', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.mcp_call.failed',
      item_id: 'c1',
      name: 'tool',
      error: 'broke',
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.failed');
  });

  it('handles mcp_call.requires_approval', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.mcp_call.requires_approval',
      item_id: 'c1',
      name: 'dangerous_tool',
    }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('stream.tool.approval');
  });

  it('handles content_part.added (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.content_part.added' }))).toEqual([]);
  });

  it('handles content_part.done', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.content_part.done',
      part: { type: 'output_text', text: 'hello' },
    }));
    expect(events).toEqual([{ type: 'stream.text.done', text: 'hello' }]);
  });

  it('handles output_text.delta', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.output_text.delta',
      delta: 'hi',
    }));
    expect(events).toEqual([{ type: 'stream.text.delta', delta: 'hi' }]);
  });

  it('handles output_text.delta without delta (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.output_text.delta' }))).toEqual([]);
  });

  it('handles output_text.done', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.output_text.done',
      text: 'final',
    }));
    expect(events).toEqual([{ type: 'stream.text.done', text: 'final' }]);
  });

  it('handles reasoning_text.delta', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.reasoning_text.delta',
      delta: 'thinking...',
    }));
    expect(events).toEqual([{ type: 'stream.reasoning.delta', delta: 'thinking...' }]);
  });

  it('handles reasoning_summary_text.delta', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.reasoning_summary_text.delta',
      delta: 'summary...',
    }));
    expect(events).toEqual([{ type: 'stream.reasoning.delta', delta: 'summary...' }]);
  });

  it('handles reasoning delta without delta (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.reasoning_text.delta' }))).toEqual([]);
  });

  it('handles reasoning_text.done', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.reasoning_text.done',
      text: 'done thinking',
    }));
    expect(events).toEqual([{ type: 'stream.reasoning.done', text: 'done thinking' }]);
  });

  it('handles reasoning_summary_text.done', () => {
    const events = normalizeLlamaStackEvent(json({
      type: 'response.reasoning_summary_text.done',
      text: 'summary done',
    }));
    expect(events).toEqual([{ type: 'stream.reasoning.done', text: 'summary done' }]);
  });

  it('handles reasoning_summary_part.added (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.reasoning_summary_part.added' }))).toEqual([]);
  });

  it('handles reasoning_summary_part.done (empty)', () => {
    expect(normalizeLlamaStackEvent(json({ type: 'response.reasoning_summary_part.done' }))).toEqual([]);
  });

  it('calls onUnknownEvent for unknown types', () => {
    const cb = vi.fn();
    const events = normalizeLlamaStackEvent(json({ type: 'custom.event' }), cb);
    expect(events).toEqual([]);
    expect(cb).toHaveBeenCalledWith('custom.event');
  });
});
