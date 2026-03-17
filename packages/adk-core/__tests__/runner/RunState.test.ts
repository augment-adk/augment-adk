import { describe, it, expect } from 'vitest';
import {
  serializeRunState,
  deserializeRunState,
  createInitialState,
  createInterruptedState,
  type RunState,
} from '../../src/runner/RunState';

describe('serializeRunState / deserializeRunState', () => {
  it('round-trips a RunState', () => {
    const state: RunState = {
      currentAgentKey: 'router',
      turn: 3,
      previousResponseId: 'resp-1',
      conversationId: 'conv-1',
      agentPath: ['router', 'engineer'],
      pendingToolCalls: [
        {
          callId: 'call-1',
          name: 'tool_a',
          arguments: '{}',
          serverId: 's1',
          serverUrl: 'http://s1',
          originalToolName: 'tool_a',
        },
      ],
      isInterrupted: true,
    };
    const json = serializeRunState(state);
    const restored = deserializeRunState(json);
    expect(restored).toEqual(state);
  });
});

describe('createInitialState', () => {
  it('creates a default initial state', () => {
    const state = createInitialState('router');
    expect(state.currentAgentKey).toBe('router');
    expect(state.turn).toBe(0);
    expect(state.agentPath).toEqual([]);
    expect(state.pendingToolCalls).toEqual([]);
    expect(state.isInterrupted).toBe(false);
    expect(state.previousResponseId).toBeUndefined();
    expect(state.conversationId).toBeUndefined();
  });

  it('accepts optional conversationId and previousResponseId', () => {
    const state = createInitialState('router', 'conv-1', 'resp-0');
    expect(state.conversationId).toBe('conv-1');
    expect(state.previousResponseId).toBe('resp-0');
  });
});

describe('createInterruptedState', () => {
  it('creates an interrupted state with pending calls', () => {
    const pending = [
      {
        callId: 'c1',
        name: 'tool',
        arguments: '{"x":1}',
        serverId: 's1',
        serverUrl: '',
        originalToolName: 'tool',
      },
    ];
    const state = createInterruptedState('eng', 2, pending, 'resp-2', 'conv-1', ['router', 'eng']);
    expect(state.currentAgentKey).toBe('eng');
    expect(state.turn).toBe(2);
    expect(state.isInterrupted).toBe(true);
    expect(state.pendingToolCalls).toEqual(pending);
    expect(state.previousResponseId).toBe('resp-2');
    expect(state.conversationId).toBe('conv-1');
    expect(state.agentPath).toEqual(['router', 'eng']);
  });

  it('defaults agentPath to empty array', () => {
    const state = createInterruptedState('eng', 0, []);
    expect(state.agentPath).toEqual([]);
  });
});
