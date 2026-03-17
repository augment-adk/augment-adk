import { describe, it, expect } from 'vitest';
import {
  defaultCapabilities,
  mergeCapabilities,
  isParamSupported,
} from '../src/serverCapabilities';

describe('isParamSupported', () => {
  it('returns true for max_output_tokens when capability is true', () => {
    const caps = { ...defaultCapabilities(), maxOutputTokens: true };
    expect(isParamSupported(caps, 'max_output_tokens')).toBe(true);
  });

  it('returns false for max_output_tokens when capability is false', () => {
    const caps = { ...defaultCapabilities(), maxOutputTokens: false };
    expect(isParamSupported(caps, 'max_output_tokens')).toBe(false);
  });

  it('returns true for function_tools when capability is true', () => {
    const caps = { ...defaultCapabilities(), functionTools: true };
    expect(isParamSupported(caps, 'function_tools')).toBe(true);
  });

  it('returns false for function_tools when capability is false', () => {
    const caps = { ...defaultCapabilities(), functionTools: false };
    expect(isParamSupported(caps, 'function_tools')).toBe(false);
  });

  it('returns true for strict when strictField is true', () => {
    const caps = { ...defaultCapabilities(), strictField: true };
    expect(isParamSupported(caps, 'strict')).toBe(true);
  });

  it('returns false for strict when strictField is false', () => {
    const caps = { ...defaultCapabilities(), strictField: false };
    expect(isParamSupported(caps, 'strict')).toBe(false);
  });

  it('returns true for truncation when capability is true', () => {
    const caps = { ...defaultCapabilities(), truncation: true };
    expect(isParamSupported(caps, 'truncation')).toBe(true);
  });

  it('returns false for truncation when capability is false', () => {
    const caps = { ...defaultCapabilities(), truncation: false };
    expect(isParamSupported(caps, 'truncation')).toBe(false);
  });

  it('returns true for unknown params', () => {
    const caps = defaultCapabilities();
    expect(isParamSupported(caps, 'unknown_param')).toBe(true);
    expect(isParamSupported(caps, 'temperature')).toBe(true);
    expect(isParamSupported(caps, 'foo')).toBe(true);
  });
});

describe('defaultCapabilities', () => {
  it('returns expected shape', () => {
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
});

describe('mergeCapabilities', () => {
  it('overrides work', () => {
    const merged = mergeCapabilities({
      truncation: true,
      maxOutputTokens: false,
    });
    expect(merged.truncation).toBe(true);
    expect(merged.maxOutputTokens).toBe(false);
    expect(merged.functionTools).toBe(true); // unchanged from default
  });

  it('returns full CapabilityInfo with partial overrides', () => {
    const merged = mergeCapabilities({ strictField: false });
    expect(merged).toEqual({
      functionTools: true,
      strictField: false,
      maxOutputTokens: true,
      mcpTools: true,
      parallelToolCalls: true,
      truncation: false,
    });
  });
});
