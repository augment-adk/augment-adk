import { AdkError } from '@augment-adk/adk-core';

/**
 * Structured error for Responses API failures.
 * Preserves status code and parsed detail for actionable error handling.
 */
export class ResponsesApiError extends AdkError {
  readonly statusCode: number;
  readonly detail: string;
  readonly rawBody: string;

  constructor(statusCode: number, statusMessage: string, rawBody: string) {
    const detail = ResponsesApiError.extractDetail(rawBody);
    super(`Responses API error: ${statusCode} ${statusMessage} - ${detail}`);
    Object.setPrototypeOf(this, ResponsesApiError.prototype);
    this.name = 'ResponsesApiError';
    this.statusCode = statusCode;
    this.detail = detail;
    this.rawBody = rawBody;
  }

  isValidationError(): boolean {
    return this.statusCode === 400 || this.statusCode === 422;
  }

  mentionsToolType(): boolean {
    const combined = `${this.detail} ${this.rawBody}`;
    return /unsupported.*tool|tool.*type.*unsupported|function.*tool|unknown.*tool/i.test(combined);
  }

  mentionsStrictField(): boolean {
    const combined = `${this.detail} ${this.rawBody}`;
    return (
      /\bstrict\b.*\b(field|param|key|property|schema|valid)/i.test(combined) ||
      /\b(field|param|key|property|unexpected|extra|unknown)\b.*\bstrict\b/i.test(combined)
    );
  }

  /**
   * Detect context window overflow errors from vLLM / inference backends.
   * These manifest as "max_tokens must be at least 1, got -N" or similar.
   */
  isContextOverflowError(): boolean {
    const combined = `${this.detail} ${this.rawBody}`;
    return (
      this.statusCode === 400 &&
      /max_tokens\s+must\s+be\s+at\s+least\s+1,\s+got\s+-?\d+/i.test(combined)
    );
  }

  private static extractDetail(rawBody: string): string {
    try {
      const parsed = JSON.parse(rawBody);
      if (typeof parsed.detail === 'string') return parsed.detail;
      if (Array.isArray(parsed.detail)) {
        return parsed.detail
          .map((d: { msg?: string; loc?: unknown[] }) =>
            d.msg
              ? `${d.msg}${d.loc ? ` at ${JSON.stringify(d.loc)}` : ''}`
              : JSON.stringify(d),
          )
          .join('; ');
      }
      if (typeof parsed.error === 'string') return parsed.error;
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // Not JSON — return raw
    }
    return rawBody.length > 300 ? `${rawBody.substring(0, 300)}...` : rawBody;
  }
}
