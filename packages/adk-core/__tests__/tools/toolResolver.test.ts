import { describe, it, expect, vi } from 'vitest';
import { ToolResolver, type ResolvedToolInfo } from '../../src/tools/toolResolver';
import { noopLogger } from '../../src/logger';

function makeTool(overrides?: Partial<ResolvedToolInfo>): ResolvedToolInfo {
  return {
    serverId: 'srv',
    serverUrl: 'http://srv',
    originalName: 'tool_a',
    prefixedName: 'srv__tool_a',
    description: 'Tool A',
    inputSchema: { type: 'object' },
    ...overrides,
  };
}

describe('ToolResolver', () => {
  describe('register / size / getAll / clear', () => {
    it('registers and retrieves tools', () => {
      const resolver = new ToolResolver(noopLogger);
      const t = makeTool();
      resolver.register(t);
      expect(resolver.size).toBe(1);
      expect(resolver.getAll()).toEqual([t]);
    });

    it('clear removes all tools', () => {
      const resolver = new ToolResolver(noopLogger);
      resolver.register(makeTool());
      resolver.clear();
      expect(resolver.size).toBe(0);
      expect(resolver.getAll()).toEqual([]);
    });
  });

  describe('resolve - exact match', () => {
    it('resolves by exact prefixed name', () => {
      const resolver = new ToolResolver(noopLogger);
      const t = makeTool();
      resolver.register(t);
      expect(resolver.resolve('srv__tool_a')).toBe(t);
    });
  });

  describe('resolve - extension stripping', () => {
    it('resolves tool.json to tool', () => {
      const logger = { ...noopLogger, warn: vi.fn() };
      const resolver = new ToolResolver(logger);
      const t = makeTool();
      resolver.register(t);
      expect(resolver.resolve('srv__tool_a.json')).toBe(t);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('stripping extension'),
      );
    });
  });

  describe('resolve - suffix match', () => {
    it('resolves unprefixed name via suffix', () => {
      const logger = { ...noopLogger, warn: vi.fn() };
      const resolver = new ToolResolver(logger);
      const t = makeTool();
      resolver.register(t);
      expect(resolver.resolve('tool_a')).toBe(t);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('suffix match'),
      );
    });
  });

  describe('resolve - collapsed separator', () => {
    it('resolves single underscore where double expected', () => {
      const logger = { ...noopLogger, warn: vi.fn() };
      const resolver = new ToolResolver(logger);
      const t = makeTool();
      resolver.register(t);
      expect(resolver.resolve('srv_tool_a')).toBe(t);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('collapsed-separator'),
      );
    });
  });

  describe('resolve - case-insensitive', () => {
    it('resolves case-insensitively', () => {
      const logger = { ...noopLogger, warn: vi.fn() };
      const resolver = new ToolResolver(logger);
      const t = makeTool({ prefixedName: 'SRV__Tool_A' });
      resolver.register(t);
      expect(resolver.resolve('srv__tool_a')).toBe(t);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('case-insensitive'),
      );
    });
  });

  describe('resolve - no match', () => {
    it('returns undefined for unknown name', () => {
      const resolver = new ToolResolver(noopLogger);
      expect(resolver.resolve('missing')).toBeUndefined();
    });
  });

  describe('isKnown', () => {
    it('returns true for known tools', () => {
      const resolver = new ToolResolver(noopLogger);
      resolver.register(makeTool());
      expect(resolver.isKnown('srv__tool_a')).toBe(true);
    });

    it('returns false for unknown tools', () => {
      const resolver = new ToolResolver(noopLogger);
      expect(resolver.isKnown('nope')).toBe(false);
    });
  });

  describe('getServerInfo', () => {
    it('returns serverId and originalName', () => {
      const resolver = new ToolResolver(noopLogger);
      resolver.register(makeTool());
      expect(resolver.getServerInfo('srv__tool_a')).toEqual({
        serverId: 'srv',
        originalName: 'tool_a',
      });
    });

    it('returns undefined for unknown', () => {
      const resolver = new ToolResolver(noopLogger);
      expect(resolver.getServerInfo('nope')).toBeUndefined();
    });
  });
});
