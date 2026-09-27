import { readFile } from 'node:fs/promises';
import { modelCatalogSchema, type ModelCatalog, type ModelEntry } from '@lct/contracts';
import { parse as parseYaml } from 'yaml';
import type { LoadedAgent } from './types.js';

/** Default location of the model catalogue, relative to the repository root. */
export const DEFAULT_MODEL_CATALOG = 'configs/models.yaml';

/** Reads configs/models.yaml and validates it against the shared ModelCatalog contract. */
export async function loadModelCatalog(
  path: string = DEFAULT_MODEL_CATALOG,
): Promise<ModelCatalog> {
  return modelCatalogSchema.parse(parseYaml(await readFile(path, 'utf8')));
}

/** The catalogue entry for a model id, or an error naming the ids that do exist. */
export function resolveModel(catalog: ModelCatalog, modelId: string): ModelEntry {
  const model = catalog.models.find((entry) => entry.id === modelId);
  if (model === undefined) {
    const known = catalog.models.map((entry) => entry.id).join(', ');
    throw new Error(`Model "${modelId}" is not in the catalogue. Known: ${known}.`);
  }
  return model;
}

/**
 * Problems between the agents and the catalogue: an agent bound to a model that is not listed,
 * or to a model of a type that cannot do its job. Empty when the registry is consistent.
 */
export function checkAgentModels(agents: readonly LoadedAgent[], catalog: ModelCatalog): string[] {
  const problems: string[] = [];
  for (const agent of agents) {
    const model = catalog.models.find((entry) => entry.id === agent.config.modelId);
    if (model === undefined) {
      problems.push(`${agent.config.id}: model "${agent.config.modelId}" is not in the catalogue`);
    } else if (model.type === 'text-to-image') {
      problems.push(`${agent.config.id}: "${model.id}" draws pictures and cannot answer in JSON`);
    }
  }
  return problems;
}
