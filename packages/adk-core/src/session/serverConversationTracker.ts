import type { ResponsesApiInputItem } from '../types/responsesApi';

/**
 * Tracks which items have already been sent to the server so that
 * subsequent turns only send delta (new) items.
 *
 * When using `previousResponseId` or LlamaStack's Conversation API,
 * the server already has the full conversation history. Resending all
 * items wastes bandwidth and tokens. This tracker keeps a set of
 * already-sent item identifiers and filters them out on subsequent calls.
 */
export class ServerConversationTracker {
  private sentItemHashes = new Set<string>();
  private _previousResponseId?: string;
  private _conversationId?: string;

  get previousResponseId(): string | undefined {
    return this._previousResponseId;
  }

  get conversationId(): string | undefined {
    return this._conversationId;
  }

  /**
   * Record a response ID from the server. Subsequent calls
   * should reference this via `previousResponseId`.
   */
  recordResponse(responseId: string): void {
    this._previousResponseId = responseId;
  }

  /**
   * Set the conversation ID for server-side grouping.
   */
  setConversationId(id: string): void {
    this._conversationId = id;
  }

  /**
   * Filter items to only include those not yet sent to the server.
   * Mark the remaining items as sent.
   *
   * For the first turn (no previousResponseId), returns all items.
   */
  filterDelta(items: ResponsesApiInputItem[]): ResponsesApiInputItem[] {
    if (!this._previousResponseId) {
      this.markSent(items);
      return items;
    }

    const delta = items.filter(item => {
      const hash = hashItem(item);
      return !this.sentItemHashes.has(hash);
    });

    this.markSent(delta);
    return delta;
  }

  /**
   * Mark items as already sent to the server.
   */
  private markSent(items: ResponsesApiInputItem[]): void {
    for (const item of items) {
      this.sentItemHashes.add(hashItem(item));
    }
  }

  /**
   * Reset the tracker (e.g. when starting a new conversation).
   */
  reset(): void {
    this.sentItemHashes.clear();
    this._previousResponseId = undefined;
    this._conversationId = undefined;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map(k =>
    JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]),
  ).join(',') + '}';
}

function hashItem(item: ResponsesApiInputItem): string {
  return stableStringify(item);
}
