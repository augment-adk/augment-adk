import { describe, it, expect, vi } from 'vitest';
import { CompactionSession } from '../../src/session/compactionSession';
import { InMemorySession } from '../../src/session/session';
import type { ResponsesApiInputItem } from '../../src/types/responsesApi';

interface MessageItem extends ResponsesApiInputItem {
  role: string;
  content: string;
}

function makeItem(role: string, content: string): ResponsesApiInputItem {
  return { type: 'message', role, content } as ResponsesApiInputItem;
}

describe('CompactionSession', () => {
  it('passes through to inner session below threshold', async () => {
    const inner = new InMemorySession('test');
    const session = new CompactionSession({
      inner,
      maxItems: 10,
      summarize: vi.fn(),
    });

    const items = [makeItem('user', 'hello'), makeItem('assistant', 'hi')];
    await session.addItems(items);

    const result = await session.getItems();
    expect(result).toHaveLength(2);
  });

  it('triggers compaction when threshold exceeded', async () => {
    const inner = new InMemorySession('test');
    const summarize = vi.fn().mockResolvedValue('Summary of conversation.');
    const session = new CompactionSession({
      inner,
      maxItems: 4,
      summarize,
      preserveRecent: 2,
    });

    await inner.addItems([
      makeItem('user', 'msg1'),
      makeItem('assistant', 'reply1'),
      makeItem('user', 'msg2'),
      makeItem('assistant', 'reply2'),
    ]);

    await session.addItems([makeItem('user', 'msg3')]);

    expect(summarize).toHaveBeenCalledTimes(1);
    const summarizeArgs = summarize.mock.calls[0][0];
    expect(summarizeArgs.length).toBe(3);

    const items = await session.getItems();
    expect(items.length).toBe(3); // summary + 2 preserved
    expect((items[0] as MessageItem).content).toContain('Summary of conversation.');
  });

  it('preserves recent items during compaction', async () => {
    const inner = new InMemorySession('test');
    const session = new CompactionSession({
      inner,
      maxItems: 3,
      summarize: vi.fn().mockResolvedValue('Summary'),
      preserveRecent: 1,
    });

    await inner.addItems([
      makeItem('user', 'old1'),
      makeItem('assistant', 'old2'),
      makeItem('user', 'recent'),
    ]);

    await session.addItems([makeItem('assistant', 'newest')]);

    const items = await session.getItems();
    const last = items[items.length - 1] as MessageItem;
    expect(last.content).toBe('newest');
  });

  it('delegates getSessionId to inner', () => {
    const inner = new InMemorySession('my-session');
    const session = new CompactionSession({
      inner,
      maxItems: 10,
      summarize: vi.fn(),
    });
    expect(session.getSessionId()).toBe('my-session');
  });

  it('delegates clearSession to inner', async () => {
    const inner = new InMemorySession('test');
    await inner.addItems([makeItem('user', 'data')]);
    const session = new CompactionSession({
      inner,
      maxItems: 10,
      summarize: vi.fn(),
    });

    await session.clearSession();
    const items = await session.getItems();
    expect(items).toHaveLength(0);
  });

  it('does not compact when exactly at threshold', async () => {
    const inner = new InMemorySession('test');
    const summarize = vi.fn();
    const session = new CompactionSession({
      inner,
      maxItems: 4,
      summarize,
    });

    await session.addItems([
      makeItem('user', 'a'),
      makeItem('assistant', 'b'),
      makeItem('user', 'c'),
      makeItem('assistant', 'd'),
    ]);

    expect(summarize).not.toHaveBeenCalled();
    const items = await session.getItems();
    expect(items).toHaveLength(4);
  });

  it('survives summarize failure without corrupting session', async () => {
    const inner = new InMemorySession('test');
    const summarize = vi.fn().mockRejectedValue(new Error('Summarizer failed'));
    const session = new CompactionSession({
      inner,
      maxItems: 3,
      summarize,
    });

    await inner.addItems([
      makeItem('user', 'a'),
      makeItem('assistant', 'b'),
      makeItem('user', 'c'),
    ]);

    await expect(session.addItems([makeItem('assistant', 'd')])).rejects.toThrow('Summarizer failed');

    const items = await session.getItems();
    expect(items).toHaveLength(4);
  });

  it('handles preserveRecent of 0', async () => {
    const inner = new InMemorySession('test');
    const summarize = vi.fn().mockResolvedValue('Everything summarized');
    const session = new CompactionSession({
      inner,
      maxItems: 2,
      summarize,
      preserveRecent: 0,
    });

    await inner.addItems([makeItem('user', 'a'), makeItem('assistant', 'b')]);
    await session.addItems([makeItem('user', 'c')]);

    expect(summarize).toHaveBeenCalledTimes(1);
    const items = await session.getItems();
    expect(items).toHaveLength(1);
    expect((items[0] as MessageItem).content).toContain('Everything summarized');
  });
});
