import { describe, it, expect } from 'vitest';
import { webSearchTool, fileSearchTool } from '../../src/tools/hostedTools';
import { hostedMcpTool } from '../../src/tools/hostedMcpTool';

describe('webSearchTool', () => {
  it('returns minimal web_search tool with no options', () => {
    const tool = webSearchTool();
    expect(tool).toEqual({ type: 'web_search' });
  });

  it('includes user location when provided', () => {
    const tool = webSearchTool({
      userLocation: { type: 'approximate', city: 'Paris', country: 'FR' },
    });
    expect(tool.type).toBe('web_search');
    expect(tool.user_location).toEqual({
      type: 'approximate',
      city: 'Paris',
      country: 'FR',
    });
  });

  it('includes search context size when provided', () => {
    const tool = webSearchTool({ searchContextSize: 'high' });
    expect(tool.search_context_size).toBe('high');
  });
});

describe('fileSearchTool', () => {
  it('returns file_search tool with required vector store IDs', () => {
    const tool = fileSearchTool({ vectorStoreIds: ['vs_1', 'vs_2'] });
    expect(tool.type).toBe('file_search');
    expect(tool.vector_store_ids).toEqual(['vs_1', 'vs_2']);
  });

  it('includes max results when provided', () => {
    const tool = fileSearchTool({ vectorStoreIds: ['vs_1'], maxNumResults: 5 });
    expect(tool.max_num_results).toBe(5);
  });

  it('includes ranking options when provided', () => {
    const tool = fileSearchTool({
      vectorStoreIds: ['vs_1'],
      rankingOptions: { ranker: 'default_2024_08_21', scoreThreshold: 0.5 },
    });
    expect(tool.ranking_options).toEqual({
      ranker: 'default_2024_08_21',
      score_threshold: 0.5,
    });
  });

  it('omits optional fields when not provided', () => {
    const tool = fileSearchTool({ vectorStoreIds: ['vs_1'] });
    expect(tool.max_num_results).toBeUndefined();
    expect(tool.ranking_options).toBeUndefined();
  });
});

describe('hostedMcpTool', () => {
  it('returns mcp tool with server URL', () => {
    const tool = hostedMcpTool({
      serverLabel: 'my-server',
      serverUrl: 'http://localhost:3001/mcp',
    });
    expect(tool.type).toBe('mcp');
    expect(tool.server_label).toBe('my-server');
    expect(tool.server_url).toBe('http://localhost:3001/mcp');
    expect(tool.require_approval).toBe('never');
  });

  it('sets connector_id when provided', () => {
    const tool = hostedMcpTool({
      serverLabel: 'connector-server',
      connectorId: 'conn_abc',
    });
    expect(tool.connector_id).toBe('conn_abc');
    expect(tool.server_url).toBe('');
  });

  it('passes require_approval setting', () => {
    const tool = hostedMcpTool({
      serverLabel: 'secure',
      serverUrl: 'http://localhost:3001',
      requireApproval: 'always',
    });
    expect(tool.require_approval).toBe('always');
  });

  it('passes headers and allowed tools', () => {
    const tool = hostedMcpTool({
      serverLabel: 'authed',
      serverUrl: 'http://localhost:3001',
      headers: { 'X-Api-Key': 'secret' },
      allowedTools: ['tool_a', 'tool_b'],
    });
    expect(tool.headers).toEqual({ 'X-Api-Key': 'secret' });
    expect(tool.allowed_tools).toEqual(['tool_a', 'tool_b']);
  });

  it('supports granular approval configuration', () => {
    const tool = hostedMcpTool({
      serverLabel: 'mixed',
      serverUrl: 'http://localhost:3001',
      requireApproval: { always: ['dangerous_tool'], never: ['safe_tool'] },
    });
    expect(tool.require_approval).toEqual({
      always: ['dangerous_tool'],
      never: ['safe_tool'],
    });
  });
});
