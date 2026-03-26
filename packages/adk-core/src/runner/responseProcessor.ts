import type {
  ResponsesApiResponse,
  ResponsesApiMessage,
  ResponsesApiFileSearchResult,
  ResponsesApiFunctionCall,
  ResponsesApiMcpCall,
  ResponsesApiReasoningItem,
} from '../types/responsesApi';
import type { ToolCallInfo } from './steps';
import type { RunResult } from './RunResult';

export interface ReasoningSummary {
  id: string;
  text: string;
}

export interface RAGSource {
  filename: string;
  fileId?: string;
  score?: number;
  text?: string;
  title?: string;
  sourceUrl?: string;
  contentType?: string;
  attributes?: Record<string, unknown>;
}

export interface ApprovalInfo {
  approvalRequestId: string;
  toolName: string;
  serverLabel?: string;
  arguments?: string;
}

/**
 * Process a raw Responses API response into a RunResult.
 *
 * Note: `mcp_approval_request` items are NOT extracted here. They are
 * handled by `DefaultOutputClassifier` (which prioritizes them as the
 * highest-priority classification) and then by `processTurnClassification`
 * in `turnProcessor.ts`, which overlays `pendingApproval` on the result.
 * This separation ensures the classifier sees the raw response first.
 */
export function processResponse(response: ResponsesApiResponse): RunResult {
  let textContent = '';
  const sources: RAGSource[] = [];
  const toolCalls: ToolCallInfo[] = [];
  const reasoningItems: ReasoningSummary[] = [];
  const seenSourceKeys = new Set<string>();

  const outputMap = new Map<string, string>();
  for (const item of response.output || []) {
    const raw = item as unknown as { type: string; call_id?: string; output?: string };
    if (raw.type === 'function_call_output' && raw.call_id) {
      outputMap.set(raw.call_id, raw.output ?? '');
    }
  }

  for (const item of response.output || []) {
    if (item.type === 'message') {
      const msg = item as ResponsesApiMessage;
      for (const c of msg.content || []) {
        if (c.type === 'output_text' && c.text) textContent += c.text;
      }
    } else if (item.type === 'reasoning') {
      const ri = item as ResponsesApiReasoningItem;
      if (ri.summary) {
        for (const s of ri.summary) {
          if (s.type === 'summary_text' && s.text) {
            reasoningItems.push({ id: ri.id, text: s.text });
          }
        }
      }
    } else if (item.type === 'file_search_call') {
      const fs = item as ResponsesApiFileSearchResult;
      if (fs.results) {
        for (const r of fs.results) {
          if (!r || typeof r !== 'object') continue;
          const attrs = r.attributes || {};
          const sourceUrl = attrs.source_url as string | undefined;
          const key = sourceUrl || r.file_id || r.filename || '';
          if (seenSourceKeys.has(key)) continue;
          seenSourceKeys.add(key);
          sources.push({
            filename: r.filename || r.file_id,
            fileId: r.file_id,
            score: r.score,
            text: r.text,
            title: attrs.title as string | undefined,
            sourceUrl,
            contentType: attrs.content_type as string | undefined,
            attributes: attrs,
          });
        }
      }
    } else if (item.type === 'mcp_call') {
      const mcp = item as ResponsesApiMcpCall;
      toolCalls.push({
        id: mcp.id,
        name: mcp.name || 'Unknown tool',
        serverLabel: mcp.server_label,
        arguments: mcp.arguments,
        output: mcp.output,
        error: mcp.error,
      });
    } else if (item.type === 'function_call') {
      const fc = item as ResponsesApiFunctionCall;
      toolCalls.push({
        id: fc.id,
        name: fc.name,
        serverLabel: 'function',
        arguments: fc.arguments,
        output: outputMap.get(fc.call_id) ?? fc.status,
      });
    }
  }

  const hasToolActivity = toolCalls.length > 0 || sources.length > 0;
  const fallbackContent = hasToolActivity
    ? ''
    : 'I could not generate a response.';

  return {
    content: textContent || fallbackContent,
    ragSources: sources.length > 0 ? sources : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    responseId: response.id,
    usage: response.usage,
    reasoning: reasoningItems.length > 0 ? reasoningItems : undefined,
  };
}

/**
 * Extract the text content from a raw ResponsesApiResponse.
 */
export function extractTextFromResponse(response: ResponsesApiResponse): string {
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    const msg = item as ResponsesApiMessage;
    for (const c of msg.content ?? []) {
      if (c.type === 'output_text' && c.text) return c.text;
    }
  }
  return '';
}

/**
 * Extract a server-side tool call_id from the response output.
 */
export function extractServerToolCallId(
  output: ResponsesApiResponse['output'],
): string | undefined {
  for (const item of output) {
    if (
      item.type === 'mcp_call' ||
      item.type === 'function_call' ||
      item.type === 'file_search_call'
    ) {
      const asAny = item as { call_id?: string; id?: string };
      return asAny.call_id ?? asAny.id;
    }
  }
  return undefined;
}
