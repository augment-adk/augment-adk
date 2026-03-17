/**
 * Span types for tracking agent execution.
 *
 * Modeled after the OpenAI Agents SDK tracing system but
 * adapted for LlamaStack Responses API workflows.
 */

export type SpanKind =
  | 'agent'
  | 'generation'
  | 'tool'
  | 'handoff'
  | 'guardrail'
  | 'mcp'
  | 'custom';

export interface SpanData {
  kind: SpanKind;
  name: string;
  agentKey?: string;
  toolName?: string;
  fromAgent?: string;
  toAgent?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly data: SpanData;
  readonly startedAt: number;
  endedAt?: number;

  setOutput(output: unknown): void;
  setError(error: string): void;
  setMetadata(key: string, value: unknown): void;
  end(): void;
}

export class DefaultSpan implements Span {
  readonly spanId: string;
  readonly traceId: string;
  readonly parentSpanId?: string;
  readonly data: SpanData;
  readonly startedAt: number;
  endedAt?: number;

  constructor(
    traceId: string,
    data: SpanData,
    parentSpanId?: string,
  ) {
    this.spanId = generateId();
    this.traceId = traceId;
    this.parentSpanId = parentSpanId;
    this.data = { ...data };
    this.startedAt = Date.now();
  }

  setOutput(output: unknown): void {
    this.data.output = output;
  }

  setError(error: string): void {
    this.data.error = error;
  }

  setMetadata(key: string, value: unknown): void {
    this.data.metadata ??= {};
    this.data.metadata[key] = value;
  }

  end(): void {
    if (!this.endedAt) {
      this.endedAt = Date.now();
    }
  }
}

export class NoopSpan implements Span {
  readonly spanId = '';
  readonly traceId = '';
  readonly parentSpanId = undefined;
  readonly data: SpanData = { kind: 'custom', name: '' };
  readonly startedAt = 0;
  endedAt = undefined;

  setOutput(): void {}
  setError(): void {}
  setMetadata(): void {}
  end(): void {}
}

function generateId(): string {
  const bytes = new Uint8Array(12);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
