const INTERNAL_URL_PATTERN =
  /https?:\/\/[^\s]+\.svc(\.cluster\.local)?(:\d+)?[^\s]*/;
const RAW_URL_PATTERN = /https?:\/\/[^\s]+/;

/**
 * Sanitize MCP error messages to avoid exposing internal infrastructure
 * URLs (Kubernetes service URLs, proxy addresses, etc.) to users.
 */
export function sanitizeMcpError(
  error: string,
  serverLabel?: string,
): string {
  if (INTERNAL_URL_PATTERN.test(error) || RAW_URL_PATTERN.test(error)) {
    const label = serverLabel || 'MCP server';
    return buildUserFriendlyError(error, label);
  }
  return error;
}

function buildUserFriendlyError(error: string, label: string): string {
  if (/connection refused|ECONNREFUSED/i.test(error)) {
    return `MCP server "${label}" is temporarily unreachable (connection refused).`;
  }
  if (/timeout|ETIMEDOUT/i.test(error)) {
    return `MCP server "${label}" timed out.`;
  }
  if (/502/i.test(error)) {
    return `MCP server "${label}" returned an error (502).`;
  }
  if (/401|unauthorized/i.test(error)) {
    return `MCP server "${label}" rejected the request (unauthorized).`;
  }
  if (/403|forbidden/i.test(error)) {
    return `MCP server "${label}" denied access (forbidden).`;
  }
  return `MCP server "${label}" encountered an error.`;
}
