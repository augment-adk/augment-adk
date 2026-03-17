import { describe, it, expect } from 'vitest';
import { RunContext } from '../../src/runner/RunContext';

describe('RunContext', () => {
  describe('fork', () => {
    it('creates independent context', () => {
      const parent = new RunContext({
        userQuery: 'original query',
        previousResponseId: 'resp-1',
        conversationId: 'conv-1',
      });
      parent.agentPath.push('agent-a', 'agent-b');
      parent.markToolUsed('agent-a');

      const child = parent.fork();

      expect(child.userQuery).toBe('original query');
      expect(child.previousResponseId).toBeUndefined();
      expect(child.conversationId).toBe('conv-1');
      expect(child.agentPath).toHaveLength(0);
      expect(child.hasUsedTools('agent-a')).toBe(false);
    });

    it('allows overriding userQuery', () => {
      const parent = new RunContext({ userQuery: 'original' });
      const child = parent.fork({ userQuery: 'sub-agent input' });
      expect(child.userQuery).toBe('sub-agent input');
    });

    it('allows overriding conversationId', () => {
      const parent = new RunContext({
        userQuery: 'q',
        conversationId: 'parent-conv',
      });
      const child = parent.fork({ conversationId: 'child-conv' });
      expect(child.conversationId).toBe('child-conv');
    });
  });

  describe('approval decisions', () => {
    it('approves tool calls', () => {
      const ctx = new RunContext({ userQuery: 'test' });
      ctx.approveTool('call-1', 'looks safe');

      const items = ctx.buildApprovalOutputItems();
      expect(items).toHaveLength(1);
      expect(items[0].call_id).toBe('call-1');
      expect(items[0].output).toBe('looks safe');
    });

    it('rejects tool calls', () => {
      const ctx = new RunContext({ userQuery: 'test' });
      ctx.rejectTool('call-1', 'too dangerous');

      const items = ctx.buildApprovalOutputItems();
      expect(items).toHaveLength(0);
    });

    it('builds MCP approval responses', () => {
      const ctx = new RunContext({ userQuery: 'test' });
      ctx.approveTool('mcp-1');
      ctx.rejectTool('mcp-2', 'denied');

      const responses = ctx.buildMcpApprovalResponses();
      expect(responses).toHaveLength(2);
      expect(responses[0]).toEqual({
        type: 'mcp_approval_response',
        approval_request_id: 'mcp-1',
        approve: true,
        reason: undefined,
      });
      expect(responses[1]).toEqual({
        type: 'mcp_approval_response',
        approval_request_id: 'mcp-2',
        approve: false,
        reason: 'denied',
      });
    });
  });

  describe('visit tracking', () => {
    it('tracks agent visits', () => {
      const ctx = new RunContext({ userQuery: 'test' });
      expect(ctx.recordVisit('a')).toBe(1);
      expect(ctx.recordVisit('a')).toBe(2);
      expect(ctx.recordVisit('b')).toBe(1);
    });
  });
});
