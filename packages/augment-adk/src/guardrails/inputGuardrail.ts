import type { ToolGuardrailRule } from '../types/agentConfig';

/**
 * Input guardrail that validates tool call arguments before execution.
 *
 * Returns the first matching rule that blocks the call, or undefined
 * if the call is allowed.
 */
export function checkInputGuardrail(
  toolName: string,
  argumentsJson: string,
  rules: ToolGuardrailRule[],
): ToolGuardrailRule | undefined {
  for (const rule of rules) {
    if (rule.phase !== 'input') continue;
    if (!matchesToolPattern(toolName, rule.toolPattern)) continue;

    if (rule.contentPattern) {
      const regex = new RegExp(rule.contentPattern, 'i');
      if (!regex.test(argumentsJson)) continue;
    }

    return rule;
  }
  return undefined;
}

/**
 * Evaluate an input guardrail rule and return the enforcement result.
 */
export function evaluateInputGuardrail(
  toolName: string,
  argumentsJson: string,
  rules: ToolGuardrailRule[],
): {
  allowed: boolean;
  action?: 'block' | 'warn' | 'require_approval';
  message?: string;
} {
  const match = checkInputGuardrail(toolName, argumentsJson, rules);
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
