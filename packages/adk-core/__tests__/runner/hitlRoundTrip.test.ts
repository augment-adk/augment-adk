import { describe, it, expect, vi } from 'vitest';
import { run, type RunOptions } from '../../src/run';
import { runStream, type RunStreamOptions } from '../../src/runStream';
import {
  createInterruptedStateFromResult,
  serializeRunState,
  deserializeRunState,
} from '../../src/runner/RunState';
import { flattenSubAgentChain } from '../../src/runner/resumeHelper';
import { ApprovalStore } from '../../src/approval/ApprovalStore';
import { tool } from '../../src/tools/tool';
import { noopLogger } from '../../src/logger';
import type { AgentConfig } from '../../src/types/agentConfig';
import type { EffectiveConfig, MCPServerConfig } from '../../src/types/modelConfig';
import type { Model } from '../../src/model';
import type {
  ResponsesApiResponse,
  ResponsesApiOutputEvent,
  ResponsesApiInputItem,
} from '../../src/types/responsesApi';
import type { RunStreamEvent } from '../../src/stream/runStreamEvents';

function makeTextResponse(text: string, id = 'resp-1'): ResponsesApiResponse {
  return {
    id,
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
    ] as ResponsesApiOutputEvent[],
  };
}

function makeFunctionCallResponse(
  calls: Array<{ callId: string; name: string; args: string }>,
  id = 'resp-1',
): ResponsesApiResponse {
  return {
    id,
    output: calls.map(c => ({
      type: 'function_call',
      id: c.callId,
      call_id: c.callId,
      name: c.name,
      arguments: c.args,
    })) as ResponsesApiOutputEvent[],
  };
}

function makeMcpApprovalResponse(
  approvalId: string,
  serverLabel: string,
  name: string,
  args?: string,
  id = 'resp-1',
): ResponsesApiResponse {
  return {
    id,
    output: [
      {
        type: 'mcp_approval_request',
        id: approvalId,
        server_label: serverLabel,
        name,
        arguments: args,
      },
    ] as ResponsesApiOutputEvent[],
  };
}

const dangerousTool = tool({
  name: 'dangerous_tool',
  description: 'A dangerous tool',
  parameters: { type: 'object', properties: {} },
  execute: async () => 'executed',
});

const safeTool = tool({
  name: 'safe_tool',
  description: 'A safe tool',
  parameters: { type: 'object', properties: {} },
  execute: async () => 'safe result',
});

function makeOptions(overrides?: Partial<RunOptions>): RunOptions {
  return {
    model: {
      chatTurn: vi.fn().mockResolvedValue(makeTextResponse('done')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model,
    agents: { admin: { name: 'Admin', instructions: 'Administrate' } as AgentConfig },
    defaultAgent: 'admin',
    config: { systemPrompt: '', model: 'test' } as EffectiveConfig,
    logger: noopLogger,
    ...overrides,
  };
}

describe('HITL round-trip: client-side approval', () => {
  it('interrupts on approval, resumes with approved decisions, and sends function_call_output', async () => {
    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c1', name: 'dangerous_tool', args: '{"x":1}' },
        ], 'resp-initial'))
        .mockResolvedValueOnce(makeTextResponse('Tool executed successfully.', 'resp-resumed')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    // Function tools are registered under serverId 'function'
    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];
    const approvalStore = new ApprovalStore();

    // Step 1: Initial run should return pendingApprovals
    const result1 = await run('do something dangerous', makeOptions({
      model,
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
    }));

    expect(result1.pendingApprovals).toBeDefined();
    expect(result1.pendingApprovals!.length).toBe(1);
    expect(result1.pendingApprovals![0].approvalRequestId).toBe('c1');
    expect(result1.responseId).toBe('resp-initial');

    // Step 2: Build RunState from result
    const state = createInterruptedStateFromResult(result1);
    expect(state.isInterrupted).toBe(true);
    expect(state.pendingToolCalls.length).toBe(1);
    expect(state.previousResponseId).toBe('resp-initial');

    // Step 3: State survives serialization
    const serialized = serializeRunState(state);
    const deserialized = deserializeRunState(serialized);
    expect(deserialized).toEqual(state);

    // Step 4: Resume with approval
    const result2 = await run('do something dangerous', makeOptions({
      model,
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
      resumeState: deserialized,
      approvalDecisions: [{ callId: 'c1', approved: true, reason: 'Approved' }],
    }));

    expect(result2.content).toBe('Tool executed successfully.');

    // Verify the resumed model call received function_call_output with real tool output
    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(resumedInput).toEqual([
      { type: 'function_call_output', call_id: 'c1', output: 'executed' },
    ]);
  });

  it('sends rejection function_call_output for rejected tool calls', async () => {
    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c1', name: 'dangerous_tool', args: '{}' },
          { callId: 'c2', name: 'safe_tool', args: '{}' },
        ], 'resp-1'))
        .mockResolvedValueOnce(makeTextResponse('Understood, safe_tool was rejected.', 'resp-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];

    const result1 = await run('do things', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool, safeTool],
    }));

    expect(result1.pendingApprovals!.length).toBe(2);

    const state = createInterruptedStateFromResult(result1);

    const result2 = await run('do things', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool, safeTool],
      resumeState: state,
      approvalDecisions: [
        { callId: 'c1', approved: true },
        { callId: 'c2', approved: false, reason: 'Too risky' },
      ],
    }));

    expect(result2.content).toBe('Understood, safe_tool was rejected.');

    // Verify approved call got real tool output, rejected got rejection message
    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(2);
    expect(resumedInput[0]).toEqual({
      type: 'function_call_output', call_id: 'c1', output: 'executed',
    });
    expect(resumedInput[1]).toEqual({
      type: 'function_call_output', call_id: 'c2', output: 'Tool call rejected by human. Reason: Too risky',
    });
  });
});

describe('HITL round-trip: server-side MCP approval', () => {
  it('interrupts on mcp_approval_request, resumes with mcp_approval_response', async () => {
    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeMcpApprovalResponse(
          'apr_1', 'k8s-mcp', 'delete_pod', '{"pod":"web-1"}', 'resp-mcp-1',
        ))
        .mockResolvedValueOnce(makeTextResponse('Pod deleted.', 'resp-mcp-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    // Step 1: Initial run returns mcp approval
    const result1 = await run('delete the web pod', makeOptions({ model }));

    expect(result1.pendingApproval).toBeDefined();
    expect(result1.pendingApproval!.approvalRequestId).toBe('apr_1');
    expect(result1.pendingApproval!.serverLabel).toBe('k8s-mcp');
    expect(result1.responseId).toBe('resp-mcp-1');

    // Step 2: Build RunState — should detect MCP approval path
    const state = createInterruptedStateFromResult(result1);
    expect(state.isInterrupted).toBe(true);
    expect(state.pendingToolCalls).toHaveLength(0);
    expect(state.pendingMcpApprovals).toHaveLength(1);
    expect(state.pendingMcpApprovals![0].approvalRequestId).toBe('apr_1');

    // Step 3: Resume with approval
    const result2 = await run('delete the web pod', makeOptions({
      model,
      resumeState: state,
      approvalDecisions: [{ callId: 'apr_1', approved: true }],
    }));

    expect(result2.content).toBe('Pod deleted.');

    // Verify the resumed model call received mcp_approval_response
    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(resumedInput).toEqual([
      { type: 'mcp_approval_response', approval_request_id: 'apr_1', approve: true, reason: undefined },
    ]);
  });

  it('sends rejection for MCP approval', async () => {
    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeMcpApprovalResponse(
          'apr_2', 'ocp-mcp', 'scale_down', '{}', 'resp-r1',
        ))
        .mockResolvedValueOnce(makeTextResponse('OK, scale-down cancelled.', 'resp-r2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const result1 = await run('scale down', makeOptions({ model }));
    const state = createInterruptedStateFromResult(result1);

    const result2 = await run('scale down', makeOptions({
      model,
      resumeState: state,
      approvalDecisions: [{ callId: 'apr_2', approved: false, reason: 'Not authorized' }],
    }));

    expect(result2.content).toBe('OK, scale-down cancelled.');

    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(resumedInput).toEqual([
      { type: 'mcp_approval_response', approval_request_id: 'apr_2', approve: false, reason: 'Not authorized' },
    ]);
  });
});

describe('HITL edge cases', () => {
  it('auto-rejects undecided pending tool calls', async () => {
    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c1', name: 'dangerous_tool', args: '{}' },
          { callId: 'c2', name: 'safe_tool', args: '{}' },
        ], 'resp-1'))
        .mockResolvedValueOnce(makeTextResponse('Partial decisions handled.', 'resp-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];

    const result1 = await run('do things', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool, safeTool],
    }));

    expect(result1.pendingApprovals!.length).toBe(2);

    const state = createInterruptedStateFromResult(result1);

    // Only provide a decision for c1, omit c2 entirely
    const result2 = await run('do things', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool, safeTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'c1', approved: true }],
    }));

    expect(result2.content).toBe('Partial decisions handled.');

    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(2);

    const c1Output = resumedInput.find((i: any) => i.call_id === 'c1') as any;
    expect(c1Output.output).toBe('executed');

    // c2 should be auto-rejected since no decision was provided
    const c2Output = resumedInput.find((i: any) => i.call_id === 'c2') as any;
    expect(c2Output.output).toContain('no approval decision was provided');
  });

  it('warns when approvalDecisions provided without interrupted resumeState', async () => {
    const warnFn = vi.fn();
    const logger = { ...noopLogger, warn: warnFn };

    await run('hello', makeOptions({
      logger,
      approvalDecisions: [{ callId: 'c1', approved: true }],
    }));

    expect(warnFn).toHaveBeenCalledWith(
      expect.stringContaining('approvalDecisions provided without an interrupted resumeState'),
    );
  });

  it('does not warn when approvalDecisions provided with interrupted resumeState', async () => {
    const warnFn = vi.fn();
    const logger = { ...noopLogger, warn: warnFn };

    const dummyTool = tool({
      name: 'tool',
      description: 'dummy',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    });

    const model = {
      chatTurn: vi.fn().mockResolvedValue(makeTextResponse('ok')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    await run('continue', makeOptions({
      model,
      logger,
      functionTools: [dummyTool],
      resumeState: {
        currentAgentKey: 'admin',
        turn: 0,
        agentPath: ['admin'],
        pendingToolCalls: [
          { callId: 'c1', name: 'tool', arguments: '{}', serverId: 'srv', serverUrl: '', originalToolName: 'tool' },
        ],
        isInterrupted: true,
      },
      approvalDecisions: [{ callId: 'c1', approved: true }],
    }));

    expect(warnFn).not.toHaveBeenCalledWith(
      expect.stringContaining('approvalDecisions provided without an interrupted resumeState'),
    );
  });
});

describe('HITL multi-call: mixed auto-approved + needs-approval', () => {
  it('preserves auto-approved calls alongside needs-approval calls, executes both on resume', async () => {
    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c-safe', name: 'safe_tool', args: '{"q":"hi"}' },
          { callId: 'c-danger', name: 'dangerous_tool', args: '{"x":1}' },
        ], 'resp-mix-1'))
        .mockResolvedValueOnce(makeTextResponse('Both tools ran.', 'resp-mix-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: { always: ['dangerous_tool'], never: ['safe_tool'] } },
    ];

    const result1 = await run('do mixed things', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool],
    }));

    expect(result1.pendingApprovals).toBeDefined();
    expect(result1.pendingApprovals!.length).toBe(1);
    expect(result1.pendingApprovals![0].approvalRequestId).toBe('c-danger');
    expect(result1.autoApprovedCalls).toBeDefined();
    expect(result1.autoApprovedCalls!.length).toBe(1);
    expect(result1.autoApprovedCalls![0].callId).toBe('c-safe');

    const state = createInterruptedStateFromResult(result1);
    expect(state.pendingToolCalls).toHaveLength(1);
    expect(state.pendingToolCalls[0].callId).toBe('c-danger');
    expect(state.autoApprovedToolCalls).toHaveLength(1);
    expect(state.autoApprovedToolCalls![0].callId).toBe('c-safe');

    const result2 = await run('do mixed things', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'c-danger', approved: true }],
    }));

    expect(result2.content).toBe('Both tools ran.');

    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(2);
    const safeOutput = resumedInput.find((i: any) => i.call_id === 'c-safe') as any;
    const dangerOutput = resumedInput.find((i: any) => i.call_id === 'c-danger') as any;
    expect(safeOutput).toEqual({ type: 'function_call_output', call_id: 'c-safe', output: 'safe result' });
    expect(dangerOutput).toEqual({ type: 'function_call_output', call_id: 'c-danger', output: 'executed' });
  });

  it('handles approve one + reject one from needs-approval, plus auto-approved calls', async () => {
    const dangerousTool2 = tool({
      name: 'dangerous_tool_2',
      description: 'Another dangerous tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'danger2 result',
    });

    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c-safe', name: 'safe_tool', args: '{}' },
          { callId: 'c-d1', name: 'dangerous_tool', args: '{}' },
          { callId: 'c-d2', name: 'dangerous_tool_2', args: '{}' },
        ], 'resp-1'))
        .mockResolvedValueOnce(makeTextResponse('Mixed results.', 'resp-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: { always: ['dangerous_tool', 'dangerous_tool_2'], never: ['safe_tool'] } },
    ];

    const result1 = await run('do all three', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool, dangerousTool2],
    }));

    expect(result1.pendingApprovals!.length).toBe(2);
    expect(result1.autoApprovedCalls!.length).toBe(1);

    const state = createInterruptedStateFromResult(result1);
    expect(state.pendingToolCalls).toHaveLength(2);
    expect(state.autoApprovedToolCalls).toHaveLength(1);

    const result2 = await run('do all three', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool, dangerousTool2],
      resumeState: state,
      approvalDecisions: [
        { callId: 'c-d1', approved: true },
        { callId: 'c-d2', approved: false, reason: 'Not safe' },
      ],
    }));

    expect(result2.content).toBe('Mixed results.');

    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(3);

    const safeOutput = resumedInput.find((i: any) => i.call_id === 'c-safe') as any;
    expect(safeOutput).toEqual({ type: 'function_call_output', call_id: 'c-safe', output: 'safe result' });

    const d1Output = resumedInput.find((i: any) => i.call_id === 'c-d1') as any;
    expect(d1Output).toEqual({ type: 'function_call_output', call_id: 'c-d1', output: 'executed' });

    const d2Output = resumedInput.find((i: any) => i.call_id === 'c-d2') as any;
    expect(d2Output).toEqual({ type: 'function_call_output', call_id: 'c-d2', output: 'Tool call rejected by human. Reason: Not safe' });
  });

  it('auto-approved calls survive serialization', async () => {
    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c-safe', name: 'safe_tool', args: '{}' },
          { callId: 'c-danger', name: 'dangerous_tool', args: '{"x":1}' },
        ], 'resp-ser-1'))
        .mockResolvedValueOnce(makeTextResponse('Done.', 'resp-ser-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: { always: ['dangerous_tool'], never: ['safe_tool'] } },
    ];

    const result1 = await run('serialize test', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool],
    }));

    const state = createInterruptedStateFromResult(result1);
    const serialized = serializeRunState(state);
    const deserialized = deserializeRunState(serialized);

    expect(deserialized.autoApprovedToolCalls).toEqual(state.autoApprovedToolCalls);
    expect(deserialized.autoApprovedToolCalls).toHaveLength(1);
    expect(deserialized.autoApprovedToolCalls![0].callId).toBe('c-safe');

    const result2 = await run('serialize test', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool],
      resumeState: deserialized,
      approvalDecisions: [{ callId: 'c-danger', approved: true }],
    }));

    expect(result2.content).toBe('Done.');

    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(2);
  });
});

function makeStreamModel(
  ...responses: ResponsesApiResponse[]
): Model {
  const streamFn = vi.fn();
  for (const resp of responses) {
    streamFn.mockImplementationOnce(
      async (
        _input: unknown,
        _sys: unknown,
        _tools: unknown,
        _config: unknown,
        onEvent: (raw: string) => void,
      ) => {
        onEvent(JSON.stringify({ type: 'response.created', response: { id: resp.id } }));
        for (const item of resp.output) {
          onEvent(JSON.stringify({ type: 'response.output_item.done', item }));
        }
        onEvent(JSON.stringify({ type: 'response.completed', response: resp }));
      },
    );
  }

  return {
    chatTurn: vi.fn(),
    chatTurnStream: streamFn,
    testConnection: vi.fn(),
  } as unknown as Model;
}

function makeStreamOptions(overrides?: Partial<RunStreamOptions>): RunStreamOptions {
  return {
    model: makeStreamModel(makeTextResponse('done')),
    agents: { admin: { name: 'Admin', instructions: 'Administrate' } as AgentConfig },
    defaultAgent: 'admin',
    config: { systemPrompt: '', model: 'test' } as EffectiveConfig,
    logger: noopLogger,
    ...overrides,
  };
}

async function collectEvents(stream: ReturnType<typeof runStream>): Promise<RunStreamEvent[]> {
  const events: RunStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

describe('Streaming HITL round-trip: client-side approval', () => {
  it('emits approval_requested event and resumes with function_call_output', async () => {
    const model = makeStreamModel(
      makeFunctionCallResponse([{ callId: 'c1', name: 'dangerous_tool', args: '{"x":1}' }], 'resp-s1'),
      makeTextResponse('Stream resumed OK.', 'resp-s2'),
    );

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];
    const approvalStore = new ApprovalStore();

    // Step 1: Stream and collect events — should contain approval_requested
    const stream1 = runStream('do something dangerous', makeStreamOptions({
      model,
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
    }));

    const events1 = await collectEvents(stream1);

    const approvalEvents = events1.filter(e => e.type === 'approval_requested');
    expect(approvalEvents).toHaveLength(1);
    expect((approvalEvents[0] as RunStreamEvent & { type: 'approval_requested' }).approvalRequestId).toBe('c1');

    const result1 = stream1.result;
    expect(result1.pendingApprovals).toBeDefined();
    expect(result1.pendingApprovals!.length).toBe(1);

    // Step 2: Build RunState and resume
    const state = createInterruptedStateFromResult(result1);

    const stream2 = runStream('do something dangerous', makeStreamOptions({
      model,
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'c1', approved: true }],
    }));

    const events2 = await collectEvents(stream2);

    // Resume should emit tool_called and tool_output events
    const toolCalledEvents = events2.filter(e => e.type === 'tool_called');
    const toolOutputEvents = events2.filter(e => e.type === 'tool_output');
    expect(toolCalledEvents.length).toBeGreaterThanOrEqual(1);
    expect(toolOutputEvents.length).toBeGreaterThanOrEqual(1);

    expect(stream2.result.content).toBe('Stream resumed OK.');

    // Verify the model received function_call_output with real tool output
    const resumedInput = (model.chatTurnStream as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(resumedInput).toEqual([
      { type: 'function_call_output', call_id: 'c1', output: 'executed' },
    ]);
  });
});

describe('Streaming HITL round-trip: server-side MCP approval', () => {
  it('emits approval_requested and resumes with mcp_approval_response', async () => {
    const model = makeStreamModel(
      makeMcpApprovalResponse('apr_s1', 'k8s-mcp', 'delete_pod', '{"pod":"web-1"}', 'resp-mcp-s1'),
      makeTextResponse('Pod deleted via stream.', 'resp-mcp-s2'),
    );

    const stream1 = runStream('delete the web pod', makeStreamOptions({ model }));
    const events1 = await collectEvents(stream1);

    const approvalEvents = events1.filter(e => e.type === 'approval_requested');
    expect(approvalEvents).toHaveLength(1);

    const result1 = stream1.result;
    expect(result1.pendingApproval).toBeDefined();
    expect(result1.pendingApproval!.approvalRequestId).toBe('apr_s1');

    const state = createInterruptedStateFromResult(result1);
    expect(state.pendingMcpApprovals).toHaveLength(1);

    const stream2 = runStream('delete the web pod', makeStreamOptions({
      model,
      resumeState: state,
      approvalDecisions: [{ callId: 'apr_s1', approved: true }],
    }));

    await collectEvents(stream2);
    expect(stream2.result.content).toBe('Pod deleted via stream.');

    const resumedInput = (model.chatTurnStream as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(resumedInput).toEqual([
      { type: 'mcp_approval_response', approval_request_id: 'apr_s1', approve: true, reason: undefined },
    ]);
  });
});

describe('Sub-agent HITL: client-side approval', () => {
  it('wraps sub-agent tool outputs in the parent call_id on resume', async () => {
    const helperAgent: AgentConfig = {
      name: 'Helper',
      instructions: 'Help with tasks',
      tools: ['dangerous_tool'],
    };

    const routerAgent: AgentConfig = {
      name: 'Router',
      instructions: 'Route to helper',
      asTools: ['helper'],
    };

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];

    // Turn 1 (router): model returns call_helper
    // Turn 2 (helper/sub-agent): model returns dangerous_tool function_call → needs approval
    // On resume: tool executes, wrapped as call_helper output
    // Turn 3 (router): model returns final text after receiving sub-agent result
    const model = {
      chatTurn: vi.fn()
        // Router's first call → calls helper sub-agent
        .mockResolvedValueOnce({
          id: 'resp-router-1',
          output: [{
            type: 'function_call',
            id: 'parent-c1',
            call_id: 'parent-c1',
            name: 'call_helper',
            arguments: '{"input":"do something dangerous"}',
          }] as ResponsesApiOutputEvent[],
        } as ResponsesApiResponse)
        // Helper sub-agent's call → returns dangerous_tool
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'sub-c1', name: 'dangerous_tool', args: '{}' },
        ], 'resp-helper-1'))
        // After resume: router gets sub-agent result, returns final text
        .mockResolvedValueOnce(makeTextResponse('Sub-agent completed the task.', 'resp-router-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const approvalStore = new ApprovalStore();

    const result1 = await run('do something dangerous via helper', makeOptions({
      model,
      agents: {
        router: routerAgent,
        helper: helperAgent,
      },
      defaultAgent: 'router',
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
    }));

    // Should have pending approvals from the sub-agent
    expect(result1.pendingApprovals).toBeDefined();
    expect(result1.pendingApprovals!.length).toBe(1);
    expect(result1.pendingApprovals![0].approvalRequestId).toBe('sub-c1');

    // Should have subAgentContext
    const state = createInterruptedStateFromResult(result1);
    expect(state.isInterrupted).toBe(true);
    expect(state.subAgentContext).toBeDefined();
    expect(state.subAgentContext!.parentCallId).toBe('parent-c1');
    expect(state.subAgentContext!.subAgentKey).toBe('helper');

    // Resume with approval
    const result2 = await run('do something dangerous via helper', makeOptions({
      model,
      agents: {
        router: routerAgent,
        helper: helperAgent,
      },
      defaultAgent: 'router',
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'sub-c1', approved: true }],
    }));

    expect(result2.content).toBe('Sub-agent completed the task.');

    // The third model call (router resume) should receive a single function_call_output
    // addressed to the parent's call_id, NOT the sub-agent's call_id
    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[2][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(1);
    expect(resumedInput[0]).toEqual({
      type: 'function_call_output',
      call_id: 'parent-c1',
      output: 'executed',
    });
  });

  it('subAgentContext survives serialization', async () => {
    const fakeResult = {
      content: '',
      currentAgentKey: 'router',
      responseId: 'resp-1',
      pendingApprovals: [{
        approvalRequestId: 'sub-c1',
        toolName: 'dangerous_tool',
        arguments: '{}',
      }],
      subAgentContext: {
        parentCallId: 'parent-c1',
        subAgentKey: 'helper',
        subAgentResponseId: 'resp-helper-1',
      },
    };

    const state = createInterruptedStateFromResult(fakeResult as any);
    expect(state.subAgentContext).toBeDefined();

    const serialized = serializeRunState(state);
    const deserialized = deserializeRunState(serialized);

    expect(deserialized.subAgentContext).toEqual(state.subAgentContext);
    expect(deserialized.subAgentContext!.parentCallId).toBe('parent-c1');
    expect(deserialized.subAgentContext!.subAgentKey).toBe('helper');
    expect(deserialized.subAgentContext!.subAgentResponseId).toBe('resp-helper-1');
  });
});

describe('Sub-agent HITL: server-side MCP approval', () => {
  it('re-enters sub-agent conversation for MCP approval and wraps result in parent call_id', async () => {
    const helperAgent: AgentConfig = {
      name: 'Helper',
      instructions: 'Help with tasks',
    };

    const routerAgent: AgentConfig = {
      name: 'Router',
      instructions: 'Route to helper',
      asTools: ['helper'],
    };

    const model = {
      chatTurn: vi.fn()
        // Router's first call → calls helper sub-agent
        .mockResolvedValueOnce({
          id: 'resp-router-1',
          output: [{
            type: 'function_call',
            id: 'parent-c1',
            call_id: 'parent-c1',
            name: 'call_helper',
            arguments: '{"input":"search customers"}',
          }] as ResponsesApiOutputEvent[],
        } as ResponsesApiResponse)
        // Helper sub-agent → returns mcp_approval_request
        .mockResolvedValueOnce(makeMcpApprovalResponse(
          'apr-sub-1', 'customer-mcp', 'search_customers', '{"query":"Tech"}', 'resp-helper-1',
        ))
        // Sub-agent resume (MCP approval response) → returns tool result
        .mockResolvedValueOnce(makeTextResponse('Found 3 customers matching Tech.', 'resp-helper-2'))
        // Router gets sub-agent result → returns final text
        .mockResolvedValueOnce(makeTextResponse('The helper found 3 matching customers.', 'resp-router-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const result1 = await run('search customers via helper', makeOptions({
      model,
      agents: {
        router: routerAgent,
        helper: helperAgent,
      },
      defaultAgent: 'router',
    }));

    // Should have MCP pending approval from sub-agent
    expect(result1.pendingApproval).toBeDefined();
    expect(result1.pendingApproval!.approvalRequestId).toBe('apr-sub-1');

    const state = createInterruptedStateFromResult(result1);
    expect(state.pendingMcpApprovals).toHaveLength(1);
    expect(state.subAgentContext).toBeDefined();
    expect(state.subAgentContext!.parentCallId).toBe('parent-c1');
    expect(state.subAgentContext!.subAgentKey).toBe('helper');
    expect(state.subAgentContext!.subAgentResponseId).toBe('resp-helper-1');

    // Resume with MCP approval
    const result2 = await run('search customers via helper', makeOptions({
      model,
      agents: {
        router: routerAgent,
        helper: helperAgent,
      },
      defaultAgent: 'router',
      resumeState: state,
      approvalDecisions: [{ callId: 'apr-sub-1', approved: true }],
    }));

    expect(result2.content).toBe('The helper found 3 matching customers.');

    // The 3rd model call (sub-agent MCP resume) should receive mcp_approval_response
    // with the sub-agent's previousResponseId
    const subResumeInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[2][0] as ResponsesApiInputItem[];
    expect(subResumeInput).toHaveLength(1);
    expect(subResumeInput[0]).toEqual({
      type: 'mcp_approval_response',
      approval_request_id: 'apr-sub-1',
      approve: true,
      reason: undefined,
    });

    // The 4th model call (router resume) should receive the wrapped sub-agent output
    const routerResumeInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[3][0] as ResponsesApiInputItem[];
    expect(routerResumeInput).toHaveLength(1);
    expect(routerResumeInput[0]).toEqual({
      type: 'function_call_output',
      call_id: 'parent-c1',
      output: 'Found 3 customers matching Tech.',
    });
  });
});

describe('Multi-level sub-agent HITL nesting', () => {
  it('flattenSubAgentChain flattens nested contexts', () => {
    const chain = flattenSubAgentChain({
      parentCallId: 'router-c1',
      subAgentKey: 'a',
      subAgentResponseId: 'resp-a',
      inner: {
        parentCallId: 'a-c1',
        subAgentKey: 'b',
        subAgentResponseId: 'resp-b',
        inner: {
          parentCallId: 'b-c1',
          subAgentKey: 'c',
          subAgentResponseId: 'resp-c',
        },
      },
    });
    expect(chain).toHaveLength(3);
    expect(chain[0].subAgentKey).toBe('a');
    expect(chain[1].subAgentKey).toBe('b');
    expect(chain[2].subAgentKey).toBe('c');
  });

  it('nested subAgentContext survives serialization', () => {
    const fakeResult = {
      content: '',
      currentAgentKey: 'router',
      responseId: 'resp-1',
      pendingApprovals: [{
        approvalRequestId: 'deep-c1',
        toolName: 'dangerous_tool',
        arguments: '{}',
      }],
      subAgentContext: {
        parentCallId: 'router-c1',
        subAgentKey: 'a',
        subAgentResponseId: 'resp-a',
        inner: {
          parentCallId: 'a-c1',
          subAgentKey: 'b',
          subAgentResponseId: 'resp-b',
        },
      },
    };

    const state = createInterruptedStateFromResult(fakeResult as any);
    const serialized = serializeRunState(state);
    const deserialized = deserializeRunState(serialized);

    expect(deserialized.subAgentContext).toEqual(state.subAgentContext);
    expect(deserialized.subAgentContext!.inner).toBeDefined();
    expect(deserialized.subAgentContext!.inner!.parentCallId).toBe('a-c1');
    expect(deserialized.subAgentContext!.inner!.subAgentKey).toBe('b');
  });

  it('client-side: router → A → B, B needs approval, tool output wraps to outermost', async () => {
    const agentB: AgentConfig = {
      name: 'Agent B',
      instructions: 'Inner worker',
      tools: ['dangerous_tool'],
    };

    const agentA: AgentConfig = {
      name: 'Agent A',
      instructions: 'Middle agent',
      asTools: ['b'],
    };

    const routerAgent: AgentConfig = {
      name: 'Router',
      instructions: 'Outer router',
      asTools: ['a'],
    };

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];

    const model = {
      chatTurn: vi.fn()
        // Router → calls agent A
        .mockResolvedValueOnce({
          id: 'resp-router-1',
          output: [{
            type: 'function_call', id: 'router-c1', call_id: 'router-c1',
            name: 'call_a', arguments: '{"input":"delegate"}',
          }] as ResponsesApiOutputEvent[],
        } as ResponsesApiResponse)
        // Agent A → calls agent B
        .mockResolvedValueOnce({
          id: 'resp-a-1',
          output: [{
            type: 'function_call', id: 'a-c1', call_id: 'a-c1',
            name: 'call_b', arguments: '{"input":"do dangerous"}',
          }] as ResponsesApiOutputEvent[],
        } as ResponsesApiResponse)
        // Agent B → calls dangerous_tool (needs approval)
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'b-c1', name: 'dangerous_tool', args: '{}' },
        ], 'resp-b-1'))
        // After resume: router receives wrapped result → final text
        .mockResolvedValueOnce(makeTextResponse('Deep task completed.', 'resp-router-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const approvalStore = new ApprovalStore();

    const result1 = await run('deep delegation', makeOptions({
      model,
      agents: { router: routerAgent, a: agentA, b: agentB },
      defaultAgent: 'router',
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
    }));

    expect(result1.pendingApprovals).toBeDefined();
    expect(result1.pendingApprovals!.length).toBe(1);
    expect(result1.pendingApprovals![0].approvalRequestId).toBe('b-c1');

    const state = createInterruptedStateFromResult(result1);
    expect(state.subAgentContext).toBeDefined();
    expect(state.subAgentContext!.parentCallId).toBe('router-c1');
    expect(state.subAgentContext!.subAgentKey).toBe('a');
    expect(state.subAgentContext!.inner).toBeDefined();
    expect(state.subAgentContext!.inner!.parentCallId).toBe('a-c1');
    expect(state.subAgentContext!.inner!.subAgentKey).toBe('b');

    const result2 = await run('deep delegation', makeOptions({
      model,
      agents: { router: routerAgent, a: agentA, b: agentB },
      defaultAgent: 'router',
      mcpServers,
      approvalStore,
      functionTools: [dangerousTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'b-c1', approved: true }],
    }));

    expect(result2.content).toBe('Deep task completed.');

    // The 4th model call (router resume) should receive a single function_call_output
    // with the outermost parent call_id
    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[3][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(1);
    expect(resumedInput[0]).toEqual({
      type: 'function_call_output',
      call_id: 'router-c1',
      output: 'executed',
    });
  });

  it('MCP: router → A → B, B gets mcp_approval_request, unwinds through chain', async () => {
    const agentB: AgentConfig = {
      name: 'Agent B',
      instructions: 'Inner worker',
    };

    const agentA: AgentConfig = {
      name: 'Agent A',
      instructions: 'Middle agent',
      asTools: ['b'],
    };

    const routerAgent: AgentConfig = {
      name: 'Router',
      instructions: 'Outer router',
      asTools: ['a'],
    };

    const model = {
      chatTurn: vi.fn()
        // Router → calls agent A
        .mockResolvedValueOnce({
          id: 'resp-router-1',
          output: [{
            type: 'function_call', id: 'router-c1', call_id: 'router-c1',
            name: 'call_a', arguments: '{"input":"delegate"}',
          }] as ResponsesApiOutputEvent[],
        } as ResponsesApiResponse)
        // Agent A → calls agent B
        .mockResolvedValueOnce({
          id: 'resp-a-1',
          output: [{
            type: 'function_call', id: 'a-c1', call_id: 'a-c1',
            name: 'call_b', arguments: '{"input":"search customers"}',
          }] as ResponsesApiOutputEvent[],
        } as ResponsesApiResponse)
        // Agent B → mcp_approval_request
        .mockResolvedValueOnce(makeMcpApprovalResponse(
          'apr-deep-1', 'customer-mcp', 'search', '{"q":"x"}', 'resp-b-1',
        ))
        // Resume step 1: MCP approval → B's model (innermost)
        .mockResolvedValueOnce(makeTextResponse('Found 5 results.', 'resp-b-2'))
        // Resume step 2: B's output → A's model (middle)
        .mockResolvedValueOnce(makeTextResponse('Agent A processed: 5 results.', 'resp-a-2'))
        // Resume step 3: A's output → Router's model (outermost)
        .mockResolvedValueOnce(makeTextResponse('Deep MCP chain completed.', 'resp-router-2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const result1 = await run('deep mcp search', makeOptions({
      model,
      agents: { router: routerAgent, a: agentA, b: agentB },
      defaultAgent: 'router',
    }));

    expect(result1.pendingApproval).toBeDefined();
    expect(result1.pendingApproval!.approvalRequestId).toBe('apr-deep-1');

    const state = createInterruptedStateFromResult(result1);
    expect(state.subAgentContext).toBeDefined();
    expect(state.subAgentContext!.inner).toBeDefined();
    expect(state.subAgentContext!.inner!.subAgentKey).toBe('b');

    const result2 = await run('deep mcp search', makeOptions({
      model,
      agents: { router: routerAgent, a: agentA, b: agentB },
      defaultAgent: 'router',
      resumeState: state,
      approvalDecisions: [{ callId: 'apr-deep-1', approved: true }],
    }));

    expect(result2.content).toBe('Deep MCP chain completed.');

    const calls = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls;

    // Call 4 (index 3): MCP approval → B's model
    const bInput = calls[3][0] as ResponsesApiInputItem[];
    expect(bInput).toHaveLength(1);
    expect(bInput[0]).toEqual({
      type: 'mcp_approval_response',
      approval_request_id: 'apr-deep-1',
      approve: true,
      reason: undefined,
    });

    // Call 5 (index 4): B's output wrapped → A's model
    const aInput = calls[4][0] as ResponsesApiInputItem[];
    expect(aInput).toHaveLength(1);
    expect(aInput[0]).toEqual({
      type: 'function_call_output',
      call_id: 'a-c1',
      output: 'Found 5 results.',
    });

    // Call 6 (index 5): A's output wrapped → Router's model
    const routerInput = calls[5][0] as ResponsesApiInputItem[];
    expect(routerInput).toHaveLength(1);
    expect(routerInput[0]).toEqual({
      type: 'function_call_output',
      call_id: 'router-c1',
      output: 'Agent A processed: 5 results.',
    });
  });
});

describe('Streaming HITL: rejection', () => {
  it('sends rejection function_call_output for rejected client-side tool', async () => {
    const model = makeStreamModel(
      makeFunctionCallResponse([
        { callId: 'c1', name: 'dangerous_tool', args: '{}' },
      ], 'resp-sr1'),
      makeTextResponse('Understood, rejected.', 'resp-sr2'),
    );

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];

    const stream1 = runStream('do dangerous', makeStreamOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool],
    }));
    await collectEvents(stream1);

    const state = createInterruptedStateFromResult(stream1.result);

    const stream2 = runStream('do dangerous', makeStreamOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'c1', approved: false, reason: 'Too risky' }],
    }));
    await collectEvents(stream2);

    expect(stream2.result.content).toBe('Understood, rejected.');

    const resumedInput = (model.chatTurnStream as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(1);
    expect(resumedInput[0]).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: 'Tool call rejected by human. Reason: Too risky',
    });
  });

  it('sends rejection for MCP approval via stream', async () => {
    const model = makeStreamModel(
      makeMcpApprovalResponse('apr_r1', 'k8s-mcp', 'delete_pod', '{}', 'resp-mr1'),
      makeTextResponse('OK, cancelled.', 'resp-mr2'),
    );

    const stream1 = runStream('delete pod', makeStreamOptions({ model }));
    await collectEvents(stream1);

    const state = createInterruptedStateFromResult(stream1.result);

    const stream2 = runStream('delete pod', makeStreamOptions({
      model,
      resumeState: state,
      approvalDecisions: [{ callId: 'apr_r1', approved: false, reason: 'Nope' }],
    }));
    await collectEvents(stream2);

    expect(stream2.result.content).toBe('OK, cancelled.');

    const resumedInput = (model.chatTurnStream as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toEqual([
      { type: 'mcp_approval_response', approval_request_id: 'apr_r1', approve: false, reason: 'Nope' },
    ]);
  });
});

describe('Streaming HITL: mixed auto-approved + needs-approval', () => {
  it('preserves auto-approved calls alongside needs-approval in streaming', async () => {
    const model = makeStreamModel(
      makeFunctionCallResponse([
        { callId: 'c-safe', name: 'safe_tool', args: '{}' },
        { callId: 'c-danger', name: 'dangerous_tool', args: '{}' },
      ], 'resp-smix1'),
      makeTextResponse('Both ran via stream.', 'resp-smix2'),
    );

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: { always: ['dangerous_tool'], never: ['safe_tool'] } },
    ];

    const stream1 = runStream('mix', makeStreamOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool],
    }));
    await collectEvents(stream1);

    expect(stream1.result.pendingApprovals).toHaveLength(1);
    expect(stream1.result.autoApprovedCalls).toHaveLength(1);

    const state = createInterruptedStateFromResult(stream1.result);

    const stream2 = runStream('mix', makeStreamOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [safeTool, dangerousTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'c-danger', approved: true }],
    }));
    await collectEvents(stream2);

    expect(stream2.result.content).toBe('Both ran via stream.');

    const resumedInput = (model.chatTurnStream as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(2);
    const safeOut = resumedInput.find((i: any) => i.call_id === 'c-safe') as any;
    const dangerOut = resumedInput.find((i: any) => i.call_id === 'c-danger') as any;
    expect(safeOut.output).toBe('safe result');
    expect(dangerOut.output).toBe('executed');
  });
});

describe('HITL failure modes', () => {
  it('handles tool execution failure after approval gracefully', async () => {
    const failingTool = tool({
      name: 'failing_tool',
      description: 'A tool that always fails',
      parameters: { type: 'object', properties: {} },
      execute: async () => { throw new Error('Boom!'); },
    });

    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c1', name: 'failing_tool', args: '{}' },
        ], 'resp-f1'))
        .mockResolvedValueOnce(makeTextResponse('Handled the error.', 'resp-f2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];

    const result1 = await run('fail test', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [failingTool],
    }));

    expect(result1.pendingApprovals).toHaveLength(1);

    const state = createInterruptedStateFromResult(result1);
    const result2 = await run('fail test', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [failingTool],
      resumeState: state,
      approvalDecisions: [{ callId: 'c1', approved: true }],
    }));

    expect(result2.content).toBe('Handled the error.');
    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(1);
    expect(resumedInput[0].call_id).toBe('c1');
    expect((resumedInput[0] as any).output).toContain('Boom!');
  });

  it('warns on duplicate callIds in approvalDecisions (last wins)', async () => {
    const warnFn = vi.fn();
    const logger = { ...noopLogger, warn: warnFn };

    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeFunctionCallResponse([
          { callId: 'c1', name: 'dangerous_tool', args: '{}' },
        ], 'resp-d1'))
        .mockResolvedValueOnce(makeTextResponse('ok', 'resp-d2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const mcpServers: MCPServerConfig[] = [
      { id: 'function', name: 'function', type: 'streamable-http', url: '', requireApproval: 'always' },
    ];

    const result1 = await run('dup test', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool],
      logger,
    }));

    const state = createInterruptedStateFromResult(result1);
    await run('dup test', makeOptions({
      model,
      mcpServers,
      approvalStore: new ApprovalStore(),
      functionTools: [dangerousTool],
      resumeState: state,
      approvalDecisions: [
        { callId: 'c1', approved: false },
        { callId: 'c1', approved: true },
      ],
      logger,
    }));

    expect(warnFn).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate approvalDecision for callId "c1"'),
    );

    const resumedInput = (model.chatTurn as ReturnType<typeof vi.fn>).mock.calls[1][0] as ResponsesApiInputItem[];
    expect(resumedInput).toHaveLength(1);
    expect(resumedInput[0]).toEqual({
      type: 'function_call_output',
      call_id: 'c1',
      output: 'executed',
    });
  });

  it('warns on unknown MCP callIds in approvalDecisions', async () => {
    const warnFn = vi.fn();
    const logger = { ...noopLogger, warn: warnFn };

    const model = {
      chatTurn: vi.fn()
        .mockResolvedValueOnce(makeMcpApprovalResponse('apr-1', 'mcp-srv', 'some_tool', '{}', 'resp-m1'))
        .mockResolvedValueOnce(makeTextResponse('done', 'resp-m2')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    const result1 = await run('mcp test', makeOptions({ model, logger }));
    const state = createInterruptedStateFromResult(result1);

    await run('mcp test', makeOptions({
      model,
      resumeState: state,
      approvalDecisions: [
        { callId: 'apr-1', approved: true },
        { callId: 'wrong-id', approved: true },
      ],
      logger,
    }));

    expect(warnFn).toHaveBeenCalledWith(
      expect.stringContaining('not found in pendingMcpApprovals'),
    );
    expect(warnFn).toHaveBeenCalledWith(
      expect.stringContaining('wrong-id'),
    );
  });

  it('warns when isInterrupted is true but no pending work exists', async () => {
    const warnFn = vi.fn();
    const logger = { ...noopLogger, warn: warnFn };

    const model = {
      chatTurn: vi.fn().mockResolvedValue(makeTextResponse('ok')),
      chatTurnStream: vi.fn(),
      testConnection: vi.fn(),
    } as unknown as Model;

    await run('empty resume', makeOptions({
      model,
      logger,
      resumeState: {
        currentAgentKey: 'admin',
        turn: 0,
        agentPath: ['admin'],
        pendingToolCalls: [],
        isInterrupted: true,
      },
    }));

    expect(warnFn).toHaveBeenCalledWith(
      expect.stringContaining('neither pendingMcpApprovals nor pendingToolCalls contain entries'),
    );
  });

  it('deserializeRunState rejects malformed JSON', () => {
    expect(() => deserializeRunState('not json')).toThrow();
    expect(() => deserializeRunState('{}')).toThrow(/currentAgentKey/);
    expect(() => deserializeRunState('{"currentAgentKey":"a","isInterrupted":true}')).toThrow(/pendingToolCalls/);
    expect(() => deserializeRunState('{"currentAgentKey":"a","isInterrupted":true,"pendingToolCalls":[]}')).toThrow(/agentPath/);
    expect(() => deserializeRunState('{"currentAgentKey":"a","isInterrupted":true,"pendingToolCalls":[],"agentPath":[]}')).not.toThrow();
  });
});
