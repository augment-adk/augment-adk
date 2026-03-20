/**
 * Parses raw SSE lines from a LlamaStack stream into typed event objects.
 * This is the low-level parser used by the ResponsesApiClient.
 * Higher-level normalization is done by the stream/ module.
 */

export interface RawStreamEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Parse a single SSE data line (already stripped of "data: " prefix)
 * into a typed event object. Returns undefined for unparseable data.
 */
export function parseStreamEvent(data: string): RawStreamEvent | undefined {
  if (!data || data === '[DONE]') return undefined;

  try {
    const parsed = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as RawStreamEvent;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Split a buffer of SSE text into individual event data strings.
 * Handles the "data: " prefix and multi-line buffering.
 *
 * Returns an object with:
 * - `events`: parsed data strings (without the "data: " prefix)
 * - `remaining`: leftover buffer that doesn't end with a newline
 */
export function splitSseBuffer(buffer: string): {
  events: string[];
  remaining: string;
} {
  const lines = buffer.split('\n');
  const remaining = lines.pop() || '';
  const events: string[] = [];

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data && data !== '[DONE]') {
        events.push(data);
      }
    }
  }

  return { events, remaining };
}
