const SEPARATOR = '__';

/**
 * Sanitize a string into a valid function tool name.
 * Only allows [a-z0-9_], collapses runs of underscores, trims edges.
 */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Create a prefixed tool name: `{serverId}__{toolName}`.
 */
export function prefixName(serverId: string, toolName: string): string {
  return `${serverId}${SEPARATOR}${toolName}`;
}

/**
 * Split a prefixed tool name back into serverId and toolName.
 * Returns null if the name doesn't contain the separator.
 */
export function unprefixName(
  prefixed: string,
): { serverId: string; toolName: string } | null {
  const idx = prefixed.indexOf(SEPARATOR);
  if (idx < 0) return null;
  return {
    serverId: prefixed.slice(0, idx),
    toolName: prefixed.slice(idx + SEPARATOR.length),
  };
}

/**
 * Strip verbose metadata from JSON Schema to reduce token footprint.
 * Keeps: type, properties (names + types), required, enum, items.
 * Removes: nested descriptions, examples, $schema, title, default, additionalProperties.
 */
export function slimSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const STRIP_KEYS = new Set([
    'description',
    'examples',
    'example',
    '$schema',
    'title',
    'default',
    'additionalProperties',
  ]);

  const slim = (obj: unknown): unknown => {
    if (Array.isArray(obj)) return obj.map(slim);
    if (obj !== null && typeof obj === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (STRIP_KEYS.has(k)) continue;
        out[k] = slim(v);
      }
      return out;
    }
    return obj;
  };

  return slim(schema) as Record<string, unknown>;
}

/**
 * Normalize a tool name by stripping file extensions the LLM may
 * hallucinate (e.g. "rhokp__solr_query.json" → "rhokp__solr_query").
 */
export function normalizeFunctionName(name: string): string {
  return name.replace(/\.(json|yaml|yml|xml|txt)$/i, '');
}
