import { describe, it, expect, vi } from 'vitest';
import { executeToolCalls, type ToolExecutionDeps } from '../../src/tools/toolExecution';
import { noopLogger } from '../../src/logger';
import type { ToolResolver } from '../../src/tools/toolResolver';

function makeResolver(): ToolResolver {
  return {
    isKnown: () => false,
    getServerInfo: () => undefined,
    resolve: () => undefined,
    register: vi.fn(),
    getAll: () => [],
  } as unknown as ToolResolver;
}

function makeDeps(overrides: Partial<ToolExecutionDeps> = {}): ToolExecutionDeps {
  return {
    resolver: makeResolver(),
    logger: noopLogger,
    ...overrides,
  };
}

describe('executeToolCalls with guardrails', () => {
  it('blocks tool call when input guardrail matches', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'delete_file',
      description: 'Delete a file',
      parameters: {},
      execute: vi.fn().mockResolvedValue('deleted'),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'delete_file', arguments: '{"path":"/etc/passwd"}' }],
      makeDeps({
        functionTools: tools,
        toolGuardrails: [{
          toolPattern: 'delete_*',
          phase: 'input',
          action: 'block',
          message: 'Dangerous file operation blocked',
          contentPattern: '/etc/',
        }],
      }),
    );

    expect(results[0].guardrailBlocked).toBe(true);
    expect(results[0].output).toContain('Blocked by guardrail');
    expect(tools[0].execute).not.toHaveBeenCalled();
  });

  it('allows tool call when input guardrail does not match', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'read_file',
      description: 'Read a file',
      parameters: {},
      execute: vi.fn().mockResolvedValue('content'),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'read_file', arguments: '{"path":"/home/user/doc.txt"}' }],
      makeDeps({
        functionTools: tools,
        toolGuardrails: [{
          toolPattern: 'delete_*',
          phase: 'input',
          action: 'block',
          message: 'Dangerous',
        }],
      }),
    );

    expect(results[0].guardrailBlocked).toBeUndefined();
    expect(results[0].output).toBe('content');
    expect(tools[0].execute).toHaveBeenCalled();
  });

  it('blocks tool output when output guardrail matches', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'query',
      description: 'Run query',
      parameters: {},
      execute: vi.fn().mockResolvedValue('SSN: 123-45-6789'),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'query', arguments: '{}' }],
      makeDeps({
        functionTools: tools,
        toolGuardrails: [{
          toolPattern: '*',
          phase: 'output',
          action: 'block',
          message: 'PII detected in output',
          contentPattern: '\\d{3}-\\d{2}-\\d{4}',
        }],
      }),
    );

    expect(results[0].guardrailBlocked).toBe(true);
    expect(results[0].output).toContain('Output blocked by guardrail');
  });

  it('warns but does not block when action is warn', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'search',
      description: 'Search',
      parameters: {},
      execute: vi.fn().mockResolvedValue('results'),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'search', arguments: '{"q":"test"}' }],
      makeDeps({
        functionTools: tools,
        toolGuardrails: [{
          toolPattern: 'search',
          phase: 'input',
          action: 'warn',
          message: 'Search operation logged',
        }],
      }),
    );

    expect(results[0].guardrailBlocked).toBeUndefined();
    expect(results[0].output).toBe('results');
  });

  it('works without guardrails configured', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'test',
      description: 'Test',
      parameters: {},
      execute: vi.fn().mockResolvedValue('ok'),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'test', arguments: '{}' }],
      makeDeps({ functionTools: tools }),
    );

    expect(results[0].output).toBe('ok');
  });

  it('blocks tool call when require_approval guardrail matches', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'deploy',
      description: 'Deploy to production',
      parameters: {},
      execute: vi.fn().mockResolvedValue('deployed'),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'deploy', arguments: '{}' }],
      makeDeps({
        functionTools: tools,
        toolGuardrails: [{
          toolPattern: 'deploy',
          phase: 'input',
          action: 'require_approval',
          message: 'Deployment requires approval',
        }],
      }),
    );

    expect(results[0].guardrailBlocked).toBe(true);
    expect(results[0].output).toContain('Blocked by guardrail');
    expect(tools[0].execute).not.toHaveBeenCalled();
  });

  it('skips output guardrail when tool execution errors', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'query',
      description: 'Run query',
      parameters: {},
      execute: vi.fn().mockRejectedValue(new Error('DB error')),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'query', arguments: '{}' }],
      makeDeps({
        functionTools: tools,
        toolGuardrails: [{
          toolPattern: '*',
          phase: 'output',
          action: 'block',
          message: 'Should not trigger',
          contentPattern: '.*',
        }],
      }),
    );

    expect(results[0].guardrailBlocked).toBeUndefined();
    expect(results[0].error).toBe('DB error');
  });

  it('applies first matching rule among multiple guardrails', async () => {
    const tools = [{
      type: 'function' as const,
      name: 'admin_action',
      description: 'Admin action',
      parameters: {},
      execute: vi.fn().mockResolvedValue('done'),
    }];

    const results = await executeToolCalls(
      [{ callId: 'c1', name: 'admin_action', arguments: '{}' }],
      makeDeps({
        functionTools: tools,
        toolGuardrails: [
          {
            toolPattern: 'admin_*',
            phase: 'input',
            action: 'warn',
            message: 'Admin action detected',
          },
          {
            toolPattern: 'admin_*',
            phase: 'input',
            action: 'block',
            message: 'Admin blocked',
          },
        ],
      }),
    );

    // First matching rule is 'warn', which allows execution
    expect(results[0].guardrailBlocked).toBeUndefined();
    expect(results[0].output).toBe('done');
  });
});
