import { describe, it, expect, vi } from 'vitest';
import { executeToolCalls, type ToolExecutionDeps, type ToolCallRequest } from '../../src/tools/toolExecution';
import { ToolResolver } from '../../src/tools/toolResolver';
import { noopLogger } from '../../src/logger';
import type { FunctionTool } from '../../src/tools/tool';

function makeDeps(overrides?: Partial<ToolExecutionDeps>): ToolExecutionDeps {
  return {
    resolver: new ToolResolver(noopLogger),
    logger: noopLogger,
    ...overrides,
  };
}

function makeFunctionTool(name: string, output = 'tool result'): FunctionTool {
  return {
    type: 'function',
    name,
    description: name,
    parameters: {},
    execute: vi.fn().mockResolvedValue(output),
  };
}

function makeCall(name: string, callId = 'c1', args = '{}'): ToolCallRequest {
  return { callId, name, arguments: args };
}

describe('executeToolCalls', () => {
  it('executes local function tool', async () => {
    const tool = makeFunctionTool('my_tool');
    const deps = makeDeps({ functionTools: [tool] });
    const results = await executeToolCalls([makeCall('my_tool')], deps);
    expect(results).toHaveLength(1);
    expect(results[0].output).toBe('tool result');
    expect(results[0].name).toBe('my_tool');
  });

  it('handles local tool execution failure', async () => {
    const tool = makeFunctionTool('fail_tool');
    (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('exec error'));
    const deps = makeDeps({ functionTools: [tool] });
    const results = await executeToolCalls([makeCall('fail_tool')], deps);
    expect(results[0].error).toBe('exec error');
  });

  it('handles invalid JSON arguments for local tool', async () => {
    const tool = makeFunctionTool('my_tool');
    const deps = makeDeps({ functionTools: [tool] });
    await executeToolCalls([makeCall('my_tool', 'c1', 'not json')], deps);
    expect(tool.execute).toHaveBeenCalledWith({});
  });

  it('executes MCP tool via resolver', async () => {
    const resolver = new ToolResolver(noopLogger);
    resolver.register({
      serverId: 'srv', serverUrl: '', originalName: 'tool_a',
      prefixedName: 'srv__tool_a', description: '', inputSchema: {},
    });
    const mcpToolManager = {
      executeTool: vi.fn().mockResolvedValue('mcp result'),
    };
    const deps = makeDeps({ resolver, mcpToolManager: mcpToolManager as any });
    const results = await executeToolCalls([makeCall('srv__tool_a')], deps);
    expect(results[0].output).toBe('mcp result');
  });

  it('handles MCP tool execution failure', async () => {
    const resolver = new ToolResolver(noopLogger);
    resolver.register({
      serverId: 'srv', serverUrl: '', originalName: 'tool_a',
      prefixedName: 'srv__tool_a', description: '', inputSchema: {},
    });
    const mcpToolManager = {
      executeTool: vi.fn().mockRejectedValue(new Error('mcp fail')),
    };
    const deps = makeDeps({ resolver, mcpToolManager: mcpToolManager as any });
    const results = await executeToolCalls([makeCall('srv__tool_a')], deps);
    expect(results[0].error).toBe('mcp fail');
  });

  it('returns error for unknown tool without search provider', async () => {
    const deps = makeDeps();
    const results = await executeToolCalls([makeCall('missing_tool')], deps);
    expect(results[0].error).toContain('Unknown tool');
  });

  it('uses toolSearchProvider for deferred tool loading', async () => {
    const tool = makeFunctionTool('searched_tool', 'search result');
    const searchProvider = {
      search: vi.fn().mockResolvedValue([{ tool, relevance: 0.95 }]),
    };
    const deps = makeDeps({ toolSearchProvider: searchProvider as any });
    const results = await executeToolCalls([makeCall('searched_tool')], deps);
    expect(results[0].output).toBe('search result');
  });

  it('returns error when search finds no results', async () => {
    const searchProvider = {
      search: vi.fn().mockResolvedValue([]),
    };
    const deps = makeDeps({ toolSearchProvider: searchProvider as any });
    const results = await executeToolCalls([makeCall('missing')], deps);
    expect(results[0].error).toContain('Unknown tool');
  });

  it('handles search provider error', async () => {
    const searchProvider = {
      search: vi.fn().mockRejectedValue(new Error('search failed')),
    };
    const deps = makeDeps({ toolSearchProvider: searchProvider as any });
    const results = await executeToolCalls([makeCall('bad_tool')], deps);
    expect(results[0].error).toBe('search failed');
  });

  it('blocks tool with input guardrail', async () => {
    const tool = makeFunctionTool('dangerous');
    const deps = makeDeps({
      functionTools: [tool],
      toolGuardrails: [{
        toolPattern: 'dangerous',
        phase: 'input',
        action: 'block',
        message: 'Not allowed',
        contentPattern: '.*',
      }],
    });
    const results = await executeToolCalls(
      [makeCall('dangerous', 'c1', '{"key":"value"}')],
      deps,
    );
    expect(results[0].guardrailBlocked).toBe(true);
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('blocks tool output with output guardrail', async () => {
    const tool = makeFunctionTool('my_tool', 'sensitive data');
    const deps = makeDeps({
      functionTools: [tool],
      toolGuardrails: [{
        toolPattern: 'my_tool',
        phase: 'output',
        action: 'block',
        message: 'Output blocked',
        contentPattern: 'sensitive',
      }],
    });
    const results = await executeToolCalls([makeCall('my_tool')], deps);
    expect(results[0].guardrailBlocked).toBe(true);
  });

  it('uses custom toolErrorFormatter', async () => {
    const tool = makeFunctionTool('fail');
    (tool.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('oops'));
    const formatter = vi.fn().mockReturnValue('formatted error');
    const deps = makeDeps({ functionTools: [tool], toolErrorFormatter: formatter });
    const results = await executeToolCalls([makeCall('fail')], deps);
    expect(results[0].output).toBe('formatted error');
    expect(formatter).toHaveBeenCalledWith('fail', 'oops');
  });

  it('search finds ResolvedToolInfo and uses MCP manager', async () => {
    const resolvedTool = {
      serverId: 'srv',
      serverUrl: '',
      originalName: 'found_tool',
      prefixedName: 'srv__found_tool',
      description: 'A found tool',
      inputSchema: {},
    };
    const searchProvider = {
      search: vi.fn().mockResolvedValue([{ tool: resolvedTool, relevance: 0.9 }]),
    };
    const mcpToolManager = {
      executeTool: vi.fn().mockResolvedValue('mcp exec result'),
    };
    const deps = makeDeps({
      toolSearchProvider: searchProvider as any,
      mcpToolManager: mcpToolManager as any,
    });
    const results = await executeToolCalls([makeCall('found_tool')], deps);
    expect(results[0].output).toBe('mcp exec result');
  });

  it('search finds ResolvedToolInfo but no MCP manager', async () => {
    const resolvedTool = {
      serverId: 'srv', serverUrl: '', originalName: 'found',
      prefixedName: 'srv__found', description: '', inputSchema: {},
    };
    const searchProvider = {
      search: vi.fn().mockResolvedValue([{ tool: resolvedTool, relevance: 0.9 }]),
    };
    const deps = makeDeps({ toolSearchProvider: searchProvider as any });
    const results = await executeToolCalls([makeCall('found')], deps);
    expect(results[0].error).toContain('No MCP manager');
  });
});
