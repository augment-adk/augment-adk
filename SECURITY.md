# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Augment ADK, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email security concerns to the maintainers via the repository's security advisory feature:

1. Go to the [Security Advisories](https://github.com/augment-adk/augment-adk/security/advisories) page
2. Click "Report a vulnerability"
3. Provide a description of the issue, steps to reproduce, and potential impact

We will acknowledge receipt within 48 hours and provide an estimated timeline for a fix.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |

## Security Considerations

- **TLS verification** is configurable per model (`skipTlsVerify`). In production, TLS verification should always be enabled.
- **No credential storage.** API keys and tokens are passed via configuration or environment variables. The ADK does not persist credentials.
- **Input sanitization.** `sanitizeMcpError()` strips potentially sensitive information from MCP tool error messages before they reach the model.
- **Tool execution.** Function tools execute in the host process with no sandboxing. The host application is responsible for ensuring tool handlers do not perform unauthorized operations.
- **Approval workflows.** Destructive tool calls can require human approval via `requireApproval` on MCP server configs.
