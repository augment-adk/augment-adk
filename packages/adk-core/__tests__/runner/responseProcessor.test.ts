import { describe, it, expect } from 'vitest';
import {
  processResponse,
  extractTextFromResponse,
  extractServerToolCallId,
} from '../../src/runner/responseProcessor';
import type { ResponsesApiResponse, ResponsesApiOutputEvent } from '../../src/types/responsesApi';

function makeResponse(output: ResponsesApiOutputEvent[] = []): ResponsesApiResponse {
  return { id: 'resp-1', output };
}

describe('processResponse', () => {
  it('extracts text from message output', () => {
    const result = processResponse(makeResponse([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello world' }] },
    ]));
    expect(result.content).toBe('hello world');
    expect(result.responseId).toBe('resp-1');
  });

  it('returns fallback when no text and no tools', () => {
    const result = processResponse(makeResponse([]));
    expect(result.content).toBe('I could not generate a response.');
  });

  it('returns empty string when has tool activity but no text', () => {
    const result = processResponse(makeResponse([
      { type: 'function_call', id: 'c1', name: 'fn', arguments: '{}', call_id: 'c1' },
    ]));
    expect(result.content).toBe('');
    expect(result.toolCalls).toHaveLength(1);
  });

  it('extracts RAG sources from file_search_call', () => {
    const result = processResponse(makeResponse([
      {
        type: 'file_search_call',
        results: [
          {
            filename: 'doc.txt',
            file_id: 'f1',
            score: 0.95,
            text: 'content',
            attributes: { title: 'Doc', source_url: 'http://doc', content_type: 'text/plain' },
          },
        ],
      } as ResponsesApiOutputEvent,
    ]));
    expect(result.ragSources).toHaveLength(1);
    expect(result.ragSources![0].filename).toBe('doc.txt');
    expect(result.ragSources![0].sourceUrl).toBe('http://doc');
  });

  it('deduplicates RAG sources by key', () => {
    const result = processResponse(makeResponse([
      {
        type: 'file_search_call',
        results: [
          { filename: 'doc.txt', file_id: 'f1', attributes: { source_url: 'http://same' } },
          { filename: 'doc2.txt', file_id: 'f2', attributes: { source_url: 'http://same' } },
        ],
      } as ResponsesApiOutputEvent,
    ]));
    expect(result.ragSources).toHaveLength(1);
  });

  it('skips null RAG results', () => {
    const result = processResponse(makeResponse([
      { type: 'file_search_call', results: [null, undefined] } as any,
    ]));
    expect(result.ragSources).toBeUndefined();
  });

  it('extracts MCP calls', () => {
    const result = processResponse(makeResponse([
      {
        type: 'mcp_call',
        id: 'mc1',
        name: 'mcp_tool',
        server_label: 'srv',
        arguments: '{"x":1}',
        output: 'done',
      } as ResponsesApiOutputEvent,
    ]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('mcp_tool');
    expect(result.toolCalls![0].serverLabel).toBe('srv');
  });

  it('extracts function_call with function_call_output', () => {
    const result = processResponse(makeResponse([
      { type: 'function_call', id: 'c1', name: 'fn', arguments: '{}', call_id: 'c1' },
      { type: 'function_call_output', call_id: 'c1', output: 'fn result' },
    ]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].output).toBe('fn result');
  });

  it('extracts reasoning items', () => {
    const result = processResponse(makeResponse([
      {
        type: 'reasoning',
        id: 'r1',
        summary: [{ type: 'summary_text', text: 'I thought about it' }],
      } as ResponsesApiOutputEvent,
    ]));
    expect(result.reasoning).toHaveLength(1);
    expect(result.reasoning![0].text).toBe('I thought about it');
  });

  it('handles usage', () => {
    const resp: ResponsesApiResponse = {
      id: 'r1',
      output: [],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    };
    const result = processResponse(resp);
    expect(result.usage?.input_tokens).toBe(10);
  });

  it('handles response with no output', () => {
    const result = processResponse({ id: 'r1' } as ResponsesApiResponse);
    expect(result.content).toBe('I could not generate a response.');
  });

  it('handles MCP call with no name', () => {
    const result = processResponse(makeResponse([
      { type: 'mcp_call', id: 'mc1' } as ResponsesApiOutputEvent,
    ]));
    expect(result.toolCalls![0].name).toBe('Unknown tool');
  });
});

describe('extractTextFromResponse', () => {
  it('extracts text from first message', () => {
    const text = extractTextFromResponse(makeResponse([
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hi' }] },
    ]));
    expect(text).toBe('hi');
  });

  it('returns empty for non-message output', () => {
    expect(extractTextFromResponse(makeResponse([
      { type: 'function_call', id: 'c', name: 'f', arguments: '{}', call_id: 'c' },
    ]))).toBe('');
  });

  it('returns empty for no output', () => {
    expect(extractTextFromResponse({ id: 'r1' } as ResponsesApiResponse)).toBe('');
  });
});

describe('extractServerToolCallId', () => {
  it('extracts call_id from mcp_call', () => {
    expect(extractServerToolCallId([
      { type: 'mcp_call', call_id: 'mc1' } as ResponsesApiOutputEvent,
    ])).toBe('mc1');
  });

  it('extracts id from function_call', () => {
    expect(extractServerToolCallId([
      { type: 'function_call', id: 'fc1', name: 'fn', arguments: '{}' } as ResponsesApiOutputEvent,
    ])).toBe('fc1');
  });

  it('extracts from file_search_call', () => {
    expect(extractServerToolCallId([
      { type: 'file_search_call', id: 'fs1' } as ResponsesApiOutputEvent,
    ])).toBe('fs1');
  });

  it('returns undefined when no tool call', () => {
    expect(extractServerToolCallId([
      { type: 'message', role: 'assistant' } as ResponsesApiOutputEvent,
    ])).toBeUndefined();
  });
});
