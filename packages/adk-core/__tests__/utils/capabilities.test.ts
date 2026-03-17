import { describe, it, expect } from 'vitest';
import { defaultCapabilities, mergeCapabilities } from '../../src/capabilities';

describe('defaultCapabilities', () => {
  it('returns expected default shape', () => {
    const caps = defaultCapabilities();
    expect(caps).toEqual({
      functionTools: true,
      strictField: true,
      maxOutputTokens: true,
      mcpTools: true,
      parallelToolCalls: true,
      truncation: false,
    });
  });

  it('returns a fresh object each call', () => {
    const a = defaultCapabilities();
    const b = defaultCapabilities();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('mergeCapabilities', () => {
  it('overrides specific fields', () => {
    const merged = mergeCapabilities({ strictField: false, truncation: true });
    expect(merged.strictField).toBe(false);
    expect(merged.truncation).toBe(true);
    expect(merged.functionTools).toBe(true);
  });

  it('returns defaults when empty overrides', () => {
    expect(mergeCapabilities({})).toEqual(defaultCapabilities());
  });
});
