import { describe, it, expect, vi } from 'vitest';
import { BatchTraceProcessor, ConsoleSpanExporter } from '../../src/tracing/processor';
import { DefaultSpan } from '../../src/tracing/spans';
import { DefaultTrace } from '../../src/tracing/traces';

function makeSpan(): DefaultSpan {
  const span = new DefaultSpan('trace-1', { kind: 'tool', name: 'fn' });
  span.end();
  return span;
}

describe('BatchTraceProcessor', () => {
  it('buffers spans and flushes on trace end', () => {
    const exporter = { export: vi.fn() };
    const processor = new BatchTraceProcessor(exporter, { intervalMs: 999999 });

    const span = makeSpan();
    processor.onSpanEnd(span);
    expect(exporter.export).not.toHaveBeenCalled();

    processor.onTraceEnd(new DefaultTrace('test'));
    expect(exporter.export).toHaveBeenCalledTimes(1);
    expect(exporter.export).toHaveBeenCalledWith([span]);
  });

  it('flushes when maxBatchSize is reached', () => {
    const exporter = { export: vi.fn() };
    const processor = new BatchTraceProcessor(exporter, { maxBatchSize: 2, intervalMs: 999999 });

    processor.onSpanEnd(makeSpan());
    expect(exporter.export).not.toHaveBeenCalled();

    processor.onSpanEnd(makeSpan());
    expect(exporter.export).toHaveBeenCalledTimes(1);
    expect(exporter.export.mock.calls[0][0]).toHaveLength(2);
  });

  it('does not export empty buffer', () => {
    const exporter = { export: vi.fn() };
    const processor = new BatchTraceProcessor(exporter, { intervalMs: 999999 });
    processor.onTraceEnd(new DefaultTrace('test'));
    expect(exporter.export).not.toHaveBeenCalled();
  });

  it('shutdown clears timer and flushes remaining', async () => {
    const exporter = { export: vi.fn(), shutdown: vi.fn().mockResolvedValue(undefined) };
    const processor = new BatchTraceProcessor(exporter, { intervalMs: 999999 });

    processor.onSpanEnd(makeSpan());
    await processor.shutdown();

    expect(exporter.export).toHaveBeenCalledTimes(1);
    expect(exporter.shutdown).toHaveBeenCalled();
  });

  it('shutdown works without exporter.shutdown', async () => {
    const exporter = { export: vi.fn() };
    const processor = new BatchTraceProcessor(exporter, { intervalMs: 999999 });
    await processor.shutdown();
    expect(exporter.export).not.toHaveBeenCalled();
  });
});

describe('ConsoleSpanExporter', () => {
  it('logs each span to console', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exporter = new ConsoleSpanExporter();

    const span = makeSpan();
    exporter.export([span]);

    expect(spy).toHaveBeenCalledTimes(1);
    const logMessage = spy.mock.calls[0][0];
    expect(logMessage).toContain('TRACE');
    expect(logMessage).toContain('tool:fn');
    expect(logMessage).toContain('OK');
    spy.mockRestore();
  });

  it('logs ERROR status for spans with errors', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exporter = new ConsoleSpanExporter();

    const span = new DefaultSpan('t1', { kind: 'tool', name: 'fn' });
    span.setError('boom');
    span.end();
    exporter.export([span]);

    const logMessage = spy.mock.calls[0][0];
    expect(logMessage).toContain('ERROR: boom');
    spy.mockRestore();
  });

  it('handles spans without endedAt', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exporter = new ConsoleSpanExporter();
    const span = new DefaultSpan('t1', { kind: 'tool', name: 'fn' });
    exporter.export([span]);
    const logMessage = spy.mock.calls[0][0];
    expect(logMessage).toContain('0ms');
    spy.mockRestore();
  });
});
