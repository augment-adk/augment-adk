/**
 * Match a tool name against a glob-style pattern (supports `*` and `?`).
 * All other regex-special characters in the pattern are escaped so that
 * literal tool names like `my.tool` don't inadvertently match `myXtool`.
 */
export function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$').test(toolName);
}
