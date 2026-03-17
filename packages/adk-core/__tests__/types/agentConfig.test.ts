import { describe, it, expect } from 'vitest';
import { cloneAgentConfig, type AgentConfig } from '../../src/types/agentConfig';

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    name: 'test-agent',
    instructions: 'You are a test agent.',
    handoffs: ['other'],
    functions: [{ name: 'fn', description: 'desc', parameters: { type: 'object' } }],
    ...overrides,
  };
}

describe('cloneAgentConfig', () => {
  it('deep-clones the config', () => {
    const original = makeConfig();
    const cloned = cloneAgentConfig(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.handoffs).not.toBe(original.handoffs);
    expect(cloned.functions).not.toBe(original.functions);
  });

  it('applies overrides', () => {
    const original = makeConfig();
    const cloned = cloneAgentConfig(original, { name: 'new-name', model: 'gpt-4' });
    expect(cloned.name).toBe('new-name');
    expect(cloned.model).toBe('gpt-4');
    expect(cloned.instructions).toBe(original.instructions);
  });

  it('mutation of clone does not affect original', () => {
    const original = makeConfig();
    const cloned = cloneAgentConfig(original);
    cloned.handoffs!.push('added');
    expect(original.handoffs).toEqual(['other']);
  });

  it('works with empty overrides', () => {
    const original = makeConfig();
    const cloned = cloneAgentConfig(original);
    expect(cloned).toEqual(original);
  });
});
