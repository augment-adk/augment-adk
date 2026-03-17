/**
 * Composable retry policies for model calls.
 *
 * Policies are predicates that decide whether a failed call should be retried.
 * They compose with `any` (OR) and `all` (AND) combinators, and wrap with
 * `maxAttempts` to cap total retries.
 */

export interface RetryPolicyContext {
  error: Error;
  attempt: number;
  agentKey: string;
  turn: number;
}

export type RetryPolicy = (ctx: RetryPolicyContext) => boolean;

/**
 * Never retry. Always returns false.
 */
export const never: RetryPolicy = () => false;

/**
 * Retry on network-level errors (connection reset, timeout, DNS failures).
 */
export const onNetworkError: RetryPolicy = (ctx) => {
  const msg = ctx.error.message.toLowerCase();
  return (
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('socket hang up') ||
    msg.includes('aborted')
  );
};

/**
 * Retry on specific HTTP status codes (e.g., 429, 500, 502, 503, 504).
 */
export function onHttpStatus(...codes: number[]): RetryPolicy {
  const codeSet = new Set(codes);
  return (ctx) => {
    const statusProp = (ctx.error as Error & { status?: number }).status
      ?? (ctx.error as Error & { statusCode?: number }).statusCode;
    if (statusProp !== undefined && codeSet.has(statusProp)) {
      return true;
    }
    const matches = ctx.error.message.matchAll(/\b(\d{3})\b/g);
    for (const m of matches) {
      if (codeSet.has(parseInt(m[1], 10))) return true;
    }
    return false;
  };
}

/**
 * Retry on rate-limit errors (HTTP 429).
 */
export const onRateLimit: RetryPolicy = onHttpStatus(429);

/**
 * Retry on server errors (HTTP 500, 502, 503, 504).
 */
export const onServerError: RetryPolicy = onHttpStatus(500, 502, 503, 504);

/**
 * Cap total attempts (including the initial call).
 * Wraps another policy so it stops retrying after `max` attempts.
 */
export function maxAttempts(max: number, policy: RetryPolicy): RetryPolicy {
  return (ctx) => ctx.attempt < max && policy(ctx);
}

/**
 * Combine policies with OR logic — retry if ANY policy says yes.
 */
export function any(...policies: RetryPolicy[]): RetryPolicy {
  return (ctx) => policies.some(p => p(ctx));
}

/**
 * Combine policies with AND logic — retry only if ALL policies agree.
 * Returns `never` when called with no policies.
 */
export function all(...policies: RetryPolicy[]): RetryPolicy {
  if (policies.length === 0) return never;
  return (ctx) => policies.every(p => p(ctx));
}

/**
 * Default retry policy: retry on network errors or server errors, up to 3 attempts.
 */
export const defaultRetryPolicy: RetryPolicy = maxAttempts(
  3,
  any(onNetworkError, onServerError),
);

/**
 * Calculate exponential backoff delay in milliseconds.
 * @param attempt - 1-based attempt number. Values < 1 are clamped to 1.
 */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30000): number {
  const safeAttempt = Math.max(1, attempt);
  const delay = Math.min(baseMs * Math.pow(2, safeAttempt - 1), maxMs);
  const jitter = delay * 0.1 * Math.random();
  return delay + jitter;
}

/**
 * Execute a function with retry logic governed by a RetryPolicy.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  context: Omit<RetryPolicyContext, 'error' | 'attempt'>,
  options?: { baseDelayMs?: number; maxDelayMs?: number; signal?: AbortSignal },
): Promise<T> {
  let attempt = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (options?.signal?.aborted) {
      throw new Error('Retry aborted');
    }

    try {
      return await fn();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const retryCtx: RetryPolicyContext = { error, attempt, ...context };

      if (!policy(retryCtx)) {
        throw error;
      }

      if (options?.signal?.aborted) {
        throw new Error('Retry aborted');
      }

      const delay = backoffDelay(attempt, options?.baseDelayMs, options?.maxDelayMs);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
  }
}
