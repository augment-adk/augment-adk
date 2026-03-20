import type {
  ResponsesApiResponse,
  ResponsesApiOutputEvent,
  ResponseUsage,
} from '../types/responsesApi';
import { LS_EVENT } from './constants';

/**
 * Accumulates raw Responses API SSE event strings into a
 * `ResponsesApiResponse` that the OutputClassifier can process.
 *
 * During a streaming turn the model emits fine-grained events
 * (`response.output_item.done`, `response.created`, etc.).
 * This class collects them so the run loop can classify the
 * full response at the end of the turn — the same way the
 * non-streaming path classifies `chatTurn()` responses.
 */
export class StreamAccumulator {
  private responseId = '';
  private model?: string;
  private outputItems: ResponsesApiOutputEvent[] = [];
  private usage?: ResponseUsage;
  private error?: { message?: string; code?: string };

  /**
   * Feed a raw SSE JSON string from `chatTurnStream`.
   * Only events relevant to response reconstruction are stored;
   * everything else (text deltas, reasoning deltas) is ignored
   * because the run loop forwards those in real time.
   */
  processEvent(rawJson: string): void {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(rawJson);
    } catch {
      return;
    }

    const type = event.type as string | undefined;

    switch (type) {
      case LS_EVENT.RESPONSE_CREATED: {
        const resp = event.response as Record<string, unknown> | undefined;
        this.responseId = (resp?.id as string) ?? '';
        this.model = resp?.model as string | undefined;
        break;
      }

      case LS_EVENT.OUTPUT_ITEM_DONE: {
        const item = event.item as ResponsesApiOutputEvent | undefined;
        if (item) this.outputItems.push(item);
        break;
      }

      case LS_EVENT.RESPONSE_COMPLETED: {
        const resp = event.response as Record<string, unknown> | undefined;
        this.usage = resp?.usage as ResponseUsage | undefined;
        break;
      }

      case LS_EVENT.RESPONSE_FAILED:
      case LS_EVENT.ERROR: {
        const resp = event.response as Record<string, unknown> | undefined;
        const errObj = (resp?.error ?? event.error) as
          | { message?: string; code?: string }
          | undefined;
        if (errObj) {
          this.error = {
            message: errObj.message ?? String(errObj),
            code: errObj.code,
          };
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * Build the accumulated response for classification.
   * Safe to call multiple times (idempotent).
   */
  getResponse(): ResponsesApiResponse {
    return {
      id: this.responseId,
      output: this.outputItems,
      usage: this.usage,
      model: this.model,
      error: this.error,
    };
  }

  /** Clear state for the next turn. */
  reset(): void {
    this.responseId = '';
    this.model = undefined;
    this.outputItems = [];
    this.usage = undefined;
    this.error = undefined;
  }
}
