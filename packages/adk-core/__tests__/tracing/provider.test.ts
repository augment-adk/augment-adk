import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TraceProvider } from '../../src/tracing/provider';
import { DefaultTrace, NoopTrace } from '../../src/tracing/traces';
import type { TracingProcessor } from '../../src/tracing/processor';

function makeProcessor(): TracingProcessor {
  return {
    onSpanEnd: vi.fn(),
    onTraceEnd: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

describe('TraceProvider', () => {
  beforeEach(() => {
    TraceProvider.resetForTesting();
  });

  it('getDefault returns a singleton', () => {
    const a = TraceProvider.getDefault();
    const b = TraceProvider.getDefault();
    expect(a).toBe(b);
  });

  it('resetForTesting clears singleton', () => {
    const a = TraceProvider.getDefault();
    TraceProvider.resetForTesting();
    const b = TraceProvider.getDefault();
    expect(a).not.toBe(b);
  });

  it('starts disabled', () => {
    const provider = TraceProvider.getDefault();
    expect(provider.isEnabled()).toBe(false);
  });

  it('setEnabled toggles enabled state', () => {
    const provider = TraceProvider.getDefault();
    provider.setEnabled(true);
    expect(provider.isEnabled()).toBe(true);
    provider.setEnabled(false);
    expect(provider.isEnabled()).toBe(false);
  });

  it('createTrace returns NoopTrace when disabled', () => {
    const provider = TraceProvider.getDefault();
    const trace = provider.createTrace('test');
    expect(trace).toBeInstanceOf(NoopTrace);
  });

  it('createTrace returns DefaultTrace when enabled', () => {
    const provider = TraceProvider.getDefault();
    provider.setEnabled(true);
    const trace = provider.createTrace('test', { key: 'val' });
    expect(trace).toBeInstanceOf(DefaultTrace);
    expect(trace.name).toBe('test');
  });

  it('endTrace does nothing when disabled', () => {
    const provider = TraceProvider.getDefault();
    const proc = makeProcessor();
    provider.addProcessor(proc);
    const trace = provider.createTrace('test');
    provider.endTrace(trace);
    expect(proc.onSpanEnd).not.toHaveBeenCalled();
    expect(proc.onTraceEnd).not.toHaveBeenCalled();
  });

  it('endTrace calls processors when enabled', () => {
    const provider = TraceProvider.getDefault();
    provider.setEnabled(true);
    const proc = makeProcessor();
    provider.addProcessor(proc);

    const trace = provider.createTrace('test');
    trace.createSpan({ kind: 'agent', name: 'root' });
    trace.createSpan({ kind: 'tool', name: 'fn' });
    provider.endTrace(trace);

    expect(proc.onSpanEnd).toHaveBeenCalledTimes(2);
    expect(proc.onTraceEnd).toHaveBeenCalledTimes(1);
    expect(proc.onTraceEnd).toHaveBeenCalledWith(trace);
  });

  it('shutdown calls all processor shutdown methods', async () => {
    const provider = TraceProvider.getDefault();
    const p1 = makeProcessor();
    const p2 = makeProcessor();
    provider.addProcessor(p1);
    provider.addProcessor(p2);

    await provider.shutdown();
    expect(p1.shutdown).toHaveBeenCalled();
    expect(p2.shutdown).toHaveBeenCalled();
  });
});
