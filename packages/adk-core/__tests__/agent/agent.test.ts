import { describe, it, expect } from 'vitest';
import { Agent } from '../../src/agent/agent';

describe('Agent', () => {
  describe('resolveInstructions', () => {
    it('returns config instructions when no dynamic instructions set', async () => {
      const agent = new Agent({ name: 'Test', instructions: 'Be helpful.' });
      const result = await agent.resolveInstructions();
      expect(result).toBe('Be helpful.');
    });

    it('returns static dynamic instructions string', async () => {
      const agent = new Agent(
        { name: 'Test', instructions: 'fallback' },
        { dynamicInstructions: 'Dynamic instruction string' },
      );
      const result = await agent.resolveInstructions();
      expect(result).toBe('Dynamic instruction string');
    });

    it('calls dynamic instructions function with agent key', async () => {
      const fn = (key: string) => `Instructions for ${key}`;
      const agent = new Agent(
        { name: 'Router', instructions: 'fallback' },
        { dynamicInstructions: fn },
      );
      const result = await agent.resolveInstructions('router');
      expect(result).toBe('Instructions for router');
    });

    it('uses agent name as default key', async () => {
      const fn = (key: string) => `Agent: ${key}`;
      const agent = new Agent(
        { name: 'MyAgent', instructions: 'fallback' },
        { dynamicInstructions: fn },
      );
      const result = await agent.resolveInstructions();
      expect(result).toBe('Agent: MyAgent');
    });

    it('supports async dynamic instructions', async () => {
      const fn = async (key: string) => {
        return `Async instructions for ${key}`;
      };
      const agent = new Agent(
        { name: 'Test', instructions: 'fallback' },
        { dynamicInstructions: fn },
      );
      const result = await agent.resolveInstructions('test');
      expect(result).toBe('Async instructions for test');
    });
  });

  describe('toJSON', () => {
    it('serializes agent to plain object', () => {
      const agent = new Agent({
        name: 'Router',
        instructions: 'Route queries',
        handoffs: ['engineer', 'analyst'],
      });

      const json = agent.toJSON();
      expect(json.name).toBe('Router');
      expect(json.config).toEqual({
        name: 'Router',
        instructions: 'Route queries',
        handoffs: ['engineer', 'analyst'],
      });
      expect(json.functionTools).toEqual([]);
      expect(json.mcpServers).toEqual([]);
    });

    it('includes function tool metadata without execute handler', () => {
      const agent = new Agent(
        { name: 'Test', instructions: 'Test' },
        {
          functionTools: [{
            type: 'function',
            name: 'greet',
            description: 'Say hello',
            parameters: { type: 'object', properties: {} },
            execute: async () => 'hello',
          }],
        },
      );

      const json = agent.toJSON();
      const tools = json.functionTools as any[];
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('greet');
      expect(tools[0].description).toBe('Say hello');
      expect(tools[0]).not.toHaveProperty('execute');
    });
  });

  describe('clone', () => {
    it('preserves dynamic instructions through clone', async () => {
      const fn = (key: string) => `Dynamic: ${key}`;
      const agent = new Agent(
        { name: 'Original', instructions: 'base' },
        { dynamicInstructions: fn },
      );

      const cloned = agent.clone({ name: 'Cloned' });
      expect(cloned.name).toBe('Cloned');

      const result = await cloned.resolveInstructions('test');
      expect(result).toBe('Dynamic: test');
    });
  });
});
