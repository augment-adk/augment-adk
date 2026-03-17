import { describe, it, expect } from 'vitest';
import {
  AdkError,
  MaxTurnsError,
  AgentNotFoundError,
  GraphValidationError,
  GuardrailError,
  ToolNotFoundError,
  CycleDetectedError,
  toErrorMessage,
} from '../../src/errors';

describe('AdkError', () => {
  it('sets name and message', () => {
    const err = new AdkError('boom');
    expect(err.name).toBe('AdkError');
    expect(err.message).toBe('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AdkError);
  });
});

describe('MaxTurnsError', () => {
  it('captures maxTurns and agentPath', () => {
    const err = new MaxTurnsError(10, ['a', 'b', 'c']);
    expect(err.name).toBe('MaxTurnsError');
    expect(err.maxTurns).toBe(10);
    expect(err.agentPath).toEqual(['a', 'b', 'c']);
    expect(err.message).toContain('10');
    expect(err.message).toContain('a -> b -> c');
    expect(err).toBeInstanceOf(AdkError);
    expect(err).toBeInstanceOf(MaxTurnsError);
  });
});

describe('AgentNotFoundError', () => {
  it('captures agentKey and availableKeys', () => {
    const err = new AgentNotFoundError('missing', ['a', 'b']);
    expect(err.name).toBe('AgentNotFoundError');
    expect(err.agentKey).toBe('missing');
    expect(err.availableKeys).toEqual(['a', 'b']);
    expect(err.message).toContain('missing');
    expect(err.message).toContain('a, b');
    expect(err).toBeInstanceOf(AdkError);
    expect(err).toBeInstanceOf(AgentNotFoundError);
  });
});

describe('GraphValidationError', () => {
  it('sets name and message', () => {
    const err = new GraphValidationError('bad graph');
    expect(err.name).toBe('GraphValidationError');
    expect(err.message).toBe('bad graph');
    expect(err).toBeInstanceOf(AdkError);
    expect(err).toBeInstanceOf(GraphValidationError);
  });
});

describe('GuardrailError', () => {
  it('captures guardrailName', () => {
    const err = new GuardrailError('pii-check', 'PII detected');
    expect(err.name).toBe('GuardrailError');
    expect(err.guardrailName).toBe('pii-check');
    expect(err.message).toContain('pii-check');
    expect(err.message).toContain('PII detected');
    expect(err).toBeInstanceOf(AdkError);
    expect(err).toBeInstanceOf(GuardrailError);
  });
});

describe('ToolNotFoundError', () => {
  it('captures toolName', () => {
    const err = new ToolNotFoundError('unknown_tool');
    expect(err.name).toBe('ToolNotFoundError');
    expect(err.toolName).toBe('unknown_tool');
    expect(err.message).toContain('unknown_tool');
    expect(err).toBeInstanceOf(AdkError);
    expect(err).toBeInstanceOf(ToolNotFoundError);
  });
});

describe('CycleDetectedError', () => {
  it('captures agentKey and visitCount', () => {
    const err = new CycleDetectedError('looper', 5);
    expect(err.name).toBe('CycleDetectedError');
    expect(err.agentKey).toBe('looper');
    expect(err.visitCount).toBe(5);
    expect(err.message).toContain('looper');
    expect(err.message).toContain('5');
    expect(err).toBeInstanceOf(AdkError);
    expect(err).toBeInstanceOf(CycleDetectedError);
  });
});

describe('toErrorMessage', () => {
  it('extracts message from Error', () => {
    expect(toErrorMessage(new Error('fail'))).toBe('fail');
  });

  it('returns string as-is', () => {
    expect(toErrorMessage('raw')).toBe('raw');
  });

  it('stringifies other values', () => {
    expect(toErrorMessage(42)).toBe('42');
    expect(toErrorMessage(null)).toBe('null');
    expect(toErrorMessage(undefined)).toBe('undefined');
  });
});
