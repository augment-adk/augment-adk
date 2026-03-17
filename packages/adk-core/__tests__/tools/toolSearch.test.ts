import { describe, it, expect, vi } from 'vitest';
import {
  StaticToolSearchProvider,
  RemoteToolSearchProvider,
} from '../../src/tools/toolSearch';
import type { FunctionTool } from '../../src/tools/tool';
import type { ResolvedToolInfo } from '../../src/tools/toolResolver';

function makeFunctionTool(name: string, description: string): FunctionTool {
  return {
    type: 'function',
    name,
    description,
    parameters: {},
    execute: vi.fn().mockResolvedValue('result'),
  };
}

function makeResolvedToolInfo(name: string, description: string): ResolvedToolInfo {
  return {
    serverId: 'test-server',
    serverUrl: 'http://localhost',
    originalName: name,
    prefixedName: `test-server__${name}`,
    description,
    inputSchema: {},
  };
}

describe('StaticToolSearchProvider', () => {
  it('finds tools by name substring', async () => {
    const provider = new StaticToolSearchProvider([
      makeFunctionTool('calculate', 'Perform calculations'),
      makeFunctionTool('search', 'Search the web'),
      makeFunctionTool('calc_tax', 'Calculate tax'),
    ]);

    const results = await provider.search('calc');
    expect(results).toHaveLength(2);
    expect(results.map(r => ('name' in r.tool ? r.tool.name : r.tool.originalName)))
      .toEqual(expect.arrayContaining(['calculate', 'calc_tax']));
  });

  it('finds tools by description substring', async () => {
    const provider = new StaticToolSearchProvider([
      makeFunctionTool('web_search', 'Search the web for information'),
      makeFunctionTool('file_read', 'Read a file from disk'),
    ]);

    const results = await provider.search('web');
    expect(results).toHaveLength(1);
    expect((results[0].tool as FunctionTool).name).toBe('web_search');
  });

  it('returns empty for no matches', async () => {
    const provider = new StaticToolSearchProvider([
      makeFunctionTool('test', 'A test tool'),
    ]);

    const results = await provider.search('nonexistent');
    expect(results).toHaveLength(0);
  });

  it('handles ResolvedToolInfo items', async () => {
    const provider = new StaticToolSearchProvider([
      makeResolvedToolInfo('pods_list', 'List Kubernetes pods'),
    ]);

    const results = await provider.search('pods');
    expect(results).toHaveLength(1);
    expect((results[0].tool as ResolvedToolInfo).originalName).toBe('pods_list');
  });

  it('case insensitive search', async () => {
    const provider = new StaticToolSearchProvider([
      makeFunctionTool('MyTool', 'Does things'),
    ]);

    const results = await provider.search('mytool');
    expect(results).toHaveLength(1);
  });

  it('returns all tools for empty query', async () => {
    const provider = new StaticToolSearchProvider([
      makeFunctionTool('a', 'tool a'),
      makeFunctionTool('b', 'tool b'),
    ]);

    const results = await provider.search('');
    expect(results).toHaveLength(2);
  });

  it('handles special regex characters in query safely', async () => {
    const provider = new StaticToolSearchProvider([
      makeFunctionTool('my.tool', 'A tool with dots'),
      makeFunctionTool('other', 'Nothing here'),
    ]);

    const results = await provider.search('my.tool');
    expect(results).toHaveLength(1);
    expect((results[0].tool as FunctionTool).name).toBe('my.tool');
  });
});

describe('RemoteToolSearchProvider', () => {
  it('delegates to fetcher function', async () => {
    const mockTool = makeFunctionTool('remote_tool', 'A remote tool');
    const fetcher = vi.fn().mockResolvedValue([{ tool: mockTool, relevance: 0.95 }]);

    const provider = new RemoteToolSearchProvider(fetcher);
    const results = await provider.search('remote');

    expect(fetcher).toHaveBeenCalledWith('remote');
    expect(results).toHaveLength(1);
    expect(results[0].relevance).toBe(0.95);
  });

  it('handles empty results from fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue([]);
    const provider = new RemoteToolSearchProvider(fetcher);
    const results = await provider.search('nothing');
    expect(results).toHaveLength(0);
  });
});
