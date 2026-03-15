import { describe, it, expect } from 'vitest';
import * as adk from './index';

describe('public API', () => {
  it('exports run and runStream functions', () => {
    expect(typeof adk.run).toBe('function');
    expect(typeof adk.runStream).toBe('function');
  });

  it('exports resolveAgentGraph', () => {
    expect(typeof adk.resolveAgentGraph).toBe('function');
  });

  it('exports sanitizeName', () => {
    expect(typeof adk.sanitizeName).toBe('function');
    expect(adk.sanitizeName('My Agent')).toBe('my_agent');
  });

  it('exports normalizeLlamaStackEvent', () => {
    expect(typeof adk.normalizeLlamaStackEvent).toBe('function');
  });

  it('exports StreamAccumulator class', () => {
    expect(typeof adk.StreamAccumulator).toBe('function');
    const acc = new adk.StreamAccumulator();
    const response = acc.getResponse();
    expect(response).toHaveProperty('id');
    expect(response).toHaveProperty('output');
  });

  it('exports ApprovalStore class', () => {
    expect(typeof adk.ApprovalStore).toBe('function');
  });

  it('exports ToolResolver class', () => {
    expect(typeof adk.ToolResolver).toBe('function');
  });

  it('exports LlamaStackModel class', () => {
    expect(typeof adk.LlamaStackModel).toBe('function');
  });
});
