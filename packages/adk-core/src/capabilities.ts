import type { CapabilityInfo } from './types/modelConfig';

/**
 * Default capabilities — assumes a modern Responses API server.
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
 * Merge user-provided capability overrides with defaults.
 */
export function mergeCapabilities(
  overrides: Partial<CapabilityInfo>,
): CapabilityInfo {
  return { ...defaultCapabilities(), ...overrides };
}
