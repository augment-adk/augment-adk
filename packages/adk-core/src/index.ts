// =============================================================================
// Public API — @augment-adk/adk-core
// =============================================================================

// Entry point
export { run, type RunOptions } from './run';
export { runStream, type RunStreamOptions } from './runStream';

// Agent
export { Agent, type DynamicInstructions } from './agent/agent';
export {
  resolveAgentGraph,
  type ResolvedAgent,
  type AgentGraphSnapshot,
} from './agent/agentGraph';

// Handoff
export {
  buildHandoffTool,
  buildAgentAsToolTool,
  applyHandoffInputFilter,
  wrapHandoffOutput,
  nestHandoffHistory,
  parseHandoffReason,
  handoffFilters,
  promptWithHandoffInstructions,
  type HandoffTarget,
} from './agent/handoff';

// Hooks
export { type AgentHooks, type RunHooks, dispatchToHooks } from './hooks';

// Model
export { type Model, type ModelProvider, type ModelTurnOptions } from './model';

// Capabilities
export { defaultCapabilities, mergeCapabilities } from './capabilities';

// Tools
export { tool, toApiTool, type FunctionTool, type ToolDefinition } from './tools/tool';
export {
  sanitizeName,
  prefixName,
  unprefixName,
  slimSchema,
} from './tools/toolNameUtils';
export { ToolResolver, type ResolvedToolInfo } from './tools/toolResolver';
export { MCPToolManager, type MCPConnection, type MCPConnectionFactory } from './tools/mcpTool';
export { executeToolCalls, type ToolCallRequest, type ToolCallResult } from './tools/toolExecution';
export { type ToolScopeProvider, type ToolDescriptor, type ToolScopeResult } from './tools/toolScopeProvider';
export {
  type ToolSearchProvider,
  type ToolSearchResult,
  StaticToolSearchProvider,
  RemoteToolSearchProvider,
} from './tools/toolSearch';
export {
  webSearchTool,
  fileSearchTool,
  type WebSearchToolOptions,
  type FileSearchToolOptions,
} from './tools/hostedTools';
export {
  hostedMcpTool,
  type HostedMcpToolOptions,
} from './tools/hostedMcpTool';

// Retry policies
export {
  never as retryNever,
  onNetworkError,
  onHttpStatus,
  onRateLimit,
  onServerError,
  maxAttempts as retryMaxAttempts,
  any as retryAny,
  all as retryAll,
  defaultRetryPolicy,
  withRetry,
  backoffDelay,
  type RetryPolicy,
  type RetryPolicyContext,
} from './runner/retryPolicy';

// Runner
export { RunContext, type ToolApprovalDecision } from './runner/RunContext';
export type { RunResult, SubAgentContext } from './runner/RunResult';
export { StreamedRunResult } from './runner/StreamedRunResult';
export type { RunState } from './runner/RunState';
export { createInitialState, createInterruptedState, createInterruptedStateFromResult, createContinuationState, serializeRunState, deserializeRunState } from './runner/RunState';
export {
  DefaultOutputClassifier,
  type OutputClassifierInterface,
} from './runner/outputClassifier';
export {
  processResponse,
  extractTextFromResponse,
  type RAGSource,
  type ReasoningSummary,
  type ApprovalInfo,
} from './runner/responseProcessor';
export { runLoop, type RunnerOptions } from './runner/runLoop';
export { runLoopStream, type StreamRunnerOptions } from './runner/runLoopStream';
export {
  buildResumeToolOutputs,
  flattenSubAgentChain,
  unwindSubAgentMcpResume,
  type ResumeEmitter,
  type SubAgentModelCall,
} from './runner/resumeHelper';

// Stream
export type { NormalizedStreamEvent } from './stream/events';
export type { RunStreamEvent } from './stream/runStreamEvents';
export { LS_EVENT, RESPONSES_EVENT, IMMEDIATE_FORWARD_TYPES } from './stream/constants';
export { normalizeResponsesApiEvent, normalizeLlamaStackEvent } from './stream/normalizer';
export { sanitizeMcpError } from './stream/errorSanitizer';
export { StreamAccumulator } from './stream/streamAccumulator';

// Tracing
export {
  type Span,
  type SpanData,
  type SpanKind,
  type Trace,
  type TracingProcessor,
  type SpanExporter,
  TraceProvider,
  DefaultSpan,
  NoopSpan,
  DefaultTrace,
  NoopTrace,
  BatchTraceProcessor,
  ConsoleSpanExporter,
} from './tracing';

// Session
export {
  type Session,
  InMemorySession,
  ServerManagedSession,
  CompactionSession,
  type CompactionSessionOptions,
  type Summarizer,
  ServerConversationTracker,
} from './session';

// Approval
export { ApprovalStore, type PendingApproval } from './approval/ApprovalStore';
export { partitionByApproval } from './approval/partitionByApproval';

// Guardrails
export { checkInputGuardrail, evaluateInputGuardrail } from './guardrails/inputGuardrail';
export { checkOutputGuardrail, evaluateOutputGuardrail } from './guardrails/outputGuardrail';

// Errors
export {
  AdkError,
  MaxTurnsError,
  AgentNotFoundError,
  GraphValidationError,
  GuardrailError,
  ToolNotFoundError,
  CycleDetectedError,
  toErrorMessage,
} from './errors';

// Logger
export { type ILogger, consoleLogger, noopLogger } from './logger';

// Zod compatibility (optional peer dep)
export {
  isZodAvailable,
  zodSchemaToJsonSchema,
  validateWithZod,
} from './utils/zodCompat';

// Types
export type {
  AgentConfig,
  FunctionDefinition,
  HandoffInputFilter,
  HandoffInputFilterFunction,
  HandoffInputFilterContext,
  ToolUseBehavior,
  ToolUseBehaviorFunction,
  ToolUseBehaviorContext,
  ToolUseBehaviorToolResult,
  ToolUseBehaviorDecision,
  OutputSchema,
  ToolGuardrailRule,
  ToolChoiceConfig,
  ReasoningConfig,
  PromptRef,
  AllowedToolSpec,
} from './types/agentConfig';
export type {
  EffectiveConfig,
  MCPServerConfig,
  ToolScopingConfig,
  CapabilityInfo,
} from './types/modelConfig';
export type {
  ResponsesApiResponse,
  ResponsesApiOutputEvent,
  ResponsesApiInputItem,
  ResponsesApiTool,
  ResponsesApiFunctionTool,
  ResponsesApiMcpTool,
  ResponsesApiMessage,
  ResponsesApiFunctionCall,
  FunctionCallOutputItem,
  ResponseUsage,
  ResponsesApiMcpApprovalRequest,
  ResponsesApiMcpListTools,
  ResponsesApiWebSearchCall,
  McpApprovalResponseItem,
} from './types/responsesApi';
export type {
  AgentLifecycleEvent,
  LifecycleEventCallback,
} from './types/lifecycle';
