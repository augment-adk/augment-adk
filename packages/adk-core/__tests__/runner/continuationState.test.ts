import { describe, it, expect } from 'vitest';
import { createContinuationState } from '../../src/runner/RunState';
import type { RunResult } from '../../src/runner/RunResult';

describe('createContinuationState', () => {
  it('builds a RunState from a completed RunResult', () => {
    const result: RunResult = {
      content: 'Hello',
      currentAgentKey: 'specialist',
      agentName: 'Specialist Agent',
      responseId: 'resp-123',
      handoffPath: ['router', 'specialist'],
    };

    const state = createContinuationState(result);

    expect(state.currentAgentKey).toBe('specialist');
    expect(state.previousResponseId).toBe('resp-123');
    expect(state.agentPath).toEqual(['router', 'specialist']);
    expect(state.isInterrupted).toBe(false);
    expect(state.pendingToolCalls).toEqual([]);
    expect(state.turn).toBe(0);
  });

  it('uses currentAgentKey as agentPath when handoffPath is absent', () => {
    const result: RunResult = {
      content: 'Hi',
      currentAgentKey: 'assistant',
      agentName: 'Assistant',
    };

    const state = createContinuationState(result);

    expect(state.currentAgentKey).toBe('assistant');
    expect(state.agentPath).toEqual(['assistant']);
  });

  it('passes conversationId when provided', () => {
    const result: RunResult = {
      content: 'Hello',
      currentAgentKey: 'agent-a',
      agentName: 'Agent A',
    };

    const state = createContinuationState(result, 'conv-456');

    expect(state.conversationId).toBe('conv-456');
  });

  it('handles missing currentAgentKey gracefully', () => {
    const result: RunResult = {
      content: 'Hello',
      agentName: 'Unknown',
    };

    const state = createContinuationState(result);

    expect(state.currentAgentKey).toBe('');
    expect(state.agentPath).toEqual([]);
  });

  it('produces a state compatible with resumeState', () => {
    const result: RunResult = {
      content: 'Done',
      currentAgentKey: 'type_a_agent',
      agentName: 'Type A Agent',
      responseId: 'resp-789',
      handoffPath: ['router', 'type_a_agent'],
    };

    const state = createContinuationState(result, 'conv-1');

    expect(state).toEqual({
      currentAgentKey: 'type_a_agent',
      turn: 0,
      previousResponseId: 'resp-789',
      conversationId: 'conv-1',
      agentPath: ['router', 'type_a_agent'],
      pendingToolCalls: [],
      isInterrupted: false,
    });
  });
});
