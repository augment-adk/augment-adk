import type { ILogger } from '../logger';
import type { ResolvedAgent } from '../agentGraph';
import type { ToolResolver } from '../tools/toolResolver';
import type { OutputClassification } from './steps';
import type {
  ResponsesApiFunctionCall,
  ResponsesApiOutputEvent,
} from '../types/responsesApi';

/**
 * Strategy interface for classifying LLM output into orchestration actions.
 */
export interface OutputClassifierInterface {
  classify(
    output: ResponsesApiOutputEvent[],
    agent: ResolvedAgent,
    agents: ReadonlyMap<string, ResolvedAgent>,
    toolResolver?: ToolResolver,
  ): OutputClassification;
}

/**
 * Default classification logic.
 * Priority: handoff > agent_tool > backend_tool > final_output > continue
 */
export class DefaultOutputClassifier implements OutputClassifierInterface {
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  classify(
    output: ResponsesApiOutputEvent[],
    agent: ResolvedAgent,
    agents: ReadonlyMap<string, ResolvedAgent>,
    toolResolver?: ToolResolver,
  ): OutputClassification {
    const functionCalls = output.filter(
      (item): item is ResponsesApiFunctionCall => item.type === 'function_call',
    );

    for (const fc of functionCalls) {
      const handoffTarget = this.resolveHandoff(fc, agent, agents);
      if (handoffTarget) {
        return {
          type: 'handoff',
          targetKey: handoffTarget,
          callId: fc.call_id || fc.id,
          metadata: fc.arguments,
        };
      }

      const agentToolTarget = this.resolveAgentTool(fc, agent, agents);
      if (agentToolTarget) {
        return {
          type: 'agent_tool',
          targetKey: agentToolTarget,
          callId: fc.call_id || fc.id,
          arguments: fc.arguments,
        };
      }
    }

    const backendCalls = functionCalls.filter(
      fc => toolResolver?.isKnown(fc.name),
    );
    if (backendCalls.length > 0) {
      return {
        type: 'backend_tool',
        calls: backendCalls.map(fc => ({
          callId: fc.call_id || fc.id,
          name: fc.name,
          arguments: fc.arguments ?? '{}',
        })),
      };
    }

    const hasTextOutput = output.some(item => {
      if (item.type !== 'message') return false;
      return (item.content ?? []).some(
        c => c.type === 'output_text' && c.text,
      );
    });

    return hasTextOutput ? { type: 'final_output' } : { type: 'continue' };
  }

  private resolveHandoff(
    fc: ResponsesApiFunctionCall,
    agent: ResolvedAgent,
    agents: ReadonlyMap<string, ResolvedAgent>,
  ): string | undefined {
    for (const [key, resolved] of agents) {
      if (
        fc.name === `transfer_to_${resolved.functionName}` &&
        agent.handoffTargetKeys.has(key)
      ) {
        return key;
      }
    }
    return undefined;
  }

  private resolveAgentTool(
    fc: ResponsesApiFunctionCall,
    agent: ResolvedAgent,
    agents: ReadonlyMap<string, ResolvedAgent>,
  ): string | undefined {
    for (const [key, resolved] of agents) {
      if (
        fc.name === `call_${resolved.functionName}` &&
        agent.asToolTargetKeys.has(key)
      ) {
        return key;
      }
    }
    return undefined;
  }
}
