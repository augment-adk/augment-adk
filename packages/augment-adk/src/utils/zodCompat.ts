/**
 * Optional Zod integration for structured output.
 *
 * Zod is an optional peer dependency. If not installed, this module
 * exports no-op helpers that pass through raw JSON schemas.
 * All public functions check for Zod availability at runtime.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const dynamicRequire = typeof require !== 'undefined' ? require : undefined;

let zodModule: typeof import('zod') | undefined;
let zodToJsonSchemaModule: ((schema: unknown) => Record<string, unknown>) | undefined;

function tryLoadZod(): typeof import('zod') | undefined {
  if (zodModule !== undefined) return zodModule;
  if (!dynamicRequire) return undefined;
  try {
    zodModule = dynamicRequire('zod');
    return zodModule;
  } catch {
    return undefined;
  }
}

function tryLoadZodToJsonSchema(): ((schema: unknown) => Record<string, unknown>) | undefined {
  if (zodToJsonSchemaModule !== undefined) return zodToJsonSchemaModule;
  if (!dynamicRequire) return undefined;
  try {
    const mod = dynamicRequire('zod-to-json-schema');
    zodToJsonSchemaModule = mod.zodToJsonSchema ?? mod.default ?? mod;
    return zodToJsonSchemaModule;
  } catch {
    return undefined;
  }
}

/**
 * Returns true if Zod is available as a runtime dependency.
 */
export function isZodAvailable(): boolean {
  return tryLoadZod() !== undefined;
}

/**
 * Attempts to convert a Zod schema to a JSON Schema object.
 * Returns undefined if Zod or zod-to-json-schema is not installed.
 */
export function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> | undefined {
  const zod = tryLoadZod();
  if (!zod) return undefined;

  if (schema && typeof schema === 'object' && '_def' in schema) {
    const converter = tryLoadZodToJsonSchema();
    if (converter) {
      return converter(schema);
    }
    const def = (schema as { _def: { typeName?: string } })._def;
    if (def && typeof def === 'object') {
      return { type: 'object', description: `Zod schema: ${def.typeName ?? 'unknown'}` };
    }
  }

  return undefined;
}

/**
 * Validates a JSON string against a Zod schema.
 * Returns the parsed result or a validation error.
 */
export function validateWithZod(
  jsonString: string,
  schema: unknown,
): { success: true; data: unknown } | { success: false; error: string } {
  const zod = tryLoadZod();
  if (!zod || !schema || typeof schema !== 'object' || !('safeParse' in schema)) {
    return { success: true, data: JSON.parse(jsonString) };
  }

  try {
    const parsed = JSON.parse(jsonString);
    const safeParse = (schema as Record<string, unknown>).safeParse as (data: unknown) => { success: boolean; data?: unknown; error?: { message: string } };
    const result = safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error?.message ?? 'Zod validation failed' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
