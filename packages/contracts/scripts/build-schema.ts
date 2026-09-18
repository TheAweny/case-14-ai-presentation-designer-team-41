/**
 * contracts:schema — turns the Zod registry into JSON Schema.
 *
 * Output is written deterministically (sorted keys, stable formatting) so that
 * re-running the task on an unchanged registry produces byte-identical files.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { contractRegistry } from '../src/registry.js';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = resolve(here, '..', 'schema');

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key] as JsonValue);
    }
    return sorted;
  }
  return value;
}

function write(fileName: string, value: JsonValue): void {
  writeFileSync(join(schemaDir, fileName), `${JSON.stringify(sortKeys(value), null, 2)}\n`, 'utf8');
}

function main(): void {
  rmSync(schemaDir, { recursive: true, force: true });
  mkdirSync(schemaDir, { recursive: true });

  const defs: { [key: string]: JsonValue } = {};
  const properties: { [key: string]: JsonValue } = {};

  for (const [name, schema] of Object.entries(contractRegistry)) {
    const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as unknown as {
      [key: string]: JsonValue;
    };
    write(`${name}.schema.json`, { ...jsonSchema, title: name });
    defs[name] = { ...jsonSchema, title: name };
    properties[name] = { $ref: `#/$defs/${name}` };
  }

  // Single bundle consumed by contracts:codegen. Every definition is referenced
  // from the root object so the generator emits a model for each of them.
  write('contracts.schema.json', {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'ContractsBundle',
    description: 'All contracts shared between the TypeScript side and the Python engine.',
    type: 'object',
    additionalProperties: false,
    properties,
    $defs: defs,
  });

  const written = readdirSync(schemaDir).sort();
  process.stdout.write(`contracts:schema wrote ${written.length} files: ${written.join(', ')}\n`);
}

main();
