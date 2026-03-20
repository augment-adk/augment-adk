import * as http from 'http';
import * as https from 'https';
import type { ILogger } from '@augment-adk/adk-core';
import { toErrorMessage } from '@augment-adk/adk-core';
import { ResponsesApiError } from './errors';
import { splitSseBuffer } from './streamParser';

const API_REQUEST_TIMEOUT_MS = 120_000;
const STREAM_REQUEST_TIMEOUT_MS = 300_000;
const MAX_API_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 4_000;
const DEFAULT_MAX_SOCKETS = 10;

export interface ResponsesApiClientConfig {
  baseUrl: string;
  token?: string;
  skipTlsVerify?: boolean;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * HTTP client for any server implementing the OpenAI Responses API.
 * Handles JSON requests, SSE streaming, TLS, and retries.
 */
export class ResponsesApiClient {
  private readonly config: ResponsesApiClientConfig;
  private readonly agent: http.Agent | https.Agent;
  private readonly logger?: ILogger;

  constructor(config: ResponsesApiClientConfig, logger?: ILogger) {
    this.config = config;
    this.logger = logger;
    const isHttps = config.baseUrl.startsWith('https');
    this.agent = isHttps
      ? new https.Agent({
          keepAlive: true,
          maxSockets: DEFAULT_MAX_SOCKETS,
          rejectUnauthorized: !config.skipTlsVerify,
        })
      : new http.Agent({ keepAlive: true, maxSockets: DEFAULT_MAX_SOCKETS });
  }

  getConfig(): ResponsesApiClientConfig {
    return this.config;
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.config.baseUrl}${endpoint}`);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(options.headers || {}),
    };

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    return new Promise<T>((resolve, reject) => {
      const isHttps = url.protocol === 'https:';
      const reqOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: options.method || 'GET',
        headers,
        agent: this.agent,
      };

      const transport = isHttps ? https : http;
      const req = transport.request(reqOptions, res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data) as T);
            } catch {
              reject(new Error(`Failed to parse response: ${data.substring(0, 200)}`));
            }
          } else {
            reject(new ResponsesApiError(res.statusCode!, res.statusMessage || '', data));
          }
        });
      });

      req.setTimeout(API_REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Request timed out after ${API_REQUEST_TIMEOUT_MS / 1000}s`));
      });

      req.on('error', e => {
        reject(new Error(`Connection error: ${e.message}`));
      });

      if (options.body) {
        const bodyStr =
          typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        req.write(bodyStr);
      }
      req.end();
    });
  }

  async requestWithRetry<T>(
    endpoint: string,
    options: RequestOptions = {},
    maxRetries = MAX_API_RETRIES,
  ): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request<T>(endpoint, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!this.isRetryable(error) || attempt === maxRetries) throw lastError;
        const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
        this.logger?.info(`Retrying ${endpoint} after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw lastError!;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof ResponsesApiError) {
      return [429, 502, 503, 504].includes(error.statusCode);
    }
    if (error instanceof Error) {
      return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket hang up/i.test(error.message);
    }
    return false;
  }

  async streamRequest(
    endpoint: string,
    body: unknown,
    onData: (data: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const url = new URL(`${this.config.baseUrl}${endpoint}`);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };

    if (this.config.token) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }

    const bodyStr = JSON.stringify(body);

    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Stream aborted before request started'));
        return;
      }

      const isHttps = url.protocol === 'https:';
      const reqOptions: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(bodyStr)) },
        agent: this.agent,
      };

      const transport = isHttps ? https : http;
      const req = transport.request(reqOptions, res => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errorData = '';
          res.on('data', chunk => {
            errorData += chunk;
          });
          res.on('end', () => {
            reject(new ResponsesApiError(res.statusCode!, 'Streaming request failed', errorData));
          });
          return;
        }

        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const result = splitSseBuffer(buffer);
          buffer = result.remaining;
          for (const data of result.events) {
            onData(data);
          }
        });

        res.on('end', () => {
          if (buffer) {
            const result = splitSseBuffer(buffer + '\n');
            for (const data of result.events) {
              onData(data);
            }
          }
          resolve();
        });

        res.on('error', e => {
          reject(new Error(`Streaming response error: ${e.message}`));
        });
      });

      if (signal) {
        const onAbort = () => {
          req.destroy();
          reject(new Error('Stream aborted by client'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        req.on('close', () => signal.removeEventListener('abort', onAbort));
      }

      req.setTimeout(STREAM_REQUEST_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`Streaming request timed out after ${STREAM_REQUEST_TIMEOUT_MS / 1000}s`));
      });

      req.on('error', e => {
        reject(new Error(`Streaming connection error: ${e.message}`));
      });

      req.write(bodyStr);
      req.end();
    });
  }

  async testConnection(): Promise<{ connected: boolean; error?: string }> {
    try {
      await this.request<{ data: unknown[] }>('/v1/models', { method: 'GET' });
      return { connected: true };
    } catch (error) {
      return { connected: false, error: toErrorMessage(error) };
    }
  }
}
