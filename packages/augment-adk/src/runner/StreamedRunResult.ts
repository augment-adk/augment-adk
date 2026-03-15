import type { RunResult } from './RunResult';
import type { RunStreamEvent } from '../stream/runStreamEvents';

/**
 * A streamed run result that implements `AsyncIterable<RunStreamEvent>`.
 *
 * Consumers can iterate over events as they arrive:
 *
 * ```ts
 * const streamed = await runStream('Hello', options);
 * for await (const event of streamed) {
 *   if (event.type === 'text_delta') process.stdout.write(event.delta);
 * }
 * const finalResult = streamed.result;
 * ```
 */
export class StreamedRunResult implements AsyncIterable<RunStreamEvent> {
  private readonly events: RunStreamEvent[] = [];
  private readonly waiters: Array<(done: boolean) => void> = [];
  private closed = false;
  private _result: RunResult | undefined;

  /** Push an event into the stream. */
  push(event: RunStreamEvent): void {
    if (this.closed) return;
    this.events.push(event);
    this.notifyWaiters();
  }

  /** Close the stream with a final result. */
  close(result: RunResult): void {
    if (this.closed) return;
    this._result = result;
    this.closed = true;
    this.notifyWaiters();
  }

  /** Close the stream with an error. */
  closeWithError(error: Error): void {
    this.push({ type: 'error', message: error.message });
    this.close({
      content: `Error: ${error.message}`,
    });
  }

  /**
   * The final `RunResult` — available after the stream closes.
   * Throws if the stream is still open.
   */
  get result(): RunResult {
    if (!this._result) {
      throw new Error('Stream is still open; result not yet available');
    }
    return this._result;
  }

  get isComplete(): boolean {
    return this.closed;
  }

  private cursor = 0;

  async *[Symbol.asyncIterator](): AsyncIterableIterator<RunStreamEvent> {
    while (true) {
      while (this.cursor < this.events.length) {
        yield this.events[this.cursor++];
      }
      if (this.closed) return;
      await new Promise<boolean>(resolve => this.waiters.push(resolve));
    }
  }

  private notifyWaiters(): void {
    const waiters = this.waiters.splice(0);
    for (const waiter of waiters) {
      waiter(this.closed);
    }
  }
}
