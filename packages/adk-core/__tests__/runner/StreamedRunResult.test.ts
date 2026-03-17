import { describe, it, expect } from 'vitest';
import { StreamedRunResult } from '../../src/runner/StreamedRunResult';
import type { RunStreamEvent } from '../../src/stream/runStreamEvents';

describe('StreamedRunResult', () => {
  it('starts incomplete', () => {
    const stream = new StreamedRunResult();
    expect(stream.isComplete).toBe(false);
  });

  it('result throws before close', () => {
    const stream = new StreamedRunResult();
    expect(() => stream.result).toThrow('Stream is still open');
  });

  it('push and close work', () => {
    const stream = new StreamedRunResult();
    stream.push({ type: 'agent_start', agentKey: 'a', agentName: 'A', turn: 0 });
    stream.close({ content: 'done' });
    expect(stream.isComplete).toBe(true);
    expect(stream.result.content).toBe('done');
  });

  it('push after close is ignored', () => {
    const stream = new StreamedRunResult();
    stream.close({ content: 'done' });
    stream.push({ type: 'agent_start', agentKey: 'a', agentName: 'A', turn: 0 });
    expect(stream.isComplete).toBe(true);
  });

  it('close is idempotent', () => {
    const stream = new StreamedRunResult();
    stream.close({ content: 'first' });
    stream.close({ content: 'second' });
    expect(stream.result.content).toBe('first');
  });

  it('closeWithError pushes error event and closes', () => {
    const stream = new StreamedRunResult();
    stream.closeWithError(new Error('boom'));
    expect(stream.isComplete).toBe(true);
    expect(stream.result.content).toContain('boom');
  });

  it('async iteration yields all events', async () => {
    const stream = new StreamedRunResult();
    stream.push({ type: 'agent_start', agentKey: 'a', agentName: 'A', turn: 0 });
    stream.push({ type: 'agent_end', agentKey: 'a', agentName: 'A', turn: 0 });
    stream.close({ content: 'ok' });

    const events: RunStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe('agent_start');
    expect(events[1].type).toBe('agent_end');
  });

  it('async iteration waits for new events', async () => {
    const stream = new StreamedRunResult();
    const events: RunStreamEvent[] = [];

    const iterPromise = (async () => {
      for await (const event of stream) {
        events.push(event);
      }
    })();

    await new Promise(r => setTimeout(r, 10));
    stream.push({ type: 'agent_start', agentKey: 'a', agentName: 'A', turn: 0 });
    await new Promise(r => setTimeout(r, 10));
    stream.close({ content: 'done' });

    await iterPromise;
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('agent_start');
  });
});
