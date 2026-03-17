import { describe, it, expect } from 'vitest';
import { ServerConversationTracker } from '../../src/session/serverConversationTracker';
import type { ResponsesApiInputItem } from '../../src/types/responsesApi';

interface MessageItem extends ResponsesApiInputItem {
  role: string;
  content: string;
}

function makeItem(role: string, content: string): ResponsesApiInputItem {
  return { type: 'message', role, content } as ResponsesApiInputItem;
}

describe('ServerConversationTracker', () => {
  it('returns all items on first call (no previousResponseId)', () => {
    const tracker = new ServerConversationTracker();
    const items = [makeItem('user', 'hello'), makeItem('assistant', 'hi')];
    const delta = tracker.filterDelta(items);
    expect(delta).toHaveLength(2);
  });

  it('filters out already-sent items after recording response', () => {
    const tracker = new ServerConversationTracker();
    const items1 = [makeItem('user', 'hello')];
    tracker.filterDelta(items1);
    tracker.recordResponse('resp-1');

    const items2 = [makeItem('user', 'hello'), makeItem('user', 'how are you')];
    const delta = tracker.filterDelta(items2);
    expect(delta).toHaveLength(1);
    expect((delta[0] as MessageItem).content).toBe('how are you');
  });

  it('tracks previousResponseId', () => {
    const tracker = new ServerConversationTracker();
    expect(tracker.previousResponseId).toBeUndefined();
    tracker.recordResponse('resp-1');
    expect(tracker.previousResponseId).toBe('resp-1');
    tracker.recordResponse('resp-2');
    expect(tracker.previousResponseId).toBe('resp-2');
  });

  it('tracks conversationId', () => {
    const tracker = new ServerConversationTracker();
    expect(tracker.conversationId).toBeUndefined();
    tracker.setConversationId('conv-1');
    expect(tracker.conversationId).toBe('conv-1');
  });

  it('reset clears all state', () => {
    const tracker = new ServerConversationTracker();
    tracker.filterDelta([makeItem('user', 'hi')]);
    tracker.recordResponse('resp-1');
    tracker.setConversationId('conv-1');

    tracker.reset();
    expect(tracker.previousResponseId).toBeUndefined();
    expect(tracker.conversationId).toBeUndefined();

    const items = [makeItem('user', 'hi')];
    const delta = tracker.filterDelta(items);
    expect(delta).toHaveLength(1);
  });

  it('handles empty input', () => {
    const tracker = new ServerConversationTracker();
    tracker.recordResponse('resp-1');
    const delta = tracker.filterDelta([]);
    expect(delta).toHaveLength(0);
  });

  it('deduplicates identical items', () => {
    const tracker = new ServerConversationTracker();
    const item = makeItem('user', 'repeated');
    tracker.filterDelta([item]);
    tracker.recordResponse('resp-1');

    const delta = tracker.filterDelta([item, item, makeItem('user', 'new')]);
    expect(delta).toHaveLength(1);
    expect((delta[0] as MessageItem).content).toBe('new');
  });

  it('treats objects with different key order as identical', () => {
    const tracker = new ServerConversationTracker();
    const item1 = { type: 'message', role: 'user', content: 'hi' } as ResponsesApiInputItem;
    const item2 = { content: 'hi', type: 'message', role: 'user' } as ResponsesApiInputItem;

    tracker.filterDelta([item1]);
    tracker.recordResponse('resp-1');

    const delta = tracker.filterDelta([item2]);
    expect(delta).toHaveLength(0);
  });
});
