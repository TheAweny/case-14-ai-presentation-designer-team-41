import { readFileSync } from 'node:fs';
import { runConfigSchema, type RunConfig } from '@lct/contracts';
import { parse as parseYaml } from 'yaml';

/** Reads a run config from disk and validates it against the shared contract. */
export function readRunConfig(path: string): RunConfig {
  return runConfigSchema.parse(parseYaml(readFileSync(path, 'utf8')));
}
