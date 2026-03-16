import { describe, it, expect } from 'vitest';
import { DefaultOutputClassifier } from './runner/outputClassifier';
import { RunContext } from './runner/RunContext';
import { createInitialState, serializeRunState, deserializeRunState } from './runner/RunState';
import type { ResponsesApiOutputEvent } from './types/responsesApi';
import { noopLogger } from './logger';

describe('MCP approval request classification', () => {
  const classifier = new DefaultOutputClassifier(noopLogger);
  const emptyAgents = new Map();
  const emptyAgent = {
    key: 'test',
    config: { name: 'Test', instructions: '' },
    functionName: 'test',
    handoffTools: [],
    agentAsToolTools: [],
    handoffTargetKeys: new Set<string>(),
    asToolTargetKeys: new Set<string>(),
  };

  it('classifies mcp_approval_request events', () => {
    const output: ResponsesApiOutputEvent[] = [
      {
        type: 'mcp_approval_request',
        id: 'apr_123',
        server_label: 'ocp-mcp',
        method: 'tools/call',
        params: { name: 'delete_pod', arguments: { pod: 'test-pod' } },
      },
    ];

    const result = classifier.classify(output, emptyAgent, emptyAgents);
    expect(result.type).toBe('mcp_approval_request');
    if (result.type === 'mcp_approval_request') {
      expect(result.approvalRequestId).toBe('apr_123');
      expect(result.serverLabel).toBe('ocp-mcp');
      expect(result.method).toBe('tools/call');
      expect(result.params).toEqual({ name: 'delete_pod', arguments: { pod: 'test-pod' } });
    }
  });

  it('prioritizes mcp_approval_request over function_call', () => {
    const output: ResponsesApiOutputEvent[] = [
      {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'fc_1',
        name: 'some_tool',
        arguments: '{}',
      },
      {
        type: 'mcp_approval_request',
        id: 'apr_456',
        server_label: 'test-server',
        method: 'tools/call',
      },
    ];

    const result = classifier.classify(output, emptyAgent, emptyAgents);
    expect(result.type).toBe('mcp_approval_request');
  });

  it('falls through to function_call when no approval request', () => {
    const output: ResponsesApiOutputEvent[] = [
      {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: 'Hello' }],
      },
    ];

    const result = classifier.classify(output, emptyAgent, emptyAgents);
    expect(result.type).toBe('final_output');
  });
});

describe('RunContext approval helpers', () => {
  it('records approval decisions', () => {
    const ctx = new RunContext({ userQuery: 'test' });

    ctx.approveTool('call_1', 'Approved by admin');
    ctx.rejectTool('call_2', 'Too dangerous');

    expect(ctx.toolApprovalDecisions).toHaveLength(2);
    expect(ctx.toolApprovalDecisions[0]).toEqual({
      callId: 'call_1', approved: true, reason: 'Approved by admin',
    });
    expect(ctx.toolApprovalDecisions[1]).toEqual({
      callId: 'call_2', approved: false, reason: 'Too dangerous',
    });
  });

  it('builds function_call_output items from approved decisions only', () => {
    const ctx = new RunContext({ userQuery: 'test' });
    ctx.approveTool('call_1', 'OK');
    ctx.rejectTool('call_2');
    ctx.approveTool('call_3');

    const outputs = ctx.buildApprovalOutputItems();
    expect(outputs).toHaveLength(2);
    expect(outputs[0].call_id).toBe('call_1');
    expect(outputs[0].output).toBe('OK');
    expect(outputs[1].call_id).toBe('call_3');
    expect(outputs[1].output).toBe('Approved by human.');
  });

  it('builds MCP approval responses from all decisions', () => {
    const ctx = new RunContext({ userQuery: 'test' });
    ctx.approveTool('apr_1');
    ctx.rejectTool('apr_2', 'Denied');

    const responses = ctx.buildMcpApprovalResponses();
    expect(responses).toHaveLength(2);
    expect(responses[0]).toEqual({
      type: 'mcp_approval_response',
      approval_request_id: 'apr_1',
      approve: true,
      reason: undefined,
    });
    expect(responses[1]).toEqual({
      type: 'mcp_approval_response',
      approval_request_id: 'apr_2',
      approve: false,
      reason: 'Denied',
    });
  });
});

describe('RunState serialization', () => {
  it('round-trips through serialize/deserialize', () => {
    const state = createInitialState('router', 'conv_123', 'resp_456');

    const json = serializeRunState(state);
    const restored = deserializeRunState(json);

    expect(restored).toEqual(state);
    expect(restored.currentAgentKey).toBe('router');
    expect(restored.conversationId).toBe('conv_123');
    expect(restored.previousResponseId).toBe('resp_456');
    expect(restored.isInterrupted).toBe(false);
    expect(restored.pendingToolCalls).toEqual([]);
  });

  it('preserves pending MCP approvals through serialization', () => {
    const state = createInitialState('agent');
    state.isInterrupted = true;
    state.pendingMcpApprovals = [
      {
        approvalRequestId: 'apr_1',
        serverLabel: 'ocp-mcp',
        method: 'tools/call',
        params: { name: 'delete_ns' },
      },
    ];

    const json = serializeRunState(state);
    const restored = deserializeRunState(json);

    expect(restored.pendingMcpApprovals).toHaveLength(1);
    expect(restored.pendingMcpApprovals![0].approvalRequestId).toBe('apr_1');
    expect(restored.pendingMcpApprovals![0].params).toEqual({ name: 'delete_ns' });
  });

  it('serializes to valid JSON string', () => {
    const state = createInitialState('test');
    const json = serializeRunState(state);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
