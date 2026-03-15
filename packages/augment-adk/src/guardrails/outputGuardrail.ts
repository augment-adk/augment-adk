import type { ToolGuardrailRule } from '../types/agentConfig';

/**
 * Output guardrail that validates tool execution results.
 *
 * Returns the first matching rule that blocks the output, or undefined
 * if the output is allowed.
 */
export function checkOutputGuardrail(
  toolName: string,
  output: string,
  rules: ToolGuardrailRule[],
): ToolGuardrailRule | undefined {
  for (const rule of rules) {
    if (rule.phase !== 'output') continue;
    if (!matchesToolPattern(toolName, rule.toolPattern)) continue;

    if (rule.contentPattern) {
      const regex = new RegExp(rule.contentPattern, 'i');
      if (!regex.test(output)) continue;
    }

    return rule;
  }
  return undefined;
}

/**
 * Evaluate an output guardrail rule and return the enforcement result.
 */
export function evaluateOutputGuardrail(
  toolName: string,
  output: string,
  rules: ToolGuardrailRule[],
): {
  allowed: boolean;
  action?: 'block' | 'warn' | 'require_approval';
  message?: string;
} {
  const match = checkOutputGuardrail(toolName, output, rules);
  if (!match) return { allowed: true };

  return {
    allowed: match.action !== 'block',
    action: match.action,
    message: match.message,
  };
}

function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return regex.test(toolName);
}
