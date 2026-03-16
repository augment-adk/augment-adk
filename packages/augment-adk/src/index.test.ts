import { describe, it, expect } from 'vitest';
import * as adk from './index';

/**
 * v0.1.0 baseline: every runtime-accessible symbol that existed at v0.1.0.
 * If any of these are removed or renamed, CI will fail immediately.
 */
const V010_RUNTIME_EXPORTS = [
  // Entry point
  'run', 'runStream',
  // Agent
  'Agent', 'resolveAgentGraph',
  // Handoff
  'buildHandoffTool', 'buildAgentAsToolTool', 'applyHandoffInputFilter',
  'nestHandoffHistory', 'parseHandoffReason',
  // Hooks
  'dispatchToHooks',
  // Model
  'LlamaStackModel', 'ResponsesApiClient', 'ResponsesApiError',
  'defaultCapabilities', 'mergeCapabilities',
  // Tools
  'tool', 'toApiTool', 'sanitizeName', 'prefixName', 'unprefixName', 'slimSchema',
  'ToolResolver', 'MCPToolManager', 'executeToolCalls',
  // Runner
  'RunContext', 'StreamedRunResult',
  'createInitialState', 'createInterruptedState',
  'DefaultOutputClassifier',
  'processResponse', 'extractTextFromResponse',
  'runLoop', 'runLoopStream',
  // Stream
  'normalizeLlamaStackEvent', 'sanitizeMcpError', 'StreamAccumulator',
  'LS_EVENT', 'IMMEDIATE_FORWARD_TYPES',
  // Tracing
  'TraceProvider', 'DefaultSpan', 'NoopSpan', 'DefaultTrace', 'NoopTrace',
  'BatchTraceProcessor', 'ConsoleSpanExporter',
  // Session
  'InMemorySession', 'ServerManagedSession',
  // Approval
  'ApprovalStore', 'partitionByApproval',
  // Guardrails
  'checkInputGuardrail', 'evaluateInputGuardrail',
  'checkOutputGuardrail', 'evaluateOutputGuardrail',
  // Errors
  'AdkError', 'MaxTurnsError', 'AgentNotFoundError', 'GraphValidationError',
  'GuardrailError', 'ToolNotFoundError', 'CycleDetectedError', 'toErrorMessage',
  // Logger
  'consoleLogger', 'noopLogger',
] as const;

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

  it('exports all v0.1.0 baseline runtime symbols (backward compatibility guard)', () => {
    for (const name of V010_RUNTIME_EXPORTS) {
      expect(adk, `Missing export: ${name}`).toHaveProperty(name);
    }
  });
});
