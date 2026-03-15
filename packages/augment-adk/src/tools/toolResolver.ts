import type { ILogger } from '../logger';
import { normalizeFunctionName } from './toolNameUtils';

const SEPARATOR = '__';

/**
 * Metadata for a resolved tool — maps a (possibly prefixed) name
 * back to its originating server and original name.
 */
export interface ResolvedToolInfo {
  serverId: string;
  serverUrl: string;
  originalName: string;
  prefixedName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Resolves tool names using 5 progressive fuzzy-matching strategies.
 *
 * LLMs frequently hallucinate tool names (wrong casing, missing prefix,
 * appending file extensions, using single vs double underscore). This
 * resolver handles all those cases gracefully.
 *
 * Strategies (in priority order):
 *  1. Exact match
 *  2. After stripping file extensions (.json, .yaml, etc.)
 *  3. Suffix match for unprefixed names ("pods_list" → "ocp-mcp__pods_list")
 *  4. Collapsed-separator match: single `_` where `__` is expected
 *  5. Case-insensitive exact match
 */
export class ToolResolver {
  private readonly registry = new Map<string, ResolvedToolInfo>();
  private readonly logger: ILogger;

  constructor(logger: ILogger) {
    this.logger = logger;
  }

  register(tool: ResolvedToolInfo): void {
    this.registry.set(tool.prefixedName, tool);
  }

  clear(): void {
    this.registry.clear();
  }

  get size(): number {
    return this.registry.size;
  }

  getAll(): ResolvedToolInfo[] {
    return [...this.registry.values()];
  }

  resolve(functionName: string): ResolvedToolInfo | undefined {
    const exact = this.registry.get(functionName);
    if (exact) return exact;

    const normalized = normalizeFunctionName(functionName);
    if (normalized !== functionName) {
      const afterNorm = this.registry.get(normalized);
      if (afterNorm) {
        this.logger.warn(`Tool "${functionName}" resolved to "${normalized}" after stripping extension`);
        return afterNorm;
      }
    }

    const suffix = `${SEPARATOR}${normalized}`;
    for (const [key, value] of this.registry) {
      if (key.endsWith(suffix)) {
        this.logger.warn(`Tool "${functionName}" resolved to "${key}" via suffix match`);
        return value;
      }
    }

    for (const [key, value] of this.registry) {
      const singleUnderscore = `${value.serverId}_${value.originalName}`;
      if (normalized === singleUnderscore) {
        this.logger.warn(`Tool "${functionName}" resolved to "${key}" via collapsed-separator match`);
        return value;
      }
    }

    const lower = normalized.toLowerCase();
    for (const [key, value] of this.registry) {
      if (key.toLowerCase() === lower) {
        this.logger.warn(`Tool "${functionName}" resolved to "${key}" via case-insensitive match`);
        return value;
      }
    }

    return undefined;
  }

  isKnown(functionName: string): boolean {
    return this.resolve(functionName) !== undefined;
  }

  getServerInfo(functionName: string): { serverId: string; originalName: string } | undefined {
    const tool = this.resolve(functionName);
    if (!tool) return undefined;
    return { serverId: tool.serverId, originalName: tool.originalName };
  }
}
