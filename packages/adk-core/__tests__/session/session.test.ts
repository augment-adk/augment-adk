import { describe, it, expect } from 'vitest';
import { InMemorySession, ServerManagedSession } from '../../src/session/session';
import type { ResponsesApiInputItem } from '../../src/types/responsesApi';

type MessageItem = ResponsesApiInputItem & { type: 'message'; role: string; content: string };

function makeItem(role: string, content: string): MessageItem {
  return { type: 'message', role, content } as MessageItem;
}

describe('InMemorySession', () => {
  it('generates an id if none provided', () => {
    const session = new InMemorySession();
    expect(session.getSessionId()).toMatch(/^session_/);
  });

  it('uses provided id', () => {
    const session = new InMemorySession('custom-id');
    expect(session.getSessionId()).toBe('custom-id');
  });

  it('starts empty', async () => {
    const session = new InMemorySession();
    const items = await session.getItems();
    expect(items).toEqual([]);
  });

  it('adds and retrieves items', async () => {
    const session = new InMemorySession();
    const item = makeItem('user', 'hello');
    await session.addItems([item]);
    const items = await session.getItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(item);
  });

  it('getItems returns a copy', async () => {
    const session = new InMemorySession();
    await session.addItems([makeItem('user', 'a')]);
    const items = await session.getItems();
    expect(items).not.toBe(await session.getItems());
  });

  it('pops the last item', async () => {
    const session = new InMemorySession();
    await session.addItems([makeItem('user', 'a'), makeItem('assistant', 'b')]);
    const popped = await session.popItem();
    expect((popped as MessageItem).content).toBe('b');
    expect(await session.getItems()).toHaveLength(1);
  });

  it('popItem returns undefined when empty', async () => {
    const session = new InMemorySession();
    expect(await session.popItem()).toBeUndefined();
  });

  it('clearSession removes all items', async () => {
    const session = new InMemorySession();
    await session.addItems([makeItem('user', 'a')]);
    await session.clearSession();
    expect(await session.getItems()).toEqual([]);
  });
});

describe('ServerManagedSession', () => {
  it('stores conversationId', () => {
    const session = new ServerManagedSession('conv-1');
    expect(session.conversationId).toBe('conv-1');
    expect(session.getSessionId()).toContain('conv-1');
  });

  it('returns empty items', async () => {
    const session = new ServerManagedSession('conv-1');
    expect(await session.getItems()).toEqual([]);
  });

  it('addItems is a no-op', async () => {
    const session = new ServerManagedSession('conv-1');
    await session.addItems([makeItem('user', 'hi')]);
    expect(await session.getItems()).toEqual([]);
  });

  it('popItem returns undefined', async () => {
    const session = new ServerManagedSession('conv-1');
    expect(await session.popItem()).toBeUndefined();
  });

  it('clearSession is a no-op', async () => {
    const session = new ServerManagedSession('conv-1');
    await expect(session.clearSession()).resolves.toBeUndefined();
  });
});
