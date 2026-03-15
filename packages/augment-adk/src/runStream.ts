import type { RunOptions } from './run';
import type { RunResult } from './runner/RunResult';
import { StreamedRunResult } from './runner/StreamedRunResult';
import { consoleLogger } from './logger';
import { resolveAgentGraph } from './agentGraph';
import { runLoop } from './runner/runLoop';
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
 * Note: The current implementation wraps the non-streaming
 * `runLoop` and emits the final text as a single `text_done`
 * event. Full per-token streaming will be wired when
 * `runLoop` gains a streaming path using `chatTurnStream`.
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
      result = await runLoop(userInput, snapshot, {
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
        onLifecycleEvent: event => {
          if (event.type === 'agent.start') {
            streamed.push({
              type: 'agent_start',
              agentKey: event.agentKey,
              agentName: event.agentName,
              turn: event.turn,
            });
            options.hooks?.onTurnStart?.(event.turn, event.agentKey);
          } else if (event.type === 'agent.end') {
            streamed.push({
              type: 'agent_end',
              agentKey: event.agentKey,
              agentName: event.agentName,
              turn: event.turn,
            });
          } else if (event.type === 'agent.handoff') {
            streamed.push({
              type: 'handoff_occurred',
              fromAgent: event.fromKey,
              toAgent: event.toKey,
              reason: event.reason,
            });
          }
        },
        inputFilter: options.hooks?.inputFilter,
        toolErrorFormatter: options.hooks?.toolErrorFormatter,
      });

      if (result.content) {
        streamed.push({
          type: 'text_done',
          text: result.content,
          agentKey: result.agentName ?? 'unknown',
        });
      }

      if (result.pendingApproval) {
        streamed.push({
          type: 'approval_requested',
          toolName: result.pendingApproval.toolName,
          arguments: result.pendingApproval.arguments ?? '',
          serverLabel: result.pendingApproval.serverLabel ?? '',
          approvalRequestId: result.pendingApproval.approvalRequestId ?? '',
        });
      }

      await options.hooks?.onRunEnd?.('success');
      streamed.close(result);
    } catch (error) {
      await options.hooks?.onRunEnd?.('error');
      streamed.closeWithError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  run();
  return streamed;
}
