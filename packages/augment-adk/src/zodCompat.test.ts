import { describe, it, expect } from 'vitest';
import { isZodAvailable, zodSchemaToJsonSchema, validateWithZod } from './utils/zodCompat';

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
  });
});
