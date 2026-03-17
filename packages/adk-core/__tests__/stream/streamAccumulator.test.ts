import { describe, it, expect } from 'vitest';
import { StreamAccumulator } from '../../src/stream/streamAccumulator';

describe('StreamAccumulator', () => {
  it('accumulates response.created', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({
      type: 'response.created',
      response: { id: 'r1', model: 'llama3' },
    }));
    const resp = acc.getResponse();
    expect(resp.id).toBe('r1');
    expect(resp.model).toBe('llama3');
  });

  it('accumulates output_item.done items', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
    }));
    const resp = acc.getResponse();
    expect(resp.output).toHaveLength(1);
    expect(resp.output[0].type).toBe('message');
  });

  it('accumulates response.completed usage', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({
      type: 'response.completed',
      response: { usage: { input_tokens: 10, output_tokens: 20 } },
    }));
    const resp = acc.getResponse();
    expect(resp.usage?.input_tokens).toBe(10);
  });

  it('accumulates response.failed error', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({
      type: 'response.failed',
      response: { error: { message: 'fail', code: 'err_code' } },
    }));
    const resp = acc.getResponse();
    expect(resp.error?.message).toBe('fail');
    expect(resp.error?.code).toBe('err_code');
  });

  it('accumulates error event', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({
      type: 'error',
      error: { message: 'server error' },
    }));
    const resp = acc.getResponse();
    expect(resp.error?.message).toBe('server error');
  });

  it('ignores invalid JSON', () => {
    const acc = new StreamAccumulator();
    acc.processEvent('not json');
    const resp = acc.getResponse();
    expect(resp.id).toBe('');
    expect(resp.output).toEqual([]);
  });

  it('ignores unknown event types', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({ type: 'custom.event' }));
    const resp = acc.getResponse();
    expect(resp.output).toEqual([]);
  });

  it('reset clears all state', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({
      type: 'response.created',
      response: { id: 'r1' },
    }));
    acc.processEvent(JSON.stringify({
      type: 'response.output_item.done',
      item: { type: 'message' },
    }));
    acc.reset();
    const resp = acc.getResponse();
    expect(resp.id).toBe('');
    expect(resp.output).toEqual([]);
    expect(resp.usage).toBeUndefined();
    expect(resp.model).toBeUndefined();
    expect(resp.error).toBeUndefined();
  });

  it('getResponse is idempotent', () => {
    const acc = new StreamAccumulator();
    acc.processEvent(JSON.stringify({
      type: 'response.created',
      response: { id: 'r1' },
    }));
    const r1 = acc.getResponse();
    const r2 = acc.getResponse();
    expect(r1).toEqual(r2);
  });
});
