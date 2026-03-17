import { describe, it, expect, vi } from 'vitest';
import { run, type RunOptions } from '../src/run';
import { InMemorySession, ServerManagedSession } from '../src/session';
import { noopLogger } from '../src/logger';
import type { AgentConfig } from '../src/types/agentConfig';
import type { EffectiveConfig } from '../src/types/modelConfig';
import type { Model } from '../src/model';
import type { ResponsesApiResponse, ResponsesApiOutputEvent } from '../src/types/responsesApi';

function makeResponse(text = 'hello'): ResponsesApiResponse {
  return {
    id: 'resp-1',
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    ] as ResponsesApiOutputEvent[],
  };
}

function makeModel(response?: ResponsesApiResponse): Model {
  return {
    chatTurn: vi.fn().mockResolvedValue(response ?? makeResponse()),
    chatTurnStream: vi.fn(),
    testConnection: vi.fn().mockResolvedValue(undefined),
  } as unknown as Model;
}

function makeOptions(overrides?: Partial<RunOptions>): RunOptions {
  return {
    model: makeModel(),
    agents: { router: { name: 'Router', instructions: 'Route' } as AgentConfig },
    defaultAgent: 'router',
    config: { systemPrompt: '', model: 'test' } as EffectiveConfig,
    logger: noopLogger,
    ...overrides,
  };
}

describe('run', () => {
  it('returns result from single agent run', async () => {
    const result = await run('hello', makeOptions());
    expect(result.content).toBe('hello');
    expect(result.agentName).toBe('Router');
  });

  it('uses provided model', async () => {
    const model = makeModel(makeResponse('custom'));
    const result = await run('hi', makeOptions({ model }));
    expect(result.content).toBe('custom');
    expect(model.chatTurn).toHaveBeenCalled();
  });

  it('loads session history and saves new items', async () => {
    const session = new InMemorySession();
    await session.addItems([
      { type: 'message', role: 'user', content: 'old msg' } as any,
    ]);

    const model = makeModel();
    const result = await run('new msg', makeOptions({ model, session }));

    expect(result.content).toBe('hello');
    const items = await session.getItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('uses ServerManagedSession conversationId', async () => {
    const session = new ServerManagedSession('conv-123');
    const model = makeModel();
    const result = await run('hi', makeOptions({ model, session }));

    expect(result.content).toBe('hello');
    expect(model.chatTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ conversationId: 'conv-123' }),
    );
  });

  it('calls onRunStart and onRunEnd hooks', async () => {
    const onRunStart = vi.fn();
    const onRunEnd = vi.fn();
    await run('hi', makeOptions({ hooks: { onRunStart, onRunEnd } }));
    expect(onRunStart).toHaveBeenCalled();
    expect(onRunEnd).toHaveBeenCalledWith('success');
  });

  it('calls onRunEnd with error on failure', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('crash'));
    const onRunEnd = vi.fn();

    await expect(
      run('hi', makeOptions({ model, hooks: { onRunEnd } })),
    ).rejects.toThrow('crash');
    expect(onRunEnd).toHaveBeenCalledWith('error');
  });

  it('calls onTurnStart hook', async () => {
    const onTurnStart = vi.fn();
    await run('hi', makeOptions({ hooks: { onTurnStart } }));
    expect(onTurnStart).toHaveBeenCalledWith(0, 'router');
  });

  it('calls onRunEnd with max_turns when exceeded', async () => {
    const model = makeModel();
    (model.chatTurn as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'r1',
      output: [
        { type: 'function_call', id: 'c1', name: 'unknown', arguments: '{}', call_id: 'c1' },
      ],
    });
    const onRunEnd = vi.fn();
    const result = await run('hi', makeOptions({
      model,
      maxAgentTurns: 1,
      hooks: { onRunEnd },
    }));
    expect(result.maxTurnsExceeded).toBe(true);
    expect(onRunEnd).toHaveBeenCalledWith('max_turns');
  });

  it('forwards resumeState and approvalDecisions', async () => {
    const model = makeModel();
    const result = await run('continue', makeOptions({
      model,
      resumeState: {
        currentAgentKey: 'router',
        turn: 1,
        agentPath: ['router'],
        pendingToolCalls: [],
        isInterrupted: false,
      },
    }));
    expect(result.content).toBe('hello');
  });

  it('does not save to ServerManagedSession', async () => {
    const session = new ServerManagedSession('conv-1');
    await run('hi', makeOptions({ session }));
    expect(await session.getItems()).toEqual([]);
  });
});
