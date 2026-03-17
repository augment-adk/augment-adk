import type { ResponseUsage } from '../types/responsesApi';

/**
 * Normalized stream event types emitted by the LlamaStack event normalizer.
 * These are the only event shapes the frontend/consumer needs to handle.
 */
export type NormalizedStreamEvent =
  | { type: 'stream.started'; responseId: string; model?: string; createdAt?: number }
  | { type: 'stream.completed'; responseId?: string; usage?: ResponseUsage }
  | { type: 'stream.error'; error: string }
  | { type: 'stream.text.delta'; delta: string }
  | { type: 'stream.text.done'; text: string }
  | { type: 'stream.reasoning.delta'; delta: string }
  | { type: 'stream.reasoning.done'; text: string }
  | { type: 'stream.tool.started'; callId: string; name: string; serverLabel?: string }
  | { type: 'stream.tool.delta'; callId: string; delta: string }
  | {
      type: 'stream.tool.completed';
      callId: string;
      name: string;
      serverLabel?: string;
      output?: string;
    }
  | {
      type: 'stream.tool.failed';
      callId: string;
      name: string;
      serverLabel?: string;
      error: string;
    }
  | {
      type: 'stream.tool.approval';
      callId: string;
      name: string;
      serverLabel?: string;
      arguments?: string;
    }
  | {
      type: 'stream.tool.discovery';
      serverLabel?: string;
      status: 'in_progress' | 'completed';
      toolCount?: number;
    }
  | {
      type: 'stream.rag.results';
      sources: Array<{
        filename: string;
        fileId?: string;
        text?: string;
        score?: number;
        title?: string;
        sourceUrl?: string;
        contentType?: string;
        attributes?: Record<string, unknown>;
      }>;
      filesSearched: string[];
    };
