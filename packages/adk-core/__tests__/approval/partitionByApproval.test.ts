import { describe, it, expect } from 'vitest';
import { partitionByApproval } from '../../src/approval/partitionByApproval';
import { ToolResolver } from '../../src/tools/toolResolver';
import { noopLogger } from '../../src/logger';
import type { MCPServerConfig } from '../../src/types/modelConfig';

function makeResolver(): ToolResolver {
  const resolver = new ToolResolver(noopLogger);
  resolver.register({
    serverId: 'srv-a',
    serverUrl: '',
    originalName: 'tool_a',
    prefixedName: 'srv-a__tool_a',
    description: '',
    inputSchema: {},
  });
  resolver.register({
    serverId: 'srv-b',
    serverUrl: '',
    originalName: 'tool_b',
    prefixedName: 'srv-b__tool_b',
    description: '',
    inputSchema: {},
  });
  return resolver;
}

describe('partitionByApproval', () => {
  it('approves calls with no server info', () => {
    const resolver = new ToolResolver(noopLogger);
    const { approved, needsApproval } = partitionByApproval(
      [{ callId: 'c1', name: 'unknown_tool', arguments: '{}' }],
      resolver,
      [],
    );
    expect(approved).toHaveLength(1);
    expect(needsApproval).toHaveLength(0);
  });

  it('approves calls when server has no requireApproval', () => {
    const resolver = makeResolver();
    const servers: MCPServerConfig[] = [{ id: 'srv-a', url: '' }];
    const { approved, needsApproval } = partitionByApproval(
      [{ callId: 'c1', name: 'srv-a__tool_a', arguments: '{}' }],
      resolver,
      servers,
    );
    expect(approved).toHaveLength(1);
    expect(needsApproval).toHaveLength(0);
  });

  it('approves calls when requireApproval is never', () => {
    const resolver = makeResolver();
    const servers: MCPServerConfig[] = [
      { id: 'srv-a', url: '', requireApproval: 'never' as 'never' },
    ];
    const { approved } = partitionByApproval(
      [{ callId: 'c1', name: 'srv-a__tool_a', arguments: '{}' }],
      resolver,
      servers,
    );
    expect(approved).toHaveLength(1);
  });

  it('requires approval when server has requireApproval set', () => {
    const resolver = makeResolver();
    const servers: MCPServerConfig[] = [
      { id: 'srv-a', url: '', requireApproval: 'always' as string },
    ];
    const { approved, needsApproval } = partitionByApproval(
      [{ callId: 'c1', name: 'srv-a__tool_a', arguments: '{}' }],
      resolver,
      servers,
    );
    expect(approved).toHaveLength(0);
    expect(needsApproval).toHaveLength(1);
  });

  it('partitions mixed calls correctly', () => {
    const resolver = makeResolver();
    const servers: MCPServerConfig[] = [
      { id: 'srv-a', url: '', requireApproval: 'always' as string },
      { id: 'srv-b', url: '' },
    ];
    const calls = [
      { callId: 'c1', name: 'srv-a__tool_a', arguments: '{}' },
      { callId: 'c2', name: 'srv-b__tool_b', arguments: '{}' },
      { callId: 'c3', name: 'unknown', arguments: '{}' },
    ];
    const { approved, needsApproval } = partitionByApproval(calls, resolver, servers);
    expect(approved).toHaveLength(2);
    expect(needsApproval).toHaveLength(1);
    expect(needsApproval[0].callId).toBe('c1');
  });

  it('approves when server not found in config', () => {
    const resolver = makeResolver();
    const { approved } = partitionByApproval(
      [{ callId: 'c1', name: 'srv-a__tool_a', arguments: '{}' }],
      resolver,
      [],
    );
    expect(approved).toHaveLength(1);
  });
});
