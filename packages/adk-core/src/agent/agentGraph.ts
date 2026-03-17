import type { AgentConfig } from '../types/agentConfig';
import type { ResponsesApiFunctionTool } from '../types/responsesApi';
import type { ILogger } from '../logger';
import { sanitizeName } from '../tools/toolNameUtils';
import { GraphValidationError } from '../errors';
import { buildHandoffTool, buildAgentAsToolTool } from './handoff';

const DEFAULT_MAX_TURNS = 10;

/**
 * A fully resolved agent with pre-built handoff and agent-as-tool functions.
 */
export interface ResolvedAgent {
  key: string;
  functionName: string;
  config: AgentConfig;
  handoffTools: ResponsesApiFunctionTool[];
  agentAsToolTools: ResponsesApiFunctionTool[];
  handoffTargetKeys: Set<string>;
  asToolTargetKeys: Set<string>;
}

/**
 * Immutable snapshot of the fully resolved agent graph for a single run.
 * The Runner receives this per-call; config changes mid-request don't
 * affect in-flight runs.
 */
export interface AgentGraphSnapshot {
  agents: Map<string, ResolvedAgent>;
  defaultAgentKey: string;
  maxTurns: number;
}

/**
 * Build and validate an AgentGraphSnapshot from raw AgentConfig records.
 * Pure function — no side effects beyond logging.
 */
export function resolveAgentGraph(
  configs: Record<string, AgentConfig>,
  defaultAgent: string,
  maxAgentTurns: number | undefined,
  logger: ILogger,
): AgentGraphSnapshot {
  const agents = buildAgentMap(configs, logger);
  const maxTurns = maxAgentTurns ?? DEFAULT_MAX_TURNS;
  validateAgentGraph(agents, defaultAgent, maxTurns, logger);
  return {
    agents,
    defaultAgentKey: defaultAgent,
    maxTurns,
  };
}

function buildAgentMap(
  configs: Record<string, AgentConfig>,
  logger: ILogger,
): Map<string, ResolvedAgent> {
  const agents = new Map<string, ResolvedAgent>();

  for (const [key, config] of Object.entries(configs)) {
    agents.set(key, {
      key,
      functionName: sanitizeName(key),
      config,
      handoffTools: [],
      agentAsToolTools: [],
      handoffTargetKeys: new Set(config.handoffs ?? []),
      asToolTargetKeys: new Set(config.asTools ?? []),
    });
  }

  for (const agent of agents.values()) {
    if (agent.config.handoffs) {
      for (const targetKey of agent.config.handoffs) {
        const target = agents.get(targetKey);
        if (!target) continue;
        if (target.config.enabled === false) {
          logger.info(
            `Skipping handoff "${agent.key}" -> "${targetKey}": target is disabled`,
          );
          continue;
        }
        agent.handoffTools.push(buildHandoffTool(targetKey, target.config));
      }
    }

    if (agent.config.asTools) {
      for (const targetKey of agent.config.asTools) {
        const target = agents.get(targetKey);
        if (!target) continue;
        if (target.config.enabled === false) {
          logger.info(
            `Skipping asTools "${agent.key}" -> "${targetKey}": target is disabled`,
          );
          continue;
        }
        agent.agentAsToolTools.push(buildAgentAsToolTool(targetKey, target.config));
      }
    }
  }

  return agents;
}

function validateAgentGraph(
  agents: Map<string, ResolvedAgent>,
  defaultAgentKey: string,
  maxTurns: number,
  logger: ILogger,
): void {
  if (!agents.has(defaultAgentKey)) {
    throw new GraphValidationError(
      `defaultAgent "${defaultAgentKey}" does not match any configured agent. ` +
        `Available: [${[...agents.keys()].join(', ')}]`,
    );
  }

  const defaultAgent = agents.get(defaultAgentKey)!;
  if (defaultAgent.config.enabled === false) {
    throw new GraphValidationError(
      `defaultAgent "${defaultAgentKey}" is disabled. The default agent must be enabled.`,
    );
  }

  for (const agent of agents.values()) {
    for (const targetKey of agent.config.handoffs ?? []) {
      if (!agents.has(targetKey)) {
        throw new GraphValidationError(
          `Agent "${agent.key}" has handoff to "${targetKey}" which does not exist. ` +
            `Available: [${[...agents.keys()].join(', ')}]`,
        );
      }
      const target = agents.get(targetKey)!;
      if (!target.config.handoffDescription && target.config.enabled !== false) {
        logger.warn(
          `Agent "${targetKey}" is a handoff target but has no handoffDescription.`,
        );
      }
    }

    for (const targetKey of agent.config.asTools ?? []) {
      if (!agents.has(targetKey)) {
        throw new GraphValidationError(
          `Agent "${agent.key}" has asTools reference to "${targetKey}" which does not exist. ` +
            `Available: [${[...agents.keys()].join(', ')}]`,
        );
      }
    }
  }

  const enabledCount = [...agents.values()].filter(
    a => a.config.enabled !== false,
  ).length;

  const hasHandoffs = [...agents.values()].some(a => a.handoffTargetKeys.size > 0);
  if (hasHandoffs) {
    logger.info(
      'Agent graph uses handoffs. Ensure the model provider supports ' +
      'previousResponseId (server-managed conversation) for full context continuity.',
    );
  }

  logger.info(
    `Validated ${agents.size} agent(s) (${enabledCount} enabled), default="${defaultAgentKey}", maxTurns=${maxTurns}`,
  );
}
