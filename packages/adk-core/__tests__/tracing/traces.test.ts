import { describe, it, expect } from 'vitest';
import { DefaultTrace, NoopTrace } from '../../src/tracing/traces';
import { NoopSpan } from '../../src/tracing/spans';

describe('DefaultTrace', () => {
  it('generates traceId and records startedAt', () => {
    const trace = new DefaultTrace('my-run');
    expect(trace.traceId).toBeTruthy();
    expect(trace.name).toBe('my-run');
    expect(trace.startedAt).toBeGreaterThan(0);
    expect(trace.metadata).toEqual({});
  });

  it('accepts metadata', () => {
    const trace = new DefaultTrace('run', { userId: 'u1' });
    expect(trace.metadata).toEqual({ userId: 'u1' });
  });

  it('createSpan creates and tracks spans', () => {
    const trace = new DefaultTrace('run');
    const span = trace.createSpan({ kind: 'agent', name: 'router' });
    expect(span.traceId).toBe(trace.traceId);
    expect(trace.getSpans()).toHaveLength(1);
    expect(trace.getSpans()[0]).toBe(span);
  });

  it('createSpan with parentSpanId', () => {
    const trace = new DefaultTrace('run');
    const parent = trace.createSpan({ kind: 'agent', name: 'root' });
    const child = trace.createSpan({ kind: 'tool', name: 'fn' }, parent.spanId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(trace.getSpans()).toHaveLength(2);
  });

  it('end() ends all open spans', () => {
    const trace = new DefaultTrace('run');
    const s1 = trace.createSpan({ kind: 'agent', name: 'a' });
    const s2 = trace.createSpan({ kind: 'tool', name: 'b' });
    trace.end();
    expect(s1.endedAt).toBeGreaterThan(0);
    expect(s2.endedAt).toBeGreaterThan(0);
  });

  it('end() does not re-end already ended spans', () => {
    const trace = new DefaultTrace('run');
    const s1 = trace.createSpan({ kind: 'agent', name: 'a' });
    s1.end();
    const firstEnd = s1.endedAt;
    trace.end();
    expect(s1.endedAt).toBe(firstEnd);
  });
});

describe('DefaultTrace generateTraceId fallback', () => {
  it('generates traceId via Math.random when crypto is unavailable', () => {
    const origCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const trace = new DefaultTrace('test');
      expect(trace.traceId).toBeTruthy();
      expect(trace.traceId.length).toBe(32);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: origCrypto, configurable: true });
    }
  });
});

describe('NoopTrace', () => {
  it('has empty defaults', () => {
    const trace = new NoopTrace();
    expect(trace.traceId).toBe('');
    expect(trace.name).toBe('');
    expect(trace.startedAt).toBe(0);
  });

  it('createSpan returns NoopSpan', () => {
    const trace = new NoopTrace();
    const span = trace.createSpan({ kind: 'agent', name: 'x' });
    expect(span).toBeInstanceOf(NoopSpan);
  });

  it('getSpans returns empty', () => {
    const trace = new NoopTrace();
    expect(trace.getSpans()).toEqual([]);
  });

  it('end is a no-op', () => {
    const trace = new NoopTrace();
    expect(() => trace.end()).not.toThrow();
  });
});
