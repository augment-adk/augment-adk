import { describe, it, expect } from 'vitest';
import { parseStreamEvent, splitSseBuffer } from '../src/streamParser';

describe('splitSseBuffer', () => {
  it('handles single event', () => {
    const buffer = 'data: {"type":"message","id":"1"}\n';
    const result = splitSseBuffer(buffer);
    expect(result.events).toEqual(['{"type":"message","id":"1"}']);
    expect(result.remaining).toBe('');
  });

  it('handles multiple events', () => {
    const buffer = 'data: {"type":"message","id":"1"}\ndata: {"type":"message","id":"2"}\n';
    const result = splitSseBuffer(buffer);
    expect(result.events).toEqual(['{"type":"message","id":"1"}', '{"type":"message","id":"2"}']);
    expect(result.remaining).toBe('');
  });

  it('handles partial events (no trailing newlines)', () => {
    const buffer = 'data: {"type":"message","id":"1"}\ndata: {"type":"message","id":"2"}\ndata: {"type":"message","id":"3';
    const result = splitSseBuffer(buffer);
    expect(result.events).toEqual(['{"type":"message","id":"1"}', '{"type":"message","id":"2"}']);
    expect(result.remaining).toBe('data: {"type":"message","id":"3');
  });

  it('handles empty buffer', () => {
    const result = splitSseBuffer('');
    expect(result.events).toEqual([]);
    expect(result.remaining).toBe('');
  });

  it('skips [DONE] and empty data lines', () => {
    const buffer = 'data: {"type":"message","id":"1"}\ndata: [DONE]\ndata: \n';
    const result = splitSseBuffer(buffer);
    expect(result.events).toEqual(['{"type":"message","id":"1"}']);
    expect(result.remaining).toBe('');
  });

  it('ignores non-data lines', () => {
    const buffer = 'event: message\ndata: {"type":"message","id":"1"}\n';
    const result = splitSseBuffer(buffer);
    expect(result.events).toEqual(['{"type":"message","id":"1"}']);
    expect(result.remaining).toBe('');
  });
});

describe('parseStreamEvent', () => {
  it('parses valid JSON with type', () => {
    const data = '{"type":"message","id":"1","content":"hello"}';
    const result = parseStreamEvent(data);
    expect(result).toEqual({ type: 'message', id: '1', content: 'hello' });
  });

  it('parses various event types', () => {
    expect(parseStreamEvent('{"type":"message","id":"1"}')).toEqual({
      type: 'message',
      id: '1',
    });
    expect(parseStreamEvent('{"type":"function_call","name":"foo"}')).toEqual({
      type: 'function_call',
      name: 'foo',
    });
    expect(parseStreamEvent('{"type":"function_call_output","call_id":"c1"}')).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
    });
  });

  it('returns undefined for invalid JSON', () => {
    expect(parseStreamEvent('not json')).toBeUndefined();
    expect(parseStreamEvent('{invalid}')).toBeUndefined();
    expect(parseStreamEvent('')).toBeUndefined();
  });

  it('returns undefined for [DONE]', () => {
    expect(parseStreamEvent('[DONE]')).toBeUndefined();
  });

  it('parses JSON even without type field (returns as-is)', () => {
    const data = '{"foo":"bar"}';
    const result = parseStreamEvent(data);
    expect(result).toEqual({ foo: 'bar' });
  });
});
