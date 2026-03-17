import { describe, it, expect, vi } from 'vitest';
import { dispatchToHooks, type AgentHooks } from '../../src/hooks';
import type { AgentLifecycleEvent } from '../../src/types/lifecycle';

describe('dispatchToHooks', () => {
  it('does nothing when hooks is undefined', async () => {
    await expect(
      dispatchToHooks({ type: 'agent.start', agentKey: 'a', agentName: 'A', turn: 0 }),
    ).resolves.toBeUndefined();
  });

  it('calls onStart for agent.start events', async () => {
    const hooks: AgentHooks = { onStart: vi.fn() };
    await dispatchToHooks(
      { type: 'agent.start', agentKey: 'router', agentName: 'Router', turn: 1 },
      hooks,
    );
    expect(hooks.onStart).toHaveBeenCalledWith('router', 1);
  });

  it('calls onEnd for agent.end events', async () => {
    const hooks: AgentHooks = { onEnd: vi.fn() };
    await dispatchToHooks(
      { type: 'agent.end', agentKey: 'eng', agentName: 'Engineer', turn: 2, result: 'final_output' },
      hooks,
    );
    expect(hooks.onEnd).toHaveBeenCalledWith('eng', 2, 'final_output');
  });

  it('calls onHandoff for agent.handoff events', async () => {
    const hooks: AgentHooks = { onHandoff: vi.fn() };
    await dispatchToHooks(
      { type: 'agent.handoff', fromAgent: 'A', toAgent: 'B', fromKey: 'a', toKey: 'b', reason: 'test' },
      hooks,
    );
    expect(hooks.onHandoff).toHaveBeenCalledWith('a', 'b', 'test');
  });

  it('calls onToolStart for agent.tool_start events', async () => {
    const hooks: AgentHooks = { onToolStart: vi.fn() };
    await dispatchToHooks(
      { type: 'agent.tool_start', agentKey: 'eng', toolName: 'run_cmd', turn: 0 },
      hooks,
    );
    expect(hooks.onToolStart).toHaveBeenCalledWith('eng', 'run_cmd', 0);
  });

  it('calls onToolEnd for agent.tool_end events', async () => {
    const hooks: AgentHooks = { onToolEnd: vi.fn() };
    await dispatchToHooks(
      { type: 'agent.tool_end', agentKey: 'eng', toolName: 'run_cmd', turn: 0, success: true },
      hooks,
    );
    expect(hooks.onToolEnd).toHaveBeenCalledWith('eng', 'run_cmd', 0, true);
  });

  it('does not crash when specific callback is missing', async () => {
    const hooks: AgentHooks = {};
    await expect(
      dispatchToHooks({ type: 'agent.start', agentKey: 'a', agentName: 'A', turn: 0 }, hooks),
    ).resolves.toBeUndefined();
  });

  it('supports async callbacks', async () => {
    const hooks: AgentHooks = {
      onStart: vi.fn().mockResolvedValue(undefined),
    };
    await dispatchToHooks(
      { type: 'agent.start', agentKey: 'a', agentName: 'A', turn: 0 },
      hooks,
    );
    expect(hooks.onStart).toHaveBeenCalled();
  });
});
