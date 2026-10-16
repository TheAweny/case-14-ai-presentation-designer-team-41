import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentConfigSchema } from '@lct/contracts';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { AgentManifestEntry, AnswerFormat, LoadedAgent } from './types.js';

/** Default location of the agent registry, relative to the repository root. */
export const DEFAULT_REGISTRY_DIR = 'registry/agents';

/** Reads and validates a single agent directory. */
export async function loadAgent(directory: string): Promise<LoadedAgent> {
  const raw = await readFile(join(directory, 'agent.yaml'), 'utf8');
  const config = agentConfigSchema.parse(parseYaml(raw));
  const instructions = await readFile(join(directory, config.instructionsFile), 'utf8');
  return { config, instructions, directory };
}

const sharedSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  answerFormatFile: z.string().min(1),
  answerRepairFile: z.string().min(1),
});

/**
 * The prompts the generation agents share, from `shared/` next to the agents directory. Each
 * file must hold its placeholder, or the answer would go out without the schema it promises.
 */
export async function loadAnswerFormat(
  registryDir: string = DEFAULT_REGISTRY_DIR,
): Promise<AnswerFormat> {
  const directory = join(registryDir, '..', 'shared');
  const config = sharedSchema.parse(
    parseYaml(await readFile(join(directory, 'shared.yaml'), 'utf8')),
  );
  const [format, repair] = await Promise.all([
    readFile(join(directory, config.answerFormatFile), 'utf8'),
    readFile(join(directory, config.answerRepairFile), 'utf8'),
  ]);
  if (!format.includes('{{schema}}') || !repair.includes('{{problems}}')) {
    throw new Error('The shared answer prompts must hold {{schema}} and {{problems}}.');
  }
  return { version: config.version, format: format.trim(), repair: repair.trim() };
}

/** Reads every agent directory of the registry, sorted by id for reproducible manifests. */
export async function loadRegistry(
  registryDir: string = DEFAULT_REGISTRY_DIR,
): Promise<LoadedAgent[]> {
  const entries = await readdir(registryDir, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const agents = await Promise.all(directories.map((name) => loadAgent(join(registryDir, name))));
  return agents;
}

/** Turns a loaded agent into the manifest entry written next to the run artifacts. */
export function toManifestEntry(agent: LoadedAgent): AgentManifestEntry {
  return {
    agentId: agent.config.id,
    agentVersion: agent.config.version,
    modelId: agent.config.modelId,
    instructionsSha256: createHash('sha256').update(agent.instructions, 'utf8').digest('hex'),
  };
}
