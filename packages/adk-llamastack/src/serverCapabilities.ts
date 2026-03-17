import type { CapabilityInfo } from '@augment-adk/adk-core';

export { defaultCapabilities, mergeCapabilities } from '@augment-adk/adk-core';

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
