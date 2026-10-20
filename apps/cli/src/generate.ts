import { existsSync } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  NO_REASONING_CHOICE,
  brandbookBindingSchema,
  headerRecord,
  headersProblem,
  parseHeaderEnv,
  storedTemplateIndexSchema,
  type BrandbookBinding,
  type CompositionNote,
  type GenerationProfile,
  type LayoutVariant,
  type RunConfig,
} from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import {
  FakeImageProvider,
  OpenAICompatibleImageProvider,
  SharedIllustrations,
  currentTemplateIndexRevision,
  GenerationProvider,
  type ImageProvider,
  generatePresentation,
  indexTemplateWithAgent,
  SharedPlan,
  anthropicTransport,
} from '@lct/pipeline';
import { loadAnswerFormat } from '@lct/registry';
import { BrandbookPictures, brandPictures } from './brand-pictures.js';
import { datasetsOf, readMaterial } from './material.js';
import { repoRoot } from './setup/stack.js';

type Env = Readonly<Record<string, string | undefined>>;

export interface GenerateOptions {
  readonly config: RunConfig;
  readonly configPath: string;
  readonly env?: Env;
  readonly log?: (line: string) => void;
}

export interface VariantOutcome {
  readonly variant: LayoutVariant;
  readonly state: 'done' | 'failed';
  readonly ms: number;
  readonly dir: string;
  /** The editable deck and its PDF, when they were written. */
  readonly files: readonly string[];
  /** Findings of the deterministic audit: blockers and majors, and the rest. */
  readonly audit: { readonly errors: number; readonly warnings: number } | null;
  readonly error?: string;
}

export interface GenerateResult {
  readonly runId: string;
  readonly runDir: string;
  readonly totalMs: number;
  readonly variants: readonly VariantOutcome[];
}

/** The goal of a deck: stated in the config, or the first paragraph of the content file. */
function goalOf(config: RunConfig, content: string): string {
  if (config.goal) return config.goal;
  const first = content.split(/\n\s*\n/).find((block) => block.trim().length > 0) ?? '';
  return first.replace(/^#+\s*/, '').trim() || basename(config.contentPath);
}

/** The brief as the chat composes it: what the deck is for, for whom, then the material. */
function briefOf(config: RunConfig, content: string): string {
  return [
    goalOf(config, content),
    config.audience ? `Аудитория: ${config.audience}` : '',
    content.trim(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The brandbook of a run, parsed by the engine the way an upload is. Only declared rules restyle
 * the deck; colours and fonts merely seen in pictures or font files stay observations, and the
 * log says so rather than letting a run look styled when it is not.
 */
async function brandbookOf(
  engine: EngineClient,
  path: string,
  runDir: string,
  config: RunConfig,
  log: (line: string) => void,
): Promise<BrandbookBinding> {
  const profile = await engine.parseBrandbook({
    schemaVersion: 1,
    path,
    outputDir: join(runDir, 'brandbook'),
  });
  await writeFile(join(runDir, 'brandbook-profile.json'), JSON.stringify(profile, null, 2));
  const declared = profile.tokens.filter((token) => token.authority === 'explicit').length;
  const inferred = profile.tokens.filter((token) => token.authority === 'inferred');
  const observed = profile.tokens.length - declared - inferred.length;
  const priority = config.brandbookPriority ?? 'brandbook';
  log(
    `брендбук ${basename(path)}: файлов ${profile.coverage.filesTotal}, объявленных правил ` +
      `${declared}, замеченных значений ${observed}, приоритет — ${priority === 'brandbook' ? 'брендбук' : 'шаблон'}`,
  );
  if (declared === 0 && inferred.length > 0) {
    log(
      '  правил брендбук не объявляет; из логотипов, картинок и шрифтов выведено: ' +
        inferred.map((token) => `${token.role} ${String(token.value)}`).join(', '),
    );
  } else if (declared === 0) {
    log('  правил брендбук не объявляет, а вывести их не из чего: шаблон не изменится');
  }
  for (const warning of profile.warnings) log(`  ${warning}`);
  return brandbookBindingSchema.parse({
    schemaVersion: 1,
    profile,
    priority,
    assetRoot: join(runDir, 'brandbook'),
  });
}

/**
 * The image model of a config run, read the way the service reads `IMAGE_*`.
 * `disabled` calls no model, `fake` draws offline, and a configured model uses its own key
 * before the text key. Null means there is no model; brandbook photos may still be used.
 */
export function imageModelOf(
  env: Env,
): { baseUrl: string; apiKey: string; model: string } | 'fake' | null {
  if (env.IMAGE_PROVIDER === 'disabled') return null;
  if (env.IMAGE_PROVIDER === 'fake') return 'fake';
  const baseUrl = env.IMAGE_BASE_URL?.trim() ?? '';
  const model = env.IMAGE_MODEL?.trim() ?? '';
  if (!baseUrl || !model) return null;
  // Compose and `lct image` write IMAGE_API_KEY as an empty string when no separate key was set.
  // An empty value is not a key: the text model's key is what used to authenticate these calls.
  const imageKey = env.IMAGE_API_KEY?.trim() ?? '';
  return { baseUrl, apiKey: imageKey || (env.MODEL_API_KEY?.trim() ?? ''), model };
}

/**
 * Where a deck's pictures come from: the image model of the environment when one is set, else
 * the brandbook's own photos and illustrations, else nowhere and picture frames are dropped.
 */
function imagesOf(
  env: Env,
  brandbook: BrandbookBinding | undefined,
  log: (line: string) => void,
): ImageProvider | null {
  const model = imageModelOf(env);
  if (model === 'fake') return new FakeImageProvider();
  if (model) {
    log(`картинки рисует ${model.model}`);
    return new OpenAICompatibleImageProvider(model);
  }
  const pictures =
    brandbook?.assetRoot !== undefined ? brandPictures(brandbook.profile, brandbook.assetRoot) : [];
  if (pictures.length === 0) return null;
  log(`картинки берутся из брендбука: ${pictures.length}`);
  return new BrandbookPictures(pictures);
}

/** What went wrong, in words: a workflow fails with an error object that is not an Error. */
export function failureText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return typeof error === 'string' ? error : JSON.stringify(error);
}

/** The model connection of the server, read the way the API reads it. */
export function connectionOf(env: Env) {
  if (env.MODEL_PROVIDER === 'fake') {
    throw new Error(
      'lct generate собирает колоды живой моделью, а MODEL_PROVIDER=fake отвечает только ' +
        'записанными ответами тестов. Подключите модель: lct onboard.',
    );
  }
  const baseUrl = env.LLM_BASE_URL?.trim() ?? '';
  const model = env.LLM_MODEL?.trim() ?? '';
  if (!baseUrl || !model) {
    throw new Error('Модель не задана: нужны LLM_BASE_URL и LLM_MODEL в .env (lct onboard).');
  }
  const headers = parseHeaderEnv(env.MODEL_HEADERS);
  if (headersProblem(headers)) {
    throw new Error('MODEL_HEADERS — пары Имя=значение через запятую.');
  }
  const toggle = env.MODEL_REASONING_TOGGLE?.trim() ?? '';
  if (toggle && toggle !== 'reasoning-effort' && toggle !== 'enable-thinking') {
    throw new Error('MODEL_REASONING_TOGGLE — reasoning-effort, enable-thinking или пусто.');
  }
  return {
    baseUrl,
    model,
    apiKey: env.MODEL_API_KEY?.trim() ?? '',
    headers: headerRecord(headers),
    // A deck build does not think. Told how this model's thinking switches, the request says so;
    // left unknown, a model that thinks by default thinks through every slide and may time out.
    reasoning: toggle
      ? { toggle: toggle as 'reasoning-effort' | 'enable-thinking', levels: false }
      : NO_REASONING_CHOICE,
  };
}

/**
 * The indexer's notes on the template's compositions, as the web prepares a template. They are
 * kept next to the runs by template and indexer revision, so the next run on the same template
 * skips the preparation; a failed indexing leaves the planner without notes, never the deck.
 */
async function notesFor(options: {
  profile: GenerationProfile;
  provider: GenerationProvider;
  registryDir: string;
  cacheDir: string;
  log: (line: string) => void;
}): Promise<readonly CompositionNote[] | undefined> {
  const revision = await currentTemplateIndexRevision(options.registryDir);
  const path = join(options.cacheDir, `${options.profile.templateHash}.json`);
  if (existsSync(path)) {
    const cached = storedTemplateIndexSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
    if (cached.success && cached.data.revision === revision) return cached.data.notes;
  }
  options.log('Готовлю шаблон: описываю его макеты (один раз на шаблон)');
  try {
    const index = await indexTemplateWithAgent({
      provider: options.provider,
      registryDir: options.registryDir,
      profile: options.profile,
      signal: AbortSignal.timeout(600_000),
      onProgress: ({ described, total }) => {
        if (total > 0 && described === total) options.log(`  описано макетов: ${total}`);
      },
    });
    await mkdir(options.cacheDir, { recursive: true });
    await writeFile(path, JSON.stringify(index));
    return index.notes;
  } catch (error) {
    options.log(
      `  ! шаблон не описан, план строится без заметок: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

/** Errors and the rest from the deterministic audit a run wrote, or null without one. */
async function auditOf(dir: string) {
  try {
    const report = JSON.parse(await readFile(join(dir, 'audit-deterministic.json'), 'utf8')) as {
      findings?: { severity?: string }[];
    };
    const findings = report.findings ?? [];
    const errors = findings.filter((f) => f.severity === 'blocker' || f.severity === 'major');
    return { errors: errors.length, warnings: findings.length - errors.length };
  } catch {
    return null;
  }
}

/**
 * Builds the decks of a run config the way the web builds a deck: the template is prepared, one
 * plan is made for every variant, the variants are written in parallel and each is exported,
 * audited and rendered. The model connection comes from the environment (`.env`), the same
 * one the service uses, so a config run and a run from the interface are the same run.
 */
export async function generateFromConfig(options: GenerateOptions): Promise<GenerateResult> {
  const { config } = options;
  const env = options.env ?? process.env;
  const log = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const connection = connectionOf(env);
  const builtIn = join(repoRoot(), 'examples', 'layout-template.pptx');
  let templatePath = config.templatePath ? resolve(config.templatePath) : builtIn;
  const contentPath = resolve(config.contentPath);
  const brandbookPath = config.brandbookPath ? resolve(config.brandbookPath) : null;
  for (const [what, path] of [
    ['Шаблон', templatePath],
    ['Материал', contentPath],
    ['Брендбук', brandbookPath],
  ] as const) {
    if (path !== null && !existsSync(path)) throw new Error(`${what} не найден: ${path}`);
  }

  const registryDir = resolve(env.REGISTRY_DIR ?? 'registry/agents');
  const provider = new GenerationProvider({
    ...connection,
    ...(env.MODEL_PROTOCOL === 'anthropic'
      ? { fetchImpl: anthropicTransport(fetch, { thinking: false }) }
      : {}),
    seed: config.seed,
    answerFormat: await loadAnswerFormat(registryDir),
  });
  const engine = new EngineClient({
    baseUrl: env.ENGINE_URL ?? 'http://localhost:8000',
    timeoutMs: 180_000,
  });
  const brief = briefOf(config, await readMaterial(engine, contentPath));
  // The tables themselves go to the writer too, so a chart is built from cells, not retyped.
  const preparedDatasets = await datasetsOf(engine, contentPath);
  if (brief.length > 60_000) throw new Error('Материал длиннее 60 000 символов.');
  const outputDir = resolve(config.outputDir);
  const runId = `run-${new Date()
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14)}`;
  const runDir = join(outputDir, runId);
  await mkdir(runDir, { recursive: true });
  if (!config.templatePath) {
    // The engine reads the template from a path it shares with this run, not from the CLI's own
    // files: in Docker those sit in another container. The run keeps its copy of the layouts.
    templatePath = join(runDir, 'layout-template.pptx');
    await copyFile(builtIn, templatePath);
  }
  await writeFile(join(runDir, 'brief.md'), brief);
  const brandbook = brandbookPath
    ? await brandbookOf(engine, brandbookPath, runDir, config, log)
    : undefined;

  log(
    `${runId}: ${basename(templatePath)}, ${config.slideCount} слайдов, модель ${connection.model}`,
  );
  const profile = await engine.generationProfile(templatePath);
  const images = imagesOf(env, brandbook, log);
  const illustrations = images
    ? await SharedIllustrations.load(
        {
          images,
          text: provider,
          designSystem: profile.designSystem,
          seed: config.seed,
          signal: AbortSignal.timeout(600_000),
        },
        registryDir,
      )
    : null;
  const notes = await notesFor({
    profile,
    provider,
    registryDir,
    cacheDir: join(outputDir, '.template-index'),
    log,
  });

  // The five minutes start here: preparing the template is a stage of its own.
  const started = Date.now();
  const sharedPlan = new SharedPlan(undefined, (plan) =>
    writeFile(join(runDir, 'composition-plan.json'), JSON.stringify(plan, null, 2)),
  );
  const variants = await Promise.all(
    config.layoutVariants.map(async (variant): Promise<VariantOutcome> => {
      const dir = join(runDir, variant);
      await mkdir(dir, { recursive: true });
      const begun = Date.now();
      let stage = '';
      try {
        await generatePresentation({
          // As in the service: copy still too long after its rewrites is set smaller, and the
          // variant is kept with a review warning instead of lost.
          allowPartialExport: true,
          runId: `${runId}-${variant}`,
          templatePath,
          outputDir: dir,
          brief,
          slideCount: config.slideCount,
          profile,
          ...(brandbook ? { brandbook } : {}),
          ...(notes ? { notes } : {}),
          registryDir,
          engine,
          provider,
          seed: config.seed,
          variant,
          sharedPlan,
          illustrations,
          ...(preparedDatasets.length > 0 ? { preparedDatasets } : {}),
          onEvent: async (event) => {
            await appendFile(join(dir, 'events.jsonl'), `${JSON.stringify(event)}\n`);
            if (event.type === 'stage-started' && event.stage !== stage) {
              stage = event.stage;
              log(`  ${variant}: ${stage}`);
            }
          },
        });
        const files = ['deck.pptx', join('previews', 'deck.pdf')]
          .map((name) => join(dir, name))
          .filter((path) => existsSync(path));
        return {
          variant,
          state: 'done',
          ms: Date.now() - begun,
          dir,
          files,
          audit: await auditOf(dir),
        };
      } catch (error) {
        return {
          variant,
          state: 'failed',
          ms: Date.now() - begun,
          dir,
          files: [],
          audit: null,
          error: failureText(error),
        };
      }
    }),
  );
  const totalMs = Date.now() - started;

  for (const outcome of variants) {
    if (outcome.state === 'failed') {
      log(`  ${outcome.variant}: не собрался — ${outcome.error}`);
      continue;
    }
    const audit = outcome.audit
      ? `аудит: ошибок ${outcome.audit.errors}, замечаний ${outcome.audit.warnings}`
      : 'аудит недоступен';
    log(`  ${outcome.variant}: готов за ${(outcome.ms / 1000).toFixed(0)} с, ${audit}`);
    for (const file of outcome.files) log(`    ${file}`);
  }
  const built = variants.filter((outcome) => outcome.state === 'done').length;
  const budget = totalMs <= 300_000 ? 'в бюджете 5 минут' : 'ВНЕ бюджета 5 минут';
  log(`готово: ${built} из ${variants.length} за ${(totalMs / 1000).toFixed(0)} с, ${budget}`);
  const result: GenerateResult = { runId, runDir, totalMs, variants };
  await writeFile(join(runDir, 'summary.json'), JSON.stringify(result, null, 2));
  return result;
}
