import type { CapabilityInfo } from '../../types/modelConfig';

/**
 * Default capabilities — assumes a modern LlamaStack server.
 * Individual flags can be toggled based on server version detection.
 */
export function defaultCapabilities(): CapabilityInfo {
  return {
    functionTools: true,
    strictField: true,
    maxOutputTokens: true,
    mcpTools: true,
    parallelToolCalls: true,
    truncation: false,
  };
}

/**
 * Check if a specific Responses API parameter is supported.
 */
export function isParamSupported(
  caps: CapabilityInfo,
  param: string,
): boolean {
  switch (param) {
    case 'max_output_tokens':
      return caps.maxOutputTokens;
    case 'function_tools':
      return caps.functionTools;
    case 'strict':
      return caps.strictField;
    case 'truncation':
      return caps.truncation;
    default:
      return true;
  }
}

/**
 * Merge user-provided capability overrides with defaults.
 */
export function mergeCapabilities(
  overrides: Partial<CapabilityInfo>,
): CapabilityInfo {
  return { ...defaultCapabilities(), ...overrides };
}
