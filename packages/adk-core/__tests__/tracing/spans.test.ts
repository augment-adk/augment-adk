import { describe, it, expect } from 'vitest';
import { DefaultSpan, NoopSpan, type SpanData } from '../../src/tracing/spans';

function makeData(overrides?: Partial<SpanData>): SpanData {
  return { kind: 'tool', name: 'my_tool', ...overrides };
}

describe('DefaultSpan', () => {
  it('generates a spanId and records startedAt', () => {
    const span = new DefaultSpan('trace-1', makeData());
    expect(span.spanId).toBeTruthy();
    expect(span.traceId).toBe('trace-1');
    expect(span.startedAt).toBeGreaterThan(0);
    expect(span.endedAt).toBeUndefined();
    expect(span.parentSpanId).toBeUndefined();
  });

  it('accepts optional parentSpanId', () => {
    const span = new DefaultSpan('t1', makeData(), 'parent-1');
    expect(span.parentSpanId).toBe('parent-1');
  });

  it('setOutput mutates data.output', () => {
    const span = new DefaultSpan('t1', makeData());
    span.setOutput({ result: 42 });
    expect(span.data.output).toEqual({ result: 42 });
  });

  it('setError mutates data.error', () => {
    const span = new DefaultSpan('t1', makeData());
    span.setError('boom');
    expect(span.data.error).toBe('boom');
  });

  it('setMetadata initializes and sets metadata', () => {
    const span = new DefaultSpan('t1', makeData());
    span.setMetadata('key', 'val');
    expect(span.data.metadata).toEqual({ key: 'val' });
    span.setMetadata('key2', 123);
    expect(span.data.metadata).toEqual({ key: 'val', key2: 123 });
  });

  it('end() sets endedAt once', () => {
    const span = new DefaultSpan('t1', makeData());
    span.end();
    expect(span.endedAt).toBeGreaterThan(0);
    const first = span.endedAt;
    span.end();
    expect(span.endedAt).toBe(first);
  });
});

describe('DefaultSpan generateId fallback', () => {
  it('generates id via Math.random when crypto is unavailable', () => {
    const origCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const span = new DefaultSpan('t1', makeData());
      expect(span.spanId).toBeTruthy();
      expect(span.spanId.length).toBe(24);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: origCrypto, configurable: true });
    }
  });
});

describe('NoopSpan', () => {
  it('has empty defaults', () => {
    const span = new NoopSpan();
    expect(span.spanId).toBe('');
    expect(span.traceId).toBe('');
    expect(span.startedAt).toBe(0);
  });

  it('methods are no-ops', () => {
    const span = new NoopSpan();
    expect(() => {
      span.setOutput('x');
      span.setError('y');
      span.setMetadata('k', 'v');
      span.end();
    }).not.toThrow();
  });
});
