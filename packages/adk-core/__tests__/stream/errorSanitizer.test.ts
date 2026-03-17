import { describe, it, expect } from 'vitest';
import { sanitizeMcpError } from '../../src/stream/errorSanitizer';

describe('sanitizeMcpError', () => {
  it('returns error as-is when no URL is present', () => {
    expect(sanitizeMcpError('Something went wrong')).toBe('Something went wrong');
  });

  it('sanitizes internal k8s URLs with connection refused', () => {
    const err = 'Failed to connect to http://my-service.ns.svc.cluster.local:8080 - connection refused';
    const result = sanitizeMcpError(err, 'my-mcp');
    expect(result).toContain('my-mcp');
    expect(result).toContain('unreachable');
    expect(result).not.toContain('http://');
  });

  it('sanitizes raw URLs with timeout', () => {
    const err = 'Request to http://example.com/api timed out ETIMEDOUT';
    const result = sanitizeMcpError(err, 'remote');
    expect(result).toContain('remote');
    expect(result).toContain('timed out');
  });

  it('sanitizes 502 errors', () => {
    const err = 'http://proxy.internal:3000 returned 502';
    const result = sanitizeMcpError(err, 'proxy');
    expect(result).toContain('502');
    expect(result).toContain('proxy');
  });

  it('sanitizes 401/unauthorized errors', () => {
    const err = 'http://api.internal/v1 returned 401 unauthorized';
    const result = sanitizeMcpError(err, 'api');
    expect(result).toContain('unauthorized');
  });

  it('sanitizes 403/forbidden errors', () => {
    const err = 'http://api.internal/v1 returned 403 forbidden';
    const result = sanitizeMcpError(err);
    expect(result).toContain('forbidden');
    expect(result).toContain('MCP server');
  });

  it('falls back to generic error for unknown URL errors', () => {
    const err = 'http://api.internal/v1 returned something unexpected';
    const result = sanitizeMcpError(err, 'svc');
    expect(result).toContain('encountered an error');
  });

  it('sanitizes ECONNREFUSED without explicit URL label', () => {
    const err = 'http://localhost:8080 ECONNREFUSED';
    const result = sanitizeMcpError(err);
    expect(result).toContain('MCP server');
    expect(result).toContain('unreachable');
  });
});
