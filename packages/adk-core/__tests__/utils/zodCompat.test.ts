import { describe, it, expect } from 'vitest';
import { isZodAvailable, zodSchemaToJsonSchema, validateWithZod } from '../../src/utils/zodCompat';

describe('zodCompat', () => {
  describe('isZodAvailable', () => {
    it('returns a boolean', () => {
      const result = isZodAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('zodSchemaToJsonSchema', () => {
    it('returns undefined for non-Zod objects', () => {
      const result = zodSchemaToJsonSchema({ type: 'string' });
      expect(result).toBeUndefined();
    });

    it('returns undefined for null', () => {
      const result = zodSchemaToJsonSchema(null);
      expect(result).toBeUndefined();
    });

    it('returns undefined for primitives', () => {
      expect(zodSchemaToJsonSchema(42)).toBeUndefined();
      expect(zodSchemaToJsonSchema('hello')).toBeUndefined();
      expect(zodSchemaToJsonSchema(undefined)).toBeUndefined();
    });
  });

  describe('zodSchemaToJsonSchema with _def', () => {
    it('handles Zod-like schema with _def when converter is not available', () => {
      const fakeZodSchema = {
        _def: { typeName: 'ZodString' },
      };
      const result = zodSchemaToJsonSchema(fakeZodSchema);
      if (isZodAvailable()) {
        expect(result).toBeDefined();
      } else {
        expect(result).toBeUndefined();
      }
    });
  });

  describe('validateWithZod', () => {
    it('passes through valid JSON when no Zod schema', () => {
      const result = validateWithZod('{"key": "value"}', null);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ key: 'value' });
      }
    });

    it('throws on invalid JSON when no Zod schema is present', () => {
      expect(() => validateWithZod('not-json', null)).toThrow();
    });

    it('passes through when schema lacks safeParse', () => {
      const result = validateWithZod('{"a": 1}', { type: 'object' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ a: 1 });
      }
    });

    it('validates successfully with safeParse returning success', () => {
      const mockSchema = {
        safeParse: (data: unknown) => ({ success: true, data }),
      };
      const result = validateWithZod('{"x":1}', mockSchema);
      if (isZodAvailable()) {
        expect(result.success).toBe(true);
        if (result.success) expect(result.data).toEqual({ x: 1 });
      } else {
        expect(result.success).toBe(true);
      }
    });

    it('returns error when safeParse fails', () => {
      const mockSchema = {
        safeParse: () => ({ success: false, error: { message: 'bad input' } }),
      };
      const result = validateWithZod('{"x":1}', mockSchema);
      if (isZodAvailable()) {
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('bad input');
      } else {
        expect(result.success).toBe(true);
      }
    });

    it('handles error during JSON parsing with schema', () => {
      const mockSchema = {
        safeParse: () => { throw new Error('parse crash'); },
      };
      const result = validateWithZod('{"x":1}', mockSchema);
      if (isZodAvailable()) {
        expect(result.success).toBe(false);
        if (!result.success) expect(result.error).toContain('parse crash');
      } else {
        expect(result.success).toBe(true);
      }
    });
  });
});
