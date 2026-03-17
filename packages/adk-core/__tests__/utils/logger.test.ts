import { describe, it, expect, vi } from 'vitest';
import { consoleLogger, noopLogger } from '../../src/logger';

describe('consoleLogger', () => {
  it('info delegates to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger.info('hello');
    expect(spy).toHaveBeenCalledWith('[INFO] hello', '');
    spy.mockRestore();
  });

  it('info passes meta when provided', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleLogger.info('hello', { key: 'val' });
    expect(spy).toHaveBeenCalledWith('[INFO] hello', { key: 'val' });
    spy.mockRestore();
  });

  it('warn delegates to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogger.warn('caution');
    expect(spy).toHaveBeenCalledWith('[WARN] caution', '');
    spy.mockRestore();
  });

  it('error delegates to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogger.error('bad');
    expect(spy).toHaveBeenCalledWith('[ERROR] bad', '');
    spy.mockRestore();
  });

  it('debug delegates to console.debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleLogger.debug('trace');
    expect(spy).toHaveBeenCalledWith('[DEBUG] trace', '');
    spy.mockRestore();
  });
});

describe('noopLogger', () => {
  it('has all required methods that do nothing', () => {
    expect(() => noopLogger.info('a')).not.toThrow();
    expect(() => noopLogger.warn('a')).not.toThrow();
    expect(() => noopLogger.error('a')).not.toThrow();
    expect(() => noopLogger.debug('a')).not.toThrow();
  });
});
