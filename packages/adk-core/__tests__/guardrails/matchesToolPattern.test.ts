import { describe, it, expect } from 'vitest';
import { matchesToolPattern } from '../../src/guardrails/matchesToolPattern';

describe('matchesToolPattern', () => {
  it('matches wildcard *', () => {
    expect(matchesToolPattern('anything', '*')).toBe(true);
  });

  it('matches exact name', () => {
    expect(matchesToolPattern('delete_file', 'delete_file')).toBe(true);
    expect(matchesToolPattern('delete_file', 'read_file')).toBe(false);
  });

  it('matches prefix wildcard', () => {
    expect(matchesToolPattern('delete_file', 'delete_*')).toBe(true);
    expect(matchesToolPattern('read_file', 'delete_*')).toBe(false);
  });

  it('matches suffix wildcard', () => {
    expect(matchesToolPattern('admin_delete', '*_delete')).toBe(true);
    expect(matchesToolPattern('admin_read', '*_delete')).toBe(false);
  });

  it('matches ? single character', () => {
    expect(matchesToolPattern('tool_a', 'tool_?')).toBe(true);
    expect(matchesToolPattern('tool_ab', 'tool_?')).toBe(false);
  });

  it('escapes regex special characters in patterns', () => {
    expect(matchesToolPattern('my.tool', 'my.tool')).toBe(true);
    expect(matchesToolPattern('myXtool', 'my.tool')).toBe(false);
  });

  it('escapes brackets and parens', () => {
    expect(matchesToolPattern('tool[1]', 'tool[1]')).toBe(true);
    expect(matchesToolPattern('tool1', 'tool[1]')).toBe(false);
  });

  it('handles complex pattern with mixed wildcards and special chars', () => {
    expect(matchesToolPattern('ns.tool_v2', 'ns.tool_*')).toBe(true);
    expect(matchesToolPattern('xx.tool_v2', 'ns.tool_*')).toBe(false);
  });
});
