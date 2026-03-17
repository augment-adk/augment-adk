/**
 * Config adapter — strips Backstage-specific fields before passing
 * the effective config to the ADK.
 *
 * Your plugin's EffectiveConfig likely has extra fields for branding,
 * safety shields, evaluation, etc. that the ADK doesn't know about.
 * This adapter removes them so the types align cleanly.
 *
 * Simplified from:
 * https://github.com/rrbanda/rhdh-plugins/blob/feat/augment-workspace-v2/
 *   workspaces/augment/plugins/augment-backend/src/providers/llamastack/
 *   adk-adapters/configAdapter.ts
 */
import type {
  EffectiveConfig as AdkEffectiveConfig,
  MCPServerConfig as AdkMCPServerConfig,
} from '@augment-adk/augment-adk';

/**
 * Your plugin's extended config type. This is what Backstage's
 * ConfigLoader produces from app-config.yaml + DB overrides.
 */
export interface PluginEffectiveConfig extends AdkEffectiveConfig {
  branding?: Record<string, unknown>;
  safetyEnabled?: boolean;
  inputShields?: string[];
  outputShields?: string[];
  evaluationEnabled?: boolean;
  scoringFunctions?: string[];
  minScoreThreshold?: number;
}

/**
 * Your plugin's MCP server config with auth extensions.
 */
export interface PluginMCPServerConfig extends AdkMCPServerConfig {
  authRef?: string;
  oauth?: Record<string, unknown>;
  serviceAccount?: Record<string, unknown>;
}

/**
 * Strip Backstage-only fields, forward everything else to the ADK.
 */
export function toAdkEffectiveConfig(
  plugin: PluginEffectiveConfig,
): AdkEffectiveConfig {
  const {
    branding: _branding,
    safetyEnabled: _safetyEnabled,
    inputShields: _inputShields,
    outputShields: _outputShields,
    evaluationEnabled: _evaluationEnabled,
    scoringFunctions: _scoringFunctions,
    minScoreThreshold: _minScoreThreshold,
    mcpServers,
    agents,
    ...rest
  } = plugin;

  return {
    ...rest,
    mcpServers: mcpServers?.map(toAdkMcpServerConfig),
    agents: agents as AdkEffectiveConfig['agents'],
  };
}

/**
 * Strip auth fields from MCP server config (they're resolved
 * into `headers` before reaching the ADK).
 */
export function toAdkMcpServerConfig(
  plugin: PluginMCPServerConfig | AdkMCPServerConfig,
): AdkMCPServerConfig {
  return {
    id: plugin.id,
    name: plugin.name,
    type: plugin.type,
    url: plugin.url,
    headers: plugin.headers,
    requireApproval: plugin.requireApproval,
    allowedTools: plugin.allowedTools,
  };
}
