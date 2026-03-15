import { DefaultSpan, NoopSpan, type Span, type SpanData } from './spans';

/**
 * A trace represents a complete agent run.
 * Contains a tree of spans tracking the execution.
 */
export interface Trace {
  readonly traceId: string;
  readonly name: string;
  readonly startedAt: number;
  readonly metadata: Record<string, unknown>;

  createSpan(data: SpanData, parentSpanId?: string): Span;
  end(): void;
  getSpans(): ReadonlyArray<Span>;
}

export class DefaultTrace implements Trace {
  readonly traceId: string;
  readonly name: string;
  readonly startedAt: number;
  readonly metadata: Record<string, unknown>;
  private readonly spans: Span[] = [];

  constructor(name: string, metadata?: Record<string, unknown>) {
    this.traceId = generateTraceId();
    this.name = name;
    this.startedAt = Date.now();
    this.metadata = { ...metadata };
  }

  createSpan(data: SpanData, parentSpanId?: string): Span {
    const span = new DefaultSpan(this.traceId, data, parentSpanId);
    this.spans.push(span);
    return span;
  }

  end(): void {
    for (const span of this.spans) {
      if (!span.endedAt) span.end();
    }
  }

  getSpans(): ReadonlyArray<Span> {
    return this.spans;
  }
}

export class NoopTrace implements Trace {
  readonly traceId = '';
  readonly name = '';
  readonly startedAt = 0;
  readonly metadata = {};

  createSpan(): Span {
    return new NoopSpan();
  }

  end(): void {}
  getSpans(): ReadonlyArray<Span> {
    return [];
  }
}

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
