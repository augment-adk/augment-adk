import type { RunOptions } from './run';
import type { RunResult } from './runner/RunResult';
import { StreamedRunResult } from './runner/StreamedRunResult';
import { consoleLogger } from './logger';
import { resolveAgentGraph } from './agentGraph';
import { runLoopStream } from './runner/runLoopStream';
import { defaultCapabilities } from './model/llamastack/serverCapabilities';

/**
 * Extended options for `runStream()` — same as `RunOptions`
 * plus an optional `AbortSignal`.
 */
export interface RunStreamOptions extends RunOptions {
  signal?: AbortSignal;
}

/**
 * Top-level entry point for a streamed multi-agent run.
 *
 * Returns a `StreamedRunResult` that can be iterated over
 * as events arrive:
 *
 * ```ts
 * import { runStream } from '@augment-adk/augment-adk';
 *
 * const stream = runStream('List all namespaces', {
 *   model, agents, defaultAgent: 'router', config,
 * });
 *
 * for await (const event of stream) {
 *   if (event.type === 'text_delta') {
 *     process.stdout.write(event.delta);
 *   }
 * }
 *
 * console.log(stream.result.content);
 * ```
 *
 * Uses `chatTurnStream` for real per-token streaming. Each raw
 * SSE event from the model is emitted as a `raw_model_event`,
 * while orchestration events (tool execution, handoffs) are
 * emitted as typed `RunStreamEvent` objects.
 */
export function runStream(
  userInput: string,
  options: RunStreamOptions,
): StreamedRunResult {
  const streamed = new StreamedRunResult();

  const run = async (): Promise<void> => {
    const logger = options.logger ?? consoleLogger;
    const { ToolResolver: TR } = await import('./tools/toolResolver');
    const toolResolver = options.toolResolver ?? new TR(logger);
    const caps = options.capabilities ?? defaultCapabilities();

    const snapshot = resolveAgentGraph(
      options.agents,
      options.defaultAgent,
      options.maxAgentTurns,
      logger,
    );

    if (options.signal?.aborted) {
      streamed.closeWithError(new Error('Aborted'));
      return;
    }

    await options.hooks?.onRunStart?.();

    let result: RunResult;

    try {
      result = await runLoopStream(userInput, snapshot, {
        model: options.model,
        config: options.config,
        mcpServers: options.mcpServers ?? [],
        toolResolver,
        mcpToolManager: options.mcpToolManager,
        toolScopeProvider: options.toolScopeProvider,
        functionTools: options.functionTools,
        capabilities: caps,
        approvalStore: options.approvalStore,
        logger,
        inputFilter: options.hooks?.inputFilter,
        toolErrorFormatter: options.hooks?.toolErrorFormatter,
        signal: options.signal,
        onStreamEvent: event => streamed.push(event),
      });

      await options.hooks?.onRunEnd?.('success');
      streamed.close(result);
    } catch (error) {
      await options.hooks?.onRunEnd?.('error');
      streamed.closeWithError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  run().catch(() => {
    // Error is already forwarded via streamed.closeWithError; prevent unhandled-rejection warnings
  });
  return streamed;
}
