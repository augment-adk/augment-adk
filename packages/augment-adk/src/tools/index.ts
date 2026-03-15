export { tool, toApiTool, type FunctionTool, type ToolDefinition } from './tool';
export {
  sanitizeName,
  prefixName,
  unprefixName,
  slimSchema,
  normalizeFunctionName,
} from './toolNameUtils';
export { ToolResolver, type ResolvedToolInfo } from './toolResolver';
export {
  MCPToolManager,
  type MCPConnection,
  type MCPConnectionFactory,
} from './mcpTool';
export {
  executeToolCalls,
  type ToolCallRequest,
  type ToolCallResult,
  type ToolExecutionDeps,
} from './toolExecution';
export {
  type ToolScopeProvider,
  type ToolDescriptor,
  type ToolScopeResult,
} from './toolScopeProvider';
