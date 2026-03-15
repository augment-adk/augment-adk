import type { NormalizedStreamEvent } from './events';
import { LS_ITEM_TYPE } from './constants';
import { sanitizeMcpError } from './errorSanitizer';

type RawEvent = Record<string, unknown>;
type RawItem = Record<string, unknown>;
type RawPart = Record<string, unknown>;

function hasResponse(e: RawEvent): e is RawEvent & { response: RawEvent } {
  return typeof e.response === 'object' && e.response !== null;
}
function hasItem(e: RawEvent): e is RawEvent & { item: RawItem } {
  return typeof e.item === 'object' && e.item !== null;
}
function hasPart(e: RawEvent): e is RawEvent & { part: RawPart } {
  return typeof e.part === 'object' && e.part !== null;
}

export function handleResponseCreated(event: RawEvent): NormalizedStreamEvent {
  const responseId = hasResponse(event)
    ? (event.response as RawEvent).id || event.response_id || ''
    : (event.response_id as string) || '';
  const model = hasResponse(event) ? (event.response as RawEvent).model : undefined;
  const createdAt = hasResponse(event) ? (event.response as RawEvent).created_at : undefined;
  return {
    type: 'stream.started',
    responseId: String(responseId),
    model: model as string | undefined,
    createdAt: typeof createdAt === 'number' ? createdAt : undefined,
  };
}

export function handleResponseCompleted(event: RawEvent): NormalizedStreamEvent {
  if (!hasResponse(event)) {
    return { type: 'stream.completed', responseId: undefined, usage: undefined };
  }
  const response = event.response as RawEvent;
  const usage = response.usage as RawEvent | undefined;

  return {
    type: 'stream.completed',
    responseId: response.id as string | undefined,
    usage: usage
      ? {
          input_tokens: (usage.input_tokens as number) ?? 0,
          output_tokens: (usage.output_tokens as number) ?? 0,
          total_tokens: (usage.total_tokens as number) ?? 0,
          input_tokens_details: usage.input_tokens_details as Record<string, unknown> | undefined,
          output_tokens_details: usage.output_tokens_details as Record<string, unknown> | undefined,
        }
      : undefined,
  };
}

export function handleOutputItemAdded(event: RawEvent): NormalizedStreamEvent[] {
  if (!hasItem(event)) return [];
  const item = event.item as RawItem;
  const itemType = (item.type as string) ?? '';

  switch (itemType) {
    case LS_ITEM_TYPE.MCP_APPROVAL_REQUEST:
      return [{
        type: 'stream.tool.approval',
        callId: (item.id as string) ?? '',
        name: (item.name as string) ?? '',
        serverLabel: item.server_label as string | undefined,
        arguments: item.arguments as string | undefined,
      }];
    case LS_ITEM_TYPE.FUNCTION_CALL:
    case LS_ITEM_TYPE.MCP_CALL:
      return [{
        type: 'stream.tool.started',
        callId: (item.id as string) ?? '',
        name: (item.name as string) ?? '',
        serverLabel: item.server_label as string | undefined,
      }];
    default:
      return [];
  }
}

export function handleOutputItemDone(event: RawEvent): NormalizedStreamEvent[] {
  if (!hasItem(event)) return [];
  const item = event.item as RawItem;
  const itemType = (item.type as string) ?? '';
  const results: NormalizedStreamEvent[] = [];

  if (itemType === LS_ITEM_TYPE.FILE_SEARCH_CALL) {
    const ragEvent = mapFileSearchResult(item);
    if (ragEvent) results.push(ragEvent);
  }

  if (itemType === LS_ITEM_TYPE.FUNCTION_CALL || itemType === LS_ITEM_TYPE.MCP_CALL) {
    results.push(mapToolCallResult(item));
  }

  if (itemType === LS_ITEM_TYPE.FUNCTION_CALL_OUTPUT) {
    const outputEvent = mapFunctionCallOutput(item);
    if (outputEvent) results.push(outputEvent);
  }

  return results;
}

export function handleContentPartDone(event: RawEvent): NormalizedStreamEvent[] {
  if (!hasPart(event)) return [];
  const part = event.part as RawPart;
  if (part.type === 'output_text' && typeof part.text === 'string') {
    return [{ type: 'stream.text.done', text: part.text }];
  }
  return [];
}

export function handleArgumentsDelta(event: RawEvent): NormalizedStreamEvent[] {
  const delta = event.delta as string | undefined;
  const itemId = event.item_id as string | undefined;
  if (!delta || !itemId) return [];
  return [{ type: 'stream.tool.delta', callId: itemId, delta }];
}

export function handleMcpCallCompleted(event: RawEvent): NormalizedStreamEvent[] {
  const itemId = event.item_id as string | undefined;
  if (!itemId) return [];
  return [{
    type: 'stream.tool.completed',
    callId: itemId,
    name: (event.name as string) || '',
    serverLabel: event.server_label as string | undefined,
    output: event.output as string | undefined,
  }];
}

export function handleMcpCallFailed(event: RawEvent): NormalizedStreamEvent[] {
  const itemId = event.item_id as string | undefined;
  if (!itemId) return [];
  const rawError = (event.error as string) || 'Tool call failed';
  const serverLabel = event.server_label as string | undefined;
  return [{
    type: 'stream.tool.failed',
    callId: itemId,
    name: (event.name as string) || '',
    serverLabel,
    error: sanitizeMcpError(rawError, serverLabel),
  }];
}

export function handleMcpCallRequiresApproval(event: RawEvent): NormalizedStreamEvent[] {
  const itemId =
    (event.item_id as string) || (event.id as string) || (event.call_id as string);
  if (!itemId) return [];
  return [{
    type: 'stream.tool.approval',
    callId: itemId,
    name: (event.name as string) || '',
    serverLabel: event.server_label as string | undefined,
    arguments: event.arguments as string | undefined,
  }];
}

export function extractResponseFailedError(event: RawEvent): string {
  let raw: string | undefined;
  if (hasResponse(event)) {
    const resp = event.response as RawEvent;
    const errObj = resp.error as RawEvent | string | undefined;
    if (typeof errObj === 'string') raw = errObj;
    else if (errObj && typeof (errObj as RawEvent).message === 'string')
      raw = (errObj as RawEvent).message as string;
    else if (typeof resp.status_reason === 'string') raw = resp.status_reason as string;
  }
  if (!raw && event.error) {
    if (typeof event.error === 'string') raw = event.error;
    else if (typeof (event.error as RawEvent)?.message === 'string')
      raw = (event.error as RawEvent).message as string;
  }
  if (!raw && event.message) raw = event.message as string;
  return sanitizeMcpError(raw || 'Response generation failed');
}

function mapFileSearchResult(item: RawItem): NormalizedStreamEvent | undefined {
  if (!Array.isArray(item.results)) return undefined;
  const valid = item.results.filter(
    (r: unknown) => r !== null && r !== undefined && typeof r === 'object',
  );
  return {
    type: 'stream.rag.results',
    sources: valid.map((r: RawEvent) => {
      const attrs = r.attributes as Record<string, unknown> | undefined;
      return {
        filename: (r.filename ?? r.file_id ?? '') as string,
        fileId: r.file_id as string | undefined,
        text: r.text as string | undefined,
        score: r.score as number | undefined,
        title: attrs?.title as string | undefined,
        sourceUrl: attrs?.source_url as string | undefined,
        contentType: attrs?.content_type as string | undefined,
        attributes: attrs,
      };
    }),
    filesSearched: valid
      .map((r: RawEvent) => (r.filename ?? r.name ?? r.file_id ?? '') as string)
      .filter(Boolean),
  };
}

function mapToolCallResult(item: RawItem): NormalizedStreamEvent {
  if (item.error) {
    let errorStr: string;
    if (typeof item.error === 'string') errorStr = item.error;
    else if (typeof (item.error as RawEvent)?.message === 'string')
      errorStr = (item.error as RawEvent).message as string;
    else errorStr = String(item.error ?? '');
    return {
      type: 'stream.tool.failed',
      callId: (item.id as string) ?? '',
      name: (item.name as string) ?? '',
      serverLabel: item.server_label as string | undefined,
      error: errorStr,
    };
  }
  return {
    type: 'stream.tool.completed',
    callId: (item.id as string) ?? '',
    name: (item.name as string) ?? '',
    serverLabel: item.server_label as string | undefined,
    output: stringifyOutput(item.output),
  };
}

function mapFunctionCallOutput(item: RawItem): NormalizedStreamEvent | undefined {
  const callId = item.call_id as string | undefined;
  if (!callId) return undefined;
  return {
    type: 'stream.tool.completed',
    callId,
    name: '',
    output: stringifyOutput(item.output),
  };
}

function stringifyOutput(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  if (output !== null && output !== undefined) return JSON.stringify(output, null, 2);
  return undefined;
}
