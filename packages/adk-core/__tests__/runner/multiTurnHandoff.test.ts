import { describe, it, expect, vi } from 'vitest';
import { run, type RunOptions } from '../../src/run';
import { createContinuationState } from '../../src/runner/RunState';
import { noopLogger } from '../../src/logger';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { EffectiveConfig } from '../../src/types/modelConfig';
import type { Model } from '../../src/model';
import type {
  ResponsesApiResponse,
  ResponsesApiOutputEvent,
  ResponsesApiInputItem,
} from '../../src/types/responsesApi';

/**
 * Integration test: simulates the multi-turn handoff scenario where
 * a router agent hands off to a specialist, the specialist asks a
 * follow-up question, and the user responds on the next turn.
 *
 * WITHOUT the fix: the second run() would start from the router and
 * the router would handle the user's CSI number instead of the specialist.
 *
 * WITH the fix: createContinuationState(result) preserves the specialist
 * as the active agent, so the second run() starts from the specialist.
 */

function makeTextResponse(text: string, id = 'resp-1'): ResponsesApiResponse {
  return {
    id,
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    ] as ResponsesApiOutputEvent[],
  };
}

function makeHandoffResponse(targetFunctionName: string, id = 'resp-1'): ResponsesApiResponse {
  return {
    id,
    output: [
      {
        type: 'function_call',
        id: 'fc-1',
        name: `transfer_to_${targetFunctionName}`,
        arguments: '{}',
        call_id: 'fc-1',
      },
    ] as ResponsesApiOutputEvent[],
  };
}

describe('multi-turn handoff continuity', () => {
  const routerConfig: AgentConfig = {
    name: 'Router Agent',
    instructions: 'Route users to the right specialist.',
    handoffs: ['type_a_agent'],
  };

  const specialistConfig: AgentConfig = {
    name: 'Type A Agent',
    instructions: 'Handle Type A migrations. Ask for CSI number.',
  };

  const agents: Record<string, AgentConfig> = {
    router: routerConfig,
    type_a_agent: specialistConfig,
  };

  const config = { systemPrompt: '', model: 'test' } as EffectiveConfig;

  it('specialist handles follow-up when using createContinuationState', async () => {
    // --- TURN 1: "start my migration" ---
    // Router sees the request and hands off to specialist.
    // Specialist then asks "Please provide your CSI number."
    const turn1Model: Model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeHandoffResponse('type_a_agent', 'resp-turn1-handoff'))
        .mockResolvedValueOnce(makeTextResponse('Please provide your CSI number.', 'resp-turn1-ask')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ connected: true }),
    };

    const turn1Result = await run('start my migration', {
      model: turn1Model,
      agents,
      defaultAgent: 'router',
      config,
      logger: noopLogger,
    });

    // Verify: specialist responded, and currentAgentKey is the specialist
    expect(turn1Result.content).toBe('Please provide your CSI number.');
    expect(turn1Result.agentName).toBe('Type A Agent');
    expect(turn1Result.currentAgentKey).toBe('type_a_agent');
    expect(turn1Result.responseId).toBe('resp-turn1-ask');

    // --- TURN 2: "31378" (the CSI number) ---
    // Using createContinuationState, the next run starts from specialist.
    const resumeState = createContinuationState(turn1Result);

    expect(resumeState.currentAgentKey).toBe('type_a_agent');
    expect(resumeState.previousResponseId).toBe('resp-turn1-ask');

    const turn2Model: Model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeTextResponse('Got it - your CSI is 31378. Starting migration.', 'resp-turn2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ connected: true }),
    };

    const turn2Result = await run('31378', {
      model: turn2Model,
      agents,
      defaultAgent: 'router',
      config,
      logger: noopLogger,
      resumeState,
    });

    // Verify: specialist handled the follow-up, NOT the router
    expect(turn2Result.content).toBe('Got it - your CSI is 31378. Starting migration.');
    expect(turn2Result.agentName).toBe('Type A Agent');
    expect(turn2Result.currentAgentKey).toBe('type_a_agent');

    // The model was called with specialist's instructions, not router's
    const chatTurnCall = (turn2Model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    const instructionsUsed = chatTurnCall[1] as string;
    expect(instructionsUsed).toContain('Handle Type A migrations');
    expect(instructionsUsed).not.toContain('Route users');
  });

  it('WITHOUT continuity fix, router handles follow-up (demonstrating the bug)', async () => {
    // Turn 1: same as above - router hands off, specialist asks for CSI
    const turn1Model: Model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeHandoffResponse('type_a_agent', 'resp-1'))
        .mockResolvedValueOnce(makeTextResponse('Please provide your CSI number.', 'resp-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ connected: true }),
    };

    const turn1Result = await run('start my migration', {
      model: turn1Model,
      agents,
      defaultAgent: 'router',
      config,
      logger: noopLogger,
    });

    expect(turn1Result.currentAgentKey).toBe('type_a_agent');

    // Turn 2: WITHOUT using resumeState -- simulates the broken behavior
    const turn2Model: Model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeTextResponse('I can help with migrations!', 'resp-3')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ connected: true }),
    };

    const turn2Result = await run('31378', {
      model: turn2Model,
      agents,
      defaultAgent: 'router',  // no resumeState -- starts from router
      config,
      logger: noopLogger,
    });

    // The ROUTER handles it, not the specialist -- this is the bug
    expect(turn2Result.currentAgentKey).toBe('router');
    expect(turn2Result.agentName).toBe('Router Agent');

    // Router's instructions were used, not specialist's
    const chatTurnCall = (turn2Model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[0];
    const instructionsUsed = chatTurnCall[1] as string;
    expect(instructionsUsed).toContain('Route users');
  });

  it('preserves agent continuity across 3+ turns', async () => {
    // Turn 1: handoff
    const model1: Model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeHandoffResponse('type_a_agent', 'r1'))
        .mockResolvedValueOnce(makeTextResponse('What is your CSI?', 'r2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ connected: true }),
    };

    const r1 = await run('start migration', {
      model: model1, agents, defaultAgent: 'router', config, logger: noopLogger,
    });
    expect(r1.currentAgentKey).toBe('type_a_agent');

    // Turn 2: specialist continues
    let state = createContinuationState(r1);
    const model2: Model = {
      chatTurn: vi.fn().mockResolvedValueOnce(makeTextResponse('Got it. What cluster?', 'r3')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ connected: true }),
    };

    const r2 = await run('31378', {
      model: model2, agents, defaultAgent: 'router', config, logger: noopLogger,
      resumeState: state,
    });
    expect(r2.currentAgentKey).toBe('type_a_agent');
    expect(r2.agentName).toBe('Type A Agent');

    // Turn 3: specialist still active
    state = createContinuationState(r2);
    expect(state.currentAgentKey).toBe('type_a_agent');
    expect(state.previousResponseId).toBe('r3');

    const model3: Model = {
      chatTurn: vi.fn().mockResolvedValueOnce(makeTextResponse('Migration started for cluster prod-east.', 'r4')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn().mockResolvedValue({ connected: true }),
    };

    const r3 = await run('prod-east', {
      model: model3, agents, defaultAgent: 'router', config, logger: noopLogger,
      resumeState: state,
    });
    expect(r3.currentAgentKey).toBe('type_a_agent');
    expect(r3.content).toBe('Migration started for cluster prod-east.');
  });
});
