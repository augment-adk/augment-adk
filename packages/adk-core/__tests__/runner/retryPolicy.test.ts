import { describe, it, expect, vi } from 'vitest';
import {
  never,
  onNetworkError,
  onHttpStatus,
  onRateLimit,
  onServerError,
  maxAttempts,
  any,
  all,
  defaultRetryPolicy,
  withRetry,
  backoffDelay,
  type RetryPolicyContext,
} from '../../src/runner/retryPolicy';

function makeCtx(overrides: Partial<RetryPolicyContext> = {}): RetryPolicyContext {
  return {
    error: new Error('test'),
    attempt: 1,
    agentKey: 'agent1',
    turn: 0,
    ...overrides,
  };
}

describe('retryPolicy', () => {
  describe('never', () => {
    it('always returns false', () => {
      expect(never(makeCtx())).toBe(false);
      expect(never(makeCtx({ attempt: 100 }))).toBe(false);
    });
  });

  describe('onNetworkError', () => {
    it('returns true for network errors', () => {
      expect(onNetworkError(makeCtx({ error: new Error('ECONNRESET') }))).toBe(true);
      expect(onNetworkError(makeCtx({ error: new Error('ECONNREFUSED') }))).toBe(true);
      expect(onNetworkError(makeCtx({ error: new Error('ETIMEDOUT') }))).toBe(true);
      expect(onNetworkError(makeCtx({ error: new Error('ENOTFOUND') }))).toBe(true);
      expect(onNetworkError(makeCtx({ error: new Error('fetch failed') }))).toBe(true);
      expect(onNetworkError(makeCtx({ error: new Error('socket hang up') }))).toBe(true);
      expect(onNetworkError(makeCtx({ error: new Error('network error') }))).toBe(true);
      expect(onNetworkError(makeCtx({ error: new Error('request aborted') }))).toBe(true);
    });

    it('returns false for non-network errors', () => {
      expect(onNetworkError(makeCtx({ error: new Error('Invalid JSON') }))).toBe(false);
      expect(onNetworkError(makeCtx({ error: new Error('Bad request') }))).toBe(false);
    });
  });

  describe('onHttpStatus', () => {
    it('matches specific HTTP status codes', () => {
      const policy = onHttpStatus(429, 503);
      expect(policy(makeCtx({ error: new Error('HTTP 429 Too Many Requests') }))).toBe(true);
      expect(policy(makeCtx({ error: new Error('Status 503') }))).toBe(true);
      expect(policy(makeCtx({ error: new Error('HTTP 400 Bad Request') }))).toBe(false);
    });

    it('matches status code from error.status property', () => {
      const policy = onHttpStatus(503);
      const err = Object.assign(new Error('Server error'), { status: 503 });
      expect(policy(makeCtx({ error: err }))).toBe(true);
    });

    it('matches status code from error.statusCode property', () => {
      const policy = onHttpStatus(429);
      const err = Object.assign(new Error('Rate limited'), { statusCode: 429 });
      expect(policy(makeCtx({ error: err }))).toBe(true);
    });

    it('scans all 3-digit numbers in message', () => {
      const policy = onHttpStatus(503);
      expect(policy(makeCtx({ error: new Error('Error at line 123: HTTP 503 Service Unavailable') }))).toBe(true);
    });
  });

  describe('onRateLimit', () => {
    it('matches 429 status code', () => {
      expect(onRateLimit(makeCtx({ error: new Error('429 Too Many Requests') }))).toBe(true);
      expect(onRateLimit(makeCtx({ error: new Error('500 error') }))).toBe(false);
    });
  });

  describe('onServerError', () => {
    it('matches 500, 502, 503, 504', () => {
      expect(onServerError(makeCtx({ error: new Error('HTTP 500') }))).toBe(true);
      expect(onServerError(makeCtx({ error: new Error('HTTP 502') }))).toBe(true);
      expect(onServerError(makeCtx({ error: new Error('HTTP 503') }))).toBe(true);
      expect(onServerError(makeCtx({ error: new Error('HTTP 504') }))).toBe(true);
      expect(onServerError(makeCtx({ error: new Error('HTTP 400') }))).toBe(false);
    });
  });

  describe('maxAttempts', () => {
    it('caps retry attempts', () => {
      const policy = maxAttempts(3, () => true);
      expect(policy(makeCtx({ attempt: 1 }))).toBe(true);
      expect(policy(makeCtx({ attempt: 2 }))).toBe(true);
      expect(policy(makeCtx({ attempt: 3 }))).toBe(false);
      expect(policy(makeCtx({ attempt: 4 }))).toBe(false);
    });

    it('maxAttempts(1) allows no retries', () => {
      const policy = maxAttempts(1, () => true);
      expect(policy(makeCtx({ attempt: 1 }))).toBe(false);
    });

    it('maxAttempts(0) allows no retries', () => {
      const policy = maxAttempts(0, () => true);
      expect(policy(makeCtx({ attempt: 1 }))).toBe(false);
    });
  });

  describe('any', () => {
    it('returns true if any policy matches', () => {
      const policy = any(() => false, () => true);
      expect(policy(makeCtx())).toBe(true);
    });

    it('returns false if no policy matches', () => {
      const policy = any(() => false, () => false);
      expect(policy(makeCtx())).toBe(false);
    });

    it('returns false for empty policy list', () => {
      const policy = any();
      expect(policy(makeCtx())).toBe(false);
    });
  });

  describe('all', () => {
    it('returns true only if all policies match', () => {
      const policy = all(() => true, () => true);
      expect(policy(makeCtx())).toBe(true);
    });

    it('returns false if any policy does not match', () => {
      const policy = all(() => true, () => false);
      expect(policy(makeCtx())).toBe(false);
    });

    it('returns false for empty policy list (equivalent to never)', () => {
      const policy = all();
      expect(policy(makeCtx())).toBe(false);
    });
  });

  describe('defaultRetryPolicy', () => {
    it('retries on network errors up to 3 attempts', () => {
      expect(defaultRetryPolicy(makeCtx({ error: new Error('ECONNRESET'), attempt: 1 }))).toBe(true);
      expect(defaultRetryPolicy(makeCtx({ error: new Error('ECONNRESET'), attempt: 2 }))).toBe(true);
      expect(defaultRetryPolicy(makeCtx({ error: new Error('ECONNRESET'), attempt: 3 }))).toBe(false);
    });

    it('retries on 5xx server errors', () => {
      expect(defaultRetryPolicy(makeCtx({ error: new Error('HTTP 500'), attempt: 1 }))).toBe(true);
      expect(defaultRetryPolicy(makeCtx({ error: new Error('HTTP 502'), attempt: 1 }))).toBe(true);
      expect(defaultRetryPolicy(makeCtx({ error: new Error('HTTP 503'), attempt: 1 }))).toBe(true);
      expect(defaultRetryPolicy(makeCtx({ error: new Error('HTTP 504'), attempt: 1 }))).toBe(true);
    });

    it('does not retry on non-retryable errors', () => {
      expect(defaultRetryPolicy(makeCtx({ error: new Error('Bad request'), attempt: 1 }))).toBe(false);
    });
  });

  describe('backoffDelay', () => {
    it('increases with attempt number', () => {
      const d1 = backoffDelay(1, 1000, 30000);
      const d2 = backoffDelay(2, 1000, 30000);
      const d3 = backoffDelay(3, 1000, 30000);
      expect(d1).toBeLessThan(d2);
      expect(d2).toBeLessThan(d3);
    });

    it('caps at maxMs', () => {
      const d = backoffDelay(100, 1000, 5000);
      expect(d).toBeLessThanOrEqual(5500); // maxMs + jitter
    });

    it('clamps attempt < 1 to 1', () => {
      const d0 = backoffDelay(0, 1000, 30000);
      const d1 = backoffDelay(1, 1000, 30000);
      // Both should be baseMs (1000) plus jitter
      expect(d0).toBeGreaterThanOrEqual(1000);
      expect(d0).toBeLessThanOrEqual(1100);
      expect(d1).toBeGreaterThanOrEqual(1000);
      expect(d1).toBeLessThanOrEqual(1100);
    });
  });

  describe('withRetry', () => {
    it('returns result on success', async () => {
      const fn = vi.fn().mockResolvedValue('ok');
      const result = await withRetry(fn, never, { agentKey: 'a', turn: 0 });
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries and succeeds on second attempt', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce('ok');

      const result = await withRetry(
        fn,
        maxAttempts(3, onNetworkError),
        { agentKey: 'a', turn: 0 },
        { baseDelayMs: 1, maxDelayMs: 1 },
      );
      expect(result).toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));

      await expect(
        withRetry(
          fn,
          maxAttempts(2, onNetworkError),
          { agentKey: 'a', turn: 0 },
          { baseDelayMs: 1, maxDelayMs: 1 },
        ),
      ).rejects.toThrow('ECONNRESET');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Bad request'));

      await expect(
        withRetry(fn, onNetworkError, { agentKey: 'a', turn: 0 }),
      ).rejects.toThrow('Bad request');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('wraps non-Error thrown values', async () => {
      const fn = vi.fn().mockRejectedValue('string error');

      await expect(
        withRetry(fn, never, { agentKey: 'a', turn: 0 }),
      ).rejects.toThrow('string error');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('aborts when signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const fn = vi.fn().mockResolvedValue('ok');
      await expect(
        withRetry(fn, () => true, { agentKey: 'a', turn: 0 }, { signal: controller.signal }),
      ).rejects.toThrow('Retry aborted');
      expect(fn).not.toHaveBeenCalled();
    });

    it('aborts between retries when signal is aborted', async () => {
      const controller = new AbortController();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockImplementation(() => {
          controller.abort();
          return Promise.reject(new Error('ECONNRESET'));
        });

      await expect(
        withRetry(
          fn,
          maxAttempts(5, onNetworkError),
          { agentKey: 'a', turn: 0 },
          { baseDelayMs: 1, maxDelayMs: 1, signal: controller.signal },
        ),
      ).rejects.toThrow('Retry aborted');
    });
  });
});
