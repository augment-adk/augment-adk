import { describe, it, expect, vi } from 'vitest';
import {
  MCPToolManager,
  type MCPConnection,
  type MCPConnectionFactory,
} from '../../src/tools/mcpTool';
import { ToolResolver } from '../../src/tools/toolResolver';
import { noopLogger } from '../../src/logger';

function makeConnection(overrides?: Partial<MCPConnection>): MCPConnection {
  return {
    listTools: vi.fn().mockResolvedValue([
      { name: 'tool_a', description: 'Tool A', inputSchema: { type: 'object' } },
    ]),
    callTool: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFactory(conn?: MCPConnection): MCPConnectionFactory {
  return vi.fn().mockResolvedValue(conn ?? makeConnection());
}

describe('MCPToolManager', () => {
  describe('discoverTools', () => {
    it('discovers tools from server and registers them', async () => {
      const conn = makeConnection();
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);

      const tools = await manager.discoverTools(
        [{ id: 'srv1', url: 'http://srv1' }],
        resolver,
      );

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('srv1__tool_a');
      expect(resolver.size).toBe(1);
      expect(resolver.isKnown('srv1__tool_a')).toBe(true);
    });

    it('handles server discovery failure gracefully', async () => {
      const factory = vi.fn().mockRejectedValue(new Error('connection failed'));
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);

      const tools = await manager.discoverTools(
        [{ id: 'srv1', url: 'http://srv1' }],
        resolver,
      );

      expect(tools).toEqual([]);
    });

    it('handles tools with no inputSchema', async () => {
      const conn = makeConnection({
        listTools: vi.fn().mockResolvedValue([
          { name: 'bare_tool', description: 'No schema' },
        ]),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);

      const tools = await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);
      expect(tools).toHaveLength(1);
      expect(tools[0].parameters).toEqual({ type: 'object', properties: {} });
    });

    it('handles tools with no description', async () => {
      const conn = makeConnection({
        listTools: vi.fn().mockResolvedValue([{ name: 'no_desc' }]),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);

      const tools = await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);
      expect(tools[0].description).toContain('no_desc');
    });
  });

  describe('ensureDiscovered', () => {
    it('caches discovery results within TTL', async () => {
      const conn = makeConnection();
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({
        connectionFactory: factory,
        logger: noopLogger,
        discoveryTtlMs: 60000,
      });
      const resolver = new ToolResolver(noopLogger);

      const tools1 = await manager.ensureDiscovered([{ id: 'srv1', url: '' }], resolver);
      const tools2 = await manager.ensureDiscovered([{ id: 'srv1', url: '' }], resolver);

      expect(tools1).toBe(tools2);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('re-discovers when server key changes', async () => {
      const conn = makeConnection();
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({
        connectionFactory: factory,
        logger: noopLogger,
        discoveryTtlMs: 60000,
      });
      const resolver = new ToolResolver(noopLogger);

      await manager.ensureDiscovered([{ id: 'srv1', url: '' }], resolver);
      await manager.ensureDiscovered([{ id: 'srv2', url: '' }], resolver);

      expect(factory).toHaveBeenCalledTimes(2);
    });

    it('deduplicates concurrent discovery requests', async () => {
      const conn = makeConnection({
        listTools: vi.fn().mockImplementation(() =>
          new Promise(resolve => setTimeout(() => resolve([{ name: 'slow' }]), 10))
        ),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);

      const [r1, r2] = await Promise.all([
        manager.ensureDiscovered([{ id: 'srv1', url: '' }], resolver),
        manager.ensureDiscovered([{ id: 'srv1', url: '' }], resolver),
      ]);

      expect(r1).toBe(r2);
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeTool', () => {
    it('executes tool and returns formatted output', async () => {
      const conn = makeConnection();
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      const output = await manager.executeTool(resolver, 'srv1__tool_a', '{"x": 1}');
      expect(output).toBe('result');
      expect(conn.callTool).toHaveBeenCalledWith('tool_a', { x: 1 });
    });

    it('returns error for unknown tool', async () => {
      const manager = new MCPToolManager({ connectionFactory: makeFactory(), logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      const output = await manager.executeTool(resolver, 'missing', '{}');
      expect(JSON.parse(output).error).toContain('Unknown tool');
    });

    it('returns error when no connection', async () => {
      const factory = makeFactory();
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      resolver.register({
        serverId: 'gone', serverUrl: '', originalName: 'tool',
        prefixedName: 'gone__tool', description: '', inputSchema: {},
      });
      const output = await manager.executeTool(resolver, 'gone__tool', '{}');
      expect(JSON.parse(output).error).toContain('No connection');
    });

    it('handles tool error response', async () => {
      const conn = makeConnection({
        callTool: vi.fn().mockResolvedValue({
          isError: true,
          content: [{ type: 'text', text: 'permission denied' }],
        }),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      const output = await manager.executeTool(resolver, 'srv1__tool_a', '{}');
      expect(JSON.parse(output).error).toContain('permission denied');
    });

    it('handles execution exception', async () => {
      const conn = makeConnection({
        callTool: vi.fn().mockRejectedValue(new Error('network error')),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      const output = await manager.executeTool(resolver, 'srv1__tool_a', '{}');
      expect(JSON.parse(output).error).toContain('network error');
    });

    it('handles invalid JSON arguments', async () => {
      const conn = makeConnection();
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      await manager.executeTool(resolver, 'srv1__tool_a', 'not json');
      expect(conn.callTool).toHaveBeenCalledWith('tool_a', {});
    });

    it('handles non-array content', async () => {
      const conn = makeConnection({
        callTool: vi.fn().mockResolvedValue({ content: { data: 'value' } }),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      const output = await manager.executeTool(resolver, 'srv1__tool_a', '{}');
      expect(output).toContain('data');
    });

    it('truncates large output', async () => {
      const largeText = 'x'.repeat(30000);
      const conn = makeConnection({
        callTool: vi.fn().mockResolvedValue({
          content: [{ type: 'text', text: largeText }],
        }),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({
        connectionFactory: factory,
        logger: noopLogger,
        maxOutputChars: 1000,
      });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      const output = await manager.executeTool(resolver, 'srv1__tool_a', '{}');
      expect(output.length).toBeLessThan(largeText.length);
      expect(output).toContain('TRUNCATED');
    });

    it('handles error content as non-array', async () => {
      const conn = makeConnection({
        callTool: vi.fn().mockResolvedValue({
          isError: true,
          content: 'raw error string',
        }),
      });
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      const output = await manager.executeTool(resolver, 'srv1__tool_a', '{}');
      expect(JSON.parse(output).error).toBeDefined();
    });
  });

  describe('invalidateCache', () => {
    it('clears cached tools and closes connections', async () => {
      const conn = makeConnection();
      const factory = makeFactory(conn);
      const manager = new MCPToolManager({ connectionFactory: factory, logger: noopLogger });
      const resolver = new ToolResolver(noopLogger);
      await manager.discoverTools([{ id: 'srv1', url: '' }], resolver);

      manager.invalidateCache();
      await new Promise(r => setTimeout(r, 10));
      expect(conn.close).toHaveBeenCalled();
    });
  });

  describe('truncateOutput', () => {
    it('returns short output as-is', () => {
      expect(MCPToolManager.truncateOutput('short', 100)).toBe('short');
    });

    it('truncates long output with notice', () => {
      const long = 'x'.repeat(200);
      const result = MCPToolManager.truncateOutput(long, 100);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result).toContain('TRUNCATED');
    });

    it('handles edge case where notice is longer than maxChars', () => {
      const result = MCPToolManager.truncateOutput('x'.repeat(100), 10);
      expect(result.length).toBe(10);
    });
  });
});
