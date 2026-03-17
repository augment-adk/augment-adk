import type { Span } from './spans';
import type { Trace } from './traces';

/**
 * Processes completed traces and spans.
 *
 * Implementations can export data to observability platforms,
 * write to files, or forward to custom logging systems.
 */
export interface TracingProcessor {
  onSpanEnd(span: Span): void;
  onTraceEnd(trace: Trace): void;
  shutdown(): Promise<void>;
}

/**
 * Batches spans and exports them periodically or on shutdown.
 */
export class BatchTraceProcessor implements TracingProcessor {
  private readonly buffer: Span[] = [];
  private readonly exporter: SpanExporter;
  private readonly maxBatchSize: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(exporter: SpanExporter, options?: { maxBatchSize?: number; intervalMs?: number }) {
    this.exporter = exporter;
    this.maxBatchSize = options?.maxBatchSize ?? 100;
    const interval = options?.intervalMs ?? 5000;
    this.timer = setInterval(() => this.flush(), interval);
  }

  onSpanEnd(span: Span): void {
    this.buffer.push(span);
    if (this.buffer.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  onTraceEnd(_trace: Trace): void {
    this.flush();
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.flush();
    await this.exporter.shutdown?.();
  }

  private flush(): void {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);
    this.exporter.export(batch);
  }
}

/**
 * Exports spans to a destination.
 */
export interface SpanExporter {
  export(spans: ReadonlyArray<Span>): void;
  shutdown?(): Promise<void>;
}

/**
 * Simple console exporter for development/debugging.
 */
export class ConsoleSpanExporter implements SpanExporter {
  export(spans: ReadonlyArray<Span>): void {
    for (const span of spans) {
      const duration = span.endedAt ? span.endedAt - span.startedAt : 0;
      const status = span.data.error ? `ERROR: ${span.data.error}` : 'OK';
      console.log(
        `[TRACE ${span.traceId}] ${span.data.kind}:${span.data.name} (${duration}ms) ${status}`,
      );
    }
  }
}
