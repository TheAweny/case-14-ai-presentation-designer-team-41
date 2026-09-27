import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ModelBinding, RunConfig } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import {
  buildContentPack,
  createProvider,
  generateDeck,
  type BoundAgent,
  type GenerateDeckResult,
  type ProviderEnv,
} from '@lct/pipeline';
import { loadModelCatalog, loadRegistry, resolveModel } from '@lct/registry';

/** Agent that plays each role of a run config. */
const AGENT_FOR_ROLE: Partial<Record<ModelBinding['role'], string>> = {
  planner: 'deck-planner',
  vision: 'slide-reviewer',
};

export interface GenerateOptions {
  readonly config: RunConfig;
  readonly configPath: string;
  readonly env?: ProviderEnv;
  readonly log?: (line: string) => void;
}

/** The goal of a deck: stated in the config, or the first paragraph of the content file. */
function goalOf(config: RunConfig, content: string): string {
  if (config.goal) return config.goal;
  const first = content.split(/\n\s*\n/).find((block) => block.trim().length > 0) ?? '';
  return first.replace(/^#+\s*/, '').trim() || basename(config.contentPath);
}

/**
 * Runs the whole pipeline from a run config: content pack, plan, three variants, both halves of
 * the audit, PPTX and PDF, manifest. Models are bound by the config's roles; the provider comes
 * from the environment, so MODEL_PROVIDER=fake runs it offline on recorded answers.
 */
export async function generateFromConfig(options: GenerateOptions): Promise<GenerateDeckResult> {
  const { config } = options;
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const content = await readFile(config.contentPath, 'utf8');
  const runId = `run-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
  const pack = buildContentPack({
    briefId: runId,
    goal: goalOf(config, content),
    audience: config.audience ?? '',
    language: config.language ?? 'ru',
    documents: [{ title: '', text: content, origin: config.contentPath }],
  });

  const [agents, catalog] = await Promise.all([loadRegistry(), loadModelCatalog()]);
  const bind = (role: ModelBinding['role']): BoundAgent | undefined => {
    const agentId = AGENT_FOR_ROLE[role];
    const agent = agents.find((a) => a.config.id === agentId);
    if (agent === undefined) return undefined;
    const modelId = config.models.find((m) => m.role === role)?.modelId ?? agent.config.modelId;
    const bound = { ...agent, config: { ...agent.config, modelId } };
    return {
      agent: bound,
      model: resolveModel(catalog, modelId),
      provider: createProvider(catalog, modelId, env),
    };
  };
  const planner = bind('planner');
  if (planner === undefined) {
    throw new Error('The registry has no deck-planner agent.');
  }
  const reviewer = bind('vision');

  const engine = new EngineClient({
    baseUrl: env.ENGINE_URL ?? 'http://localhost:8000',
    timeoutMs: 180_000,
  });
  log(
    `${runId}: ${config.templatePath}, ${config.slideCount} слайдов, ${config.layoutVariants.join('/')}`,
  );
  const result = await generateDeck({
    runId,
    runDir: join(config.outputDir, runId),
    templatePath: config.templatePath,
    pack,
    slideCount: config.slideCount,
    variants: config.layoutVariants,
    auditProfile: config.auditProfile,
    seed: config.seed,
    engine,
    planner,
    ...(reviewer ? { reviewer } : {}),
    configFiles: [options.configPath, 'configs/models.yaml', 'configs/audit.yaml'],
    onStage: (stage, note) => log(`  ${stage}: ${note}`),
  });
  for (const variant of result.variants) {
    const verdict = variant.audit.passed ? 'проходит' : 'есть замечания';
    log(
      `  ${variant.variant}: аудит ${variant.audit.score}, ${verdict}, ` +
        `контекстных находок ${variant.contextual.length}; ${variant.files.join(', ')}`,
    );
  }
  for (const warning of result.warnings) log(`  ! ${warning}`);
  const budget = result.manifest.totalMs <= 300_000 ? 'в бюджете 5 минут' : 'ВНЕ бюджета 5 минут';
  log(`готово за ${(result.manifest.totalMs / 1000).toFixed(1)} с, ${budget}`);
  return result;
}
