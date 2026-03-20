import { describe, it, expect } from 'vitest';
import * as adk from '../src/index';

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

/**
 * v0.2.0 additions: new runtime symbols added since v0.1.0.
 * Guards against accidental removal during restructures.
 *
 * Note: ChatCompletionsModel/Client/Error moved to optional package
 * @augment-adk/adk-chat-completions and are no longer re-exported here.
 */
const V020_RUNTIME_EXPORTS = [
  // Hosted tool factories
  'webSearchTool', 'fileSearchTool', 'hostedMcpTool',
  // Zod compatibility
  'isZodAvailable', 'zodSchemaToJsonSchema', 'validateWithZod',
  // RunState serialization and continuation
  'serializeRunState', 'deserializeRunState', 'createContinuationState',
  // LlamaStack utilities
  'isParamSupported', 'buildTurnRequest', 'parseStreamEvent', 'splitSseBuffer',
  // Handoff helpers
  'wrapHandoffOutput', 'handoffFilters', 'promptWithHandoffInstructions',
  // Tool search providers
  'StaticToolSearchProvider', 'RemoteToolSearchProvider',
  // Session additions
  'CompactionSession', 'ServerConversationTracker',
  // Stream additions
  'RESPONSES_EVENT', 'normalizeResponsesApiEvent',
  // Retry policy combinators
  'retryNever', 'onNetworkError', 'onHttpStatus', 'onRateLimit', 'onServerError',
  'retryMaxAttempts', 'retryAny', 'retryAll',
  'defaultRetryPolicy', 'withRetry', 'backoffDelay',
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

  it('exports all v0.2.0 runtime symbols', () => {
    for (const name of V020_RUNTIME_EXPORTS) {
      expect(adk, `Missing export: ${name}`).toHaveProperty(name);
    }
  });
});
