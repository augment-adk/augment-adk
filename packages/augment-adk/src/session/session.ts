import type { ResponsesApiInputItem } from '../types/responsesApi';

/**
 * Session interface for managing conversation history.
 *
 * Implementations can store history in memory, databases,
 * or rely on server-managed conversations (LlamaStack's
 * conversationId).
 */
export interface Session {
  /** Unique session identifier. */
  getSessionId(): string;

  /** Retrieve all stored items in chronological order. */
  getItems(): Promise<ReadonlyArray<ResponsesApiInputItem>>;

  /** Append items to the session history. */
  addItems(items: ResponsesApiInputItem[]): Promise<void>;

  /** Remove and return the last item, if any. */
  popItem(): Promise<ResponsesApiInputItem | undefined>;

  /** Clear all items from the session. */
  clearSession(): Promise<void>;
}

/**
 * Simple in-memory session for development and testing.
 */
export class InMemorySession implements Session {
  private readonly id: string;
  private readonly items: ResponsesApiInputItem[] = [];

  constructor(id?: string) {
    this.id = id ?? `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  getSessionId(): string {
    return this.id;
  }

  async getItems(): Promise<ReadonlyArray<ResponsesApiInputItem>> {
    return [...this.items];
  }

  async addItems(items: ResponsesApiInputItem[]): Promise<void> {
    this.items.push(...items);
  }

  async popItem(): Promise<ResponsesApiInputItem | undefined> {
    return this.items.pop();
  }

  async clearSession(): Promise<void> {
    this.items.length = 0;
  }
}

/**
 * Server-managed session that relies on LlamaStack's
 * conversationId for history. Only stores the conversation ID.
 */
export class ServerManagedSession implements Session {
  private readonly sessionId: string;
  readonly conversationId: string;

  constructor(conversationId: string) {
    this.sessionId = `server_${conversationId}`;
    this.conversationId = conversationId;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  async getItems(): Promise<ReadonlyArray<ResponsesApiInputItem>> {
    return [];
  }

  async addItems(): Promise<void> {
    // Server manages history; no local storage needed
  }

  async popItem(): Promise<ResponsesApiInputItem | undefined> {
    return undefined;
  }

  async clearSession(): Promise<void> {
    // Server-managed; nothing to clear locally
  }
}
