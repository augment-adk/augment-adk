import { AdkError } from '@augment-adk/adk-core';

/**
 * Structured error for Chat Completions API failures.
 * Preserves status code and parsed detail for actionable error handling.
 */
export class ChatCompletionsError extends AdkError {
  readonly statusCode: number;
  readonly detail: string;
  readonly rawBody: string;

  constructor(statusCode: number, rawBody: string) {
    const detail = ChatCompletionsError.extractDetail(rawBody);
    super(`Chat Completions API error: ${statusCode} - ${detail}`);
    Object.setPrototypeOf(this, ChatCompletionsError.prototype);
    this.name = 'ChatCompletionsError';
    this.statusCode = statusCode;
    this.detail = detail;
    this.rawBody = rawBody;
  }

  isRetryable(): boolean {
    return this.statusCode === 429 || this.statusCode >= 500;
  }

  private static extractDetail(rawBody: string): string {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed.error?.message) return parsed.error.message;
      if (typeof parsed.error === 'string') return parsed.error;
      if (typeof parsed.message === 'string') return parsed.message;
      if (typeof parsed.detail === 'string') return parsed.detail;
    } catch {
      // Not JSON
    }
    return rawBody.length > 300 ? `${rawBody.substring(0, 300)}...` : rawBody;
  }
}
