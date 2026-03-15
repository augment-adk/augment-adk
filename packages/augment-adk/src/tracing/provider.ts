import type { TracingProcessor } from './processor';
import type { Trace } from './traces';
import { DefaultTrace, NoopTrace } from './traces';

/**
 * Global tracing provider — manages trace lifecycle and processors.
 *
 * Usage:
 * ```ts
 * import { TraceProvider, ConsoleSpanExporter, BatchTraceProcessor } from '@augment-adk/augment-adk';
 *
 * const provider = TraceProvider.getDefault();
 * provider.addProcessor(new BatchTraceProcessor(new ConsoleSpanExporter()));
 * provider.setEnabled(true);
 * ```
 */
export class TraceProvider {
  private static instance: TraceProvider | undefined;
  private processors: TracingProcessor[] = [];
  private enabled = false;

  static getDefault(): TraceProvider {
    if (!TraceProvider.instance) {
      TraceProvider.instance = new TraceProvider();
    }
    return TraceProvider.instance;
  }

  /** Reset the singleton — primarily for testing. */
  static resetForTesting(): void {
    TraceProvider.instance = undefined;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  addProcessor(processor: TracingProcessor): void {
    this.processors.push(processor);
  }

  createTrace(name: string, metadata?: Record<string, unknown>): Trace {
    if (!this.enabled) return new NoopTrace();
    return new DefaultTrace(name, metadata);
  }

  endTrace(trace: Trace): void {
    if (!this.enabled) return;
    trace.end();
    for (const processor of this.processors) {
      for (const span of trace.getSpans()) {
        processor.onSpanEnd(span);
      }
      processor.onTraceEnd(trace);
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.processors.map(p => p.shutdown()));
    this.processors = [];
  }
}
