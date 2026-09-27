import { join } from 'node:path';
import { modelCatalogSchema } from '@lct/contracts';
import { describe, expect, it } from 'vitest';
import { loadRegistry } from './loader.js';
import { checkAgentModels, loadModelCatalog, resolveModel } from './models.js';

const root = join(__dirname, '..', '..', '..');
const catalogPath = join(root, 'configs', 'models.yaml');

const entry = {
  id: 'planner-default',
  repo: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
  revision: '0d7cf23991f47feeb3a57ecb4c9cee8ea4a17bfe',
  license: 'Apache-2.0',
  sizeB: 30.5,
  type: 'llm',
  provider: 'openai-compatible',
  baseUrlEnv: 'LLM_BASE_URL',
};

describe('model catalogue', () => {
  it('loads the catalogue the repository ships', async () => {
    const catalog = await loadModelCatalog(catalogPath);
    expect(resolveModel(catalog, 'planner-default').type).toBe('llm');
    expect(catalog.models.some((model) => model.provider === 'fake')).toBe(true);
  });

  it('refuses weights pinned to a branch', () => {
    const result = modelCatalogSchema.safeParse({ models: [{ ...entry, revision: 'main' }] });
    expect(result.success).toBe(false);
  });

  it('refuses a license the case does not allow', () => {
    const result = modelCatalogSchema.safeParse({ models: [{ ...entry, license: 'GPL-3.0' }] });
    expect(result.success).toBe(false);
  });

  it('refuses a model above 35B', () => {
    const result = modelCatalogSchema.safeParse({ models: [{ ...entry, sizeB: 70 }] });
    expect(result.success).toBe(false);
  });

  it('refuses two entries with one id', () => {
    const result = modelCatalogSchema.safeParse({ models: [entry, entry] });
    expect(result.success).toBe(false);
  });

  it('names the known ids when a model is missing', async () => {
    const catalog = await loadModelCatalog(catalogPath);
    expect(() => resolveModel(catalog, 'nope')).toThrow(/planner-default/);
  });
});

describe('agents against the catalogue', () => {
  it('finds every agent of the registry a model it can run on', async () => {
    const agents = await loadRegistry(join(root, 'registry', 'agents'));
    const catalog = await loadModelCatalog(catalogPath);
    expect(checkAgentModels(agents, catalog)).toEqual([]);
  });

  it('reports an agent bound to a missing or a picture model', async () => {
    const [agent] = await loadRegistry(join(root, 'registry', 'agents'));
    if (agent === undefined) {
      throw new Error('The registry has no agents to check.');
    }
    const catalog = await loadModelCatalog(catalogPath);
    const lost = { ...agent, config: { ...agent.config, modelId: 'gone' } };
    const painter = { ...agent, config: { ...agent.config, modelId: 'illustrator-default' } };
    expect(checkAgentModels([lost, painter], catalog)).toHaveLength(2);
  });
});
