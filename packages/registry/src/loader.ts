import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { agentConfigSchema } from '@lct/contracts';
import { parse as parseYaml } from 'yaml';
import type { AgentManifestEntry, LoadedAgent } from './types.js';

/** Default location of the agent registry, relative to the repository root. */
export const DEFAULT_REGISTRY_DIR = 'registry/agents';

/** Reads and validates a single agent directory. */
export async function loadAgent(directory: string): Promise<LoadedAgent> {
  const raw = await readFile(join(directory, 'agent.yaml'), 'utf8');
  const config = agentConfigSchema.parse(parseYaml(raw));
  const instructions = await readFile(join(directory, config.instructionsFile), 'utf8');
  return { config, instructions, directory };
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
