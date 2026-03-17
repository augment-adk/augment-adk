import { describe, it, expect } from 'vitest';
import {
  sanitizeName,
  prefixName,
  unprefixName,
  slimSchema,
  normalizeFunctionName,
} from '../../src/tools/toolNameUtils';

describe('sanitizeName', () => {
  it('lowercases and replaces non-alphanumeric', () => {
    expect(sanitizeName('My-Tool.v2')).toBe('my_tool_v2');
  });

  it('collapses consecutive underscores', () => {
    expect(sanitizeName('a___b')).toBe('a_b');
  });

  it('trims leading and trailing underscores', () => {
    expect(sanitizeName('__hello__')).toBe('hello');
  });

  it('handles spaces and special chars', () => {
    expect(sanitizeName('Hello World! @#$')).toBe('hello_world');
  });

  it('preserves plain lowercase names', () => {
    expect(sanitizeName('simple')).toBe('simple');
  });
});

describe('prefixName', () => {
  it('joins serverId and toolName with __', () => {
    expect(prefixName('ocp', 'pods_list')).toBe('ocp__pods_list');
  });
});

describe('unprefixName', () => {
  it('splits prefixed name', () => {
    expect(unprefixName('ocp__pods_list')).toEqual({ serverId: 'ocp', toolName: 'pods_list' });
  });

  it('returns null when no separator', () => {
    expect(unprefixName('simple')).toBeNull();
  });

  it('splits on first occurrence of __', () => {
    const result = unprefixName('a__b__c');
    expect(result).toEqual({ serverId: 'a', toolName: 'b__c' });
  });
});

describe('slimSchema', () => {
  it('strips description, examples, title, default, $schema, additionalProperties', () => {
    const schema = {
      type: 'object',
      description: 'top level',
      title: 'MySchema',
      $schema: 'http://json-schema.org/draft-07/schema#',
      properties: {
        name: {
          type: 'string',
          description: 'a name',
          examples: ['alice'],
          default: 'bob',
        },
      },
      required: ['name'],
      additionalProperties: false,
    };
    const result = slimSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
  });

  it('preserves enum and items', () => {
    const schema = {
      type: 'array',
      items: { type: 'string', enum: ['a', 'b'] },
    };
    expect(slimSchema(schema)).toEqual(schema);
  });

  it('handles deeply nested schemas', () => {
    const schema = {
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          description: 'will be removed',
          properties: {
            deep: { type: 'number', example: 42 },
          },
        },
      },
    };
    const result = slimSchema(schema);
    expect(result).toEqual({
      type: 'object',
      properties: {
        nested: {
          type: 'object',
          properties: {
            deep: { type: 'number' },
          },
        },
      },
    });
  });

  it('handles arrays at top level', () => {
    const schema = { type: 'array', items: { type: 'string', description: 'remove' } };
    expect(slimSchema(schema)).toEqual({ type: 'array', items: { type: 'string' } });
  });
});

describe('normalizeFunctionName', () => {
  it('strips .json extension', () => {
    expect(normalizeFunctionName('tool.json')).toBe('tool');
  });

  it('strips .yaml extension', () => {
    expect(normalizeFunctionName('tool.yaml')).toBe('tool');
  });

  it('strips .yml extension', () => {
    expect(normalizeFunctionName('tool.yml')).toBe('tool');
  });

  it('strips .xml extension', () => {
    expect(normalizeFunctionName('tool.xml')).toBe('tool');
  });

  it('strips .txt extension', () => {
    expect(normalizeFunctionName('tool.txt')).toBe('tool');
  });

  it('is case-insensitive', () => {
    expect(normalizeFunctionName('tool.JSON')).toBe('tool');
  });

  it('does not strip unknown extensions', () => {
    expect(normalizeFunctionName('tool.py')).toBe('tool.py');
  });

  it('leaves names without extension unchanged', () => {
    expect(normalizeFunctionName('tool_name')).toBe('tool_name');
  });
});
