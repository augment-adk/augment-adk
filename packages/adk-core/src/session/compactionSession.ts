import type { ResponsesApiInputItem } from '../types/responsesApi';
import type { Session } from './session';

/**
 * Summarizer function signature. Receives conversation items and returns a summary.
 * Implementations can use a model call, simple heuristics, or the LlamaStack
 * inference API to generate the summary.
 */
export type Summarizer = (
  items: ReadonlyArray<ResponsesApiInputItem>,
) => Promise<string>;

/**
 * Options for CompactionSession.
 */
export interface CompactionSessionOptions {
  /** The underlying session to wrap. */
  inner: Session;
  /** Maximum number of items before compaction triggers. */
  maxItems: number;
  /** Summarizer function that reduces items to a summary string. */
  summarize: Summarizer;
  /**
   * Number of recent items to preserve verbatim after compaction.
   * Defaults to 2 (keeps the latest user message and assistant reply).
   */
  preserveRecent?: number;
}

/**
 * A session wrapper that automatically compacts conversation history
 * when it exceeds a configured threshold.
 *
 * When `addItems` pushes the total item count past `maxItems`, the
 * session invokes `summarize()` on older items, replaces them with
 * a single summary message, and keeps the most recent items intact.
 *
 * Works with LlamaStack's inference API via a custom summarizer:
 * ```ts
 * const session = new CompactionSession({
 *   inner: new InMemorySession(),
 *   maxItems: 50,
 *   summarize: async (items) => {
 *     const resp = await model.chatTurn(
 *       `Summarize this conversation:\n${JSON.stringify(items)}`,
 *       'You are a summarizer. Be concise.',
 *       [], config,
 *     );
 *     return extractTextFromResponse(resp);
 *   },
 * });
 * ```
 */
export class CompactionSession implements Session {
  private readonly inner: Session;
  private readonly maxItems: number;
  private readonly summarize: Summarizer;
  private readonly preserveRecent: number;
  private compacting: Promise<void> | null = null;

  constructor(options: CompactionSessionOptions) {
    this.inner = options.inner;
    this.maxItems = options.maxItems;
    this.summarize = options.summarize;
    this.preserveRecent = options.preserveRecent ?? 2;
  }

  getSessionId(): string {
    return this.inner.getSessionId();
  }

  async getItems(): Promise<ReadonlyArray<ResponsesApiInputItem>> {
    return this.inner.getItems();
  }

  async addItems(items: ResponsesApiInputItem[]): Promise<void> {
    if (this.compacting) {
      await this.compacting;
    }

    await this.inner.addItems(items);

    const allItems = await this.inner.getItems();
    if (allItems.length <= this.maxItems) return;

    const cutoff = allItems.length - this.preserveRecent;
    if (cutoff <= 0) return;

    this.compacting = this.runCompaction([...allItems], cutoff);
    try {
      await this.compacting;
    } finally {
      this.compacting = null;
    }
  }

  private async runCompaction(
    allItems: ResponsesApiInputItem[],
    cutoff: number,
  ): Promise<void> {
    const toSummarize = allItems.slice(0, cutoff);
    const toPreserve = allItems.slice(cutoff);

    let summary: string;
    try {
      summary = await this.summarize(toSummarize);
    } catch (err) {
      // Leave session in its current (over-threshold) state rather than
      // corrupting it. The next addItems call will retry compaction.
      throw err;
    }

    const summaryItem: ResponsesApiInputItem = {
      type: 'message',
      role: 'user',
      content: `[Previous conversation summary]: ${summary}`,
    } as ResponsesApiInputItem;

    await this.inner.clearSession();
    await this.inner.addItems([summaryItem, ...toPreserve]);
  }

  async popItem(): Promise<ResponsesApiInputItem | undefined> {
    return this.inner.popItem();
  }

  async clearSession(): Promise<void> {
    return this.inner.clearSession();
  }
}
