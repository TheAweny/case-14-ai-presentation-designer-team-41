import { z } from 'zod';

export function parseArguments(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: text.trim() ? JSON.parse(text) : {} };
  } catch {
    return { ok: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The object schema under optional, nullable and default wrappers, if there is one. */
function objectShape(schema: unknown): Record<string, unknown> | undefined {
  let current = schema;
  for (let depth = 0; depth < 4; depth++) {
    if (current instanceof z.ZodObject) return current.shape as Record<string, unknown>;
    const unwrap = (current as { unwrap?: () => unknown } | undefined)?.unwrap;
    if (typeof unwrap !== 'function') return undefined;
    current = unwrap.call(current);
  }
  return undefined;
}

function acceptsNull(schema: unknown): boolean {
  return schema instanceof z.ZodType && schema.safeParse(null).success;
}

/**
 * JSON a model wrote, even when it left the last brackets open: they are closed in the order
 * they were opened. Null when it still does not read.
 */
export function lenientJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const open: string[] = [];
    let quoted = false;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quoted) {
        if (char === '\\') index++;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === '{') open.push('}');
      else if (char === '[') open.push(']');
      else if (char === '}' || char === ']') open.pop();
    }
    if (quoted || !open.length) return null;
    try {
      return JSON.parse(text + open.reverse().join(''));
    } catch {
      return null;
    }
  }
}

/** A value with every string of JSON in it read as what it says, at any depth. */
function unstrung(value: unknown, depth = 0): unknown {
  if (depth > 4) return value;
  if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
    const read = lenientJson(value);
    return read === null ? value : unstrung(read, depth + 1);
  }
  if (Array.isArray(value)) return value.map((item) => unstrung(item, depth + 1));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, unstrung(item, depth + 1)]),
    );
  return value;
}

/**
 * Arguments as the model meant them. Open models often send a nested object as a string of
 * JSON, or spread its fields over the top level; both are read back into the object before the
 * schema judges them. Anything else is left for the schema to reject with its reasons.
 */
export function mendedArguments(schema: z.ZodType, value: unknown): unknown {
  const shape = objectShape(schema);
  if (!isRecord(value) || !shape) return value;
  const out = unstrung(value) as Record<string, unknown>;
  for (const [key, field] of Object.entries(shape)) {
    if (out[key] === 'null' && acceptsNull(field)) {
      out[key] = null;
    }
    if (out[key] !== undefined) continue;
    const inner = objectShape(field);
    if (!inner) continue;
    const spread = Object.keys(inner).filter((name) => name in out && !(name in shape));
    if (!spread.length) continue;
    out[key] = Object.fromEntries(spread.map((name) => [name, out[name]]));
    for (const name of spread) delete out[name];
  }
  return out;
}
