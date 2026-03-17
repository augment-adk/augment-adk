import { describe, it, expect, vi } from 'vitest';
import { runStream, type RunStreamOptions } from '../src/runStream';
import { InMemorySession, ServerManagedSession } from '../src/session';
import { noopLogger } from '../src/logger';
import type { AgentConfig } from '../src/types/agentConfig';
import type { EffectiveConfig } from '../src/types/modelConfig';
import type { Model } from '../src/model';
import type { ResponsesApiResponse, ResponsesApiOutputEvent } from '../src/types/responsesApi';
import type { RunStreamEvent } from '../src/stream/runStreamEvents';

function makeResponse(text = 'hello'): ResponsesApiResponse {
  return {
    id: 'resp-1',
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    ] as ResponsesApiOutputEvent[],
  };
}

function makeStreamModel(response?: ResponsesApiResponse): Model {
  const resp = response ?? makeResponse();
  return {
    chatTurn: vi.fn(),
    chatTurnStream: vi.fn().mockImplementation(
      async (_input: unknown, _sys: unknown, _tools: unknown, _config: unknown, onEvent: (raw: string) => void) => {
        onEvent(JSON.stringify({ type: 'response.created', response: { id: resp.id } }));
        for (const item of resp.output) {
          onEvent(JSON.stringify({ type: 'response.output_item.done', item }));
        }
        onEvent(JSON.stringify({ type: 'response.completed', response: resp }));
      },
    ),
    testConnection: vi.fn().mockResolvedValue(undefined),
  } as unknown as Model;
}

function makeOptions(overrides?: Partial<RunStreamOptions>): RunStreamOptions {
  return {
    model: makeStreamModel(),
    agents: { router: { name: 'Router', instructions: 'Route' } as AgentConfig },
    defaultAgent: 'router',
    config: { systemPrompt: '', model: 'test' } as EffectiveConfig,
    logger: noopLogger,
    ...overrides,
  };
}

describe('runStream', () => {
  it('returns a StreamedRunResult immediately', () => {
    const stream = runStream('hello', makeOptions());
    expect(stream).toBeDefined();
    expect(stream.isComplete).toBe(false);
  });

  it('emits events and produces result', async () => {
    const stream = runStream('hello', makeOptions());
    const events: RunStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }
    expect(stream.isComplete).toBe(true);
    expect(stream.result.content).toBe('hello');
    expect(events.some(e => e.type === 'agent_start')).toBe(true);
    expect(events.some(e => e.type === 'raw_model_event')).toBe(true);
  });

  it('loads session history', async () => {
    const session = new InMemorySession();
    await session.addItems([
      { type: 'message', role: 'user', content: 'old' } as any,
    ]);

    const stream = runStream('new', makeOptions({ session }));
    for await (const _ of stream) { /* drain */ }
    expect(stream.result.content).toBe('hello');

    const items = await session.getItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it('uses ServerManagedSession conversationId', async () => {
    const session = new ServerManagedSession('conv-1');
    const model = makeStreamModel();
    const stream = runStream('hi', makeOptions({ model, session }));
    for await (const _ of stream) { /* drain */ }

    expect(model.chatTurnStream).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.any(Function),
      expect.objectContaining({ conversationId: 'conv-1' }),
      undefined,
    );
  });

  it('calls hooks', async () => {
    const onRunStart = vi.fn();
    const onRunEnd = vi.fn();
    const stream = runStream('hi', makeOptions({ hooks: { onRunStart, onRunEnd } }));
    for await (const _ of stream) { /* drain */ }

    expect(onRunStart).toHaveBeenCalled();
    expect(onRunEnd).toHaveBeenCalledWith('success');
  });

  it('handles abort signal before start', async () => {
    const controller = new AbortController();
    controller.abort();

    const stream = runStream('hi', makeOptions({ signal: controller.signal }));
    for await (const _ of stream) { /* drain */ }

    expect(stream.isComplete).toBe(true);
    expect(stream.result.content).toContain('Aborted');
  });

  it('forwards error via closeWithError', async () => {
    const model = {
      chatTurn: vi.fn(),
      chatTurnStream: vi.fn().mockRejectedValue(new Error('stream fail')),
      testConnection: vi.fn(),
    } as unknown as Model;

    const onRunEnd = vi.fn();
    const stream = runStream('hi', makeOptions({ model, hooks: { onRunEnd } }));
    const events: RunStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(stream.isComplete).toBe(true);
    expect(stream.result.content).toContain('stream fail');
    expect(events.some(e => e.type === 'error')).toBe(true);
    expect(onRunEnd).toHaveBeenCalledWith('error');
  });
});
