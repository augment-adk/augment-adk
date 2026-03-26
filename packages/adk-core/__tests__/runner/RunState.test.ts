import { describe, it, expect } from 'vitest';
import {
  serializeRunState,
  deserializeRunState,
  createInitialState,
  createInterruptedState,
  createInterruptedStateFromResult,
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

describe('createInterruptedStateFromResult', () => {
  it('builds interrupted state from client-side pendingApprovals', () => {
    const state = createInterruptedStateFromResult({
      content: '',
      currentAgentKey: 'admin',
      responseId: 'resp-10',
      handoffPath: ['router', 'admin'],
      pendingApprovals: [
        { approvalRequestId: 'call_1', toolName: 'delete_ns', serverLabel: 'k8s-mcp', arguments: '{"ns":"prod"}' },
        { approvalRequestId: 'call_2', toolName: 'restart_pod', serverLabel: 'k8s-mcp', arguments: '{}' },
      ],
      pendingApproval: { approvalRequestId: 'call_1', toolName: 'delete_ns', serverLabel: 'k8s-mcp', arguments: '{"ns":"prod"}' },
    }, 'conv-1');

    expect(state.isInterrupted).toBe(true);
    expect(state.currentAgentKey).toBe('admin');
    expect(state.previousResponseId).toBe('resp-10');
    expect(state.conversationId).toBe('conv-1');
    expect(state.agentPath).toEqual(['router', 'admin']);
    expect(state.pendingToolCalls).toHaveLength(2);
    expect(state.pendingToolCalls[0].callId).toBe('call_1');
    expect(state.pendingToolCalls[0].name).toBe('delete_ns');
    expect(state.pendingToolCalls[0].serverId).toBe('k8s-mcp');
    expect(state.pendingToolCalls[1].callId).toBe('call_2');
    expect(state.pendingMcpApprovals).toBeUndefined();
  });

  it('builds interrupted state from server-side MCP pendingApproval', () => {
    const state = createInterruptedStateFromResult({
      content: '',
      currentAgentKey: 'eng',
      responseId: 'resp-20',
      pendingApproval: { approvalRequestId: 'apr_1', toolName: 'delete_pod', serverLabel: 'ocp-mcp', arguments: '{"pod":"web"}' },
    });

    expect(state.isInterrupted).toBe(true);
    expect(state.currentAgentKey).toBe('eng');
    expect(state.previousResponseId).toBe('resp-20');
    expect(state.pendingToolCalls).toHaveLength(0);
    expect(state.pendingMcpApprovals).toHaveLength(1);
    expect(state.pendingMcpApprovals![0].approvalRequestId).toBe('apr_1');
    expect(state.pendingMcpApprovals![0].serverLabel).toBe('ocp-mcp');
    expect(state.pendingMcpApprovals![0].name).toBe('delete_pod');
  });

  it('still marks isInterrupted when no approvals pending (caller should check for pending work)', () => {
    const state = createInterruptedStateFromResult({
      content: 'all done',
      currentAgentKey: 'agent',
      responseId: 'resp-30',
    });

    expect(state.isInterrupted).toBe(true);
    expect(state.pendingToolCalls).toHaveLength(0);
    expect(state.pendingMcpApprovals).toBeUndefined();
  });

  it('maps autoApprovedCalls into autoApprovedToolCalls for client-side approvals', () => {
    const state = createInterruptedStateFromResult({
      content: '',
      currentAgentKey: 'admin',
      responseId: 'resp-auto',
      pendingApprovals: [
        { approvalRequestId: 'c-danger', toolName: 'dangerous_tool', serverLabel: 'function', arguments: '{"x":1}' },
      ],
      pendingApproval: { approvalRequestId: 'c-danger', toolName: 'dangerous_tool', serverLabel: 'function', arguments: '{"x":1}' },
      autoApprovedCalls: [
        { callId: 'c-safe', name: 'safe_tool', arguments: '{}' },
      ],
    });

    expect(state.isInterrupted).toBe(true);
    expect(state.pendingToolCalls).toHaveLength(1);
    expect(state.pendingToolCalls[0].callId).toBe('c-danger');
    expect(state.autoApprovedToolCalls).toHaveLength(1);
    expect(state.autoApprovedToolCalls![0].callId).toBe('c-safe');
    expect(state.autoApprovedToolCalls![0].name).toBe('safe_tool');
    expect(state.autoApprovedToolCalls![0].arguments).toBe('{}');
  });

  it('does not set autoApprovedToolCalls when autoApprovedCalls is empty or absent', () => {
    const stateNoAuto = createInterruptedStateFromResult({
      content: '',
      currentAgentKey: 'admin',
      responseId: 'resp-no-auto',
      pendingApprovals: [
        { approvalRequestId: 'c1', toolName: 'tool_a', serverLabel: 'function', arguments: '{}' },
      ],
    });
    expect(stateNoAuto.autoApprovedToolCalls).toBeUndefined();

    const stateEmptyAuto = createInterruptedStateFromResult({
      content: '',
      currentAgentKey: 'admin',
      responseId: 'resp-empty-auto',
      pendingApprovals: [
        { approvalRequestId: 'c1', toolName: 'tool_a', serverLabel: 'function', arguments: '{}' },
      ],
      autoApprovedCalls: [],
    });
    expect(stateEmptyAuto.autoApprovedToolCalls).toBeUndefined();
  });
});
