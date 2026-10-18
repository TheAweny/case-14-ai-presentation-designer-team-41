import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compositionPlanSchema,
  generationProfileSchema,
  storedTemplateIndexSchema,
} from '@lct/contracts';
import {
  compareLayoutRemap,
  type LayoutRemapComparison,
} from '../packages/pipeline/src/generation/remap-evaluation.ts';

interface Arguments {
  plan: string;
  profile: string;
  index?: string;
  output?: string;
  imagesAvailable: boolean;
}

const FLAGS = new Set(['plan', 'profile', 'index', 'output', 'images-available']);

export function argumentsOf(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!name?.startsWith('--')) throw new Error('Unexpected argument ' + String(name) + '.');
    const flag = name.slice(2);
    if (!FLAGS.has(flag)) throw new Error('Unknown option --' + flag + '.');
    if (values.has(flag)) throw new Error('Duplicate option --' + flag + '.');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for ' + name + '.');
    values.set(flag, value);
    index += 1;
  }
  const plan = values.get('plan');
  const profile = values.get('profile');
  if (!plan || !profile) throw new Error('Pass --plan and --profile.');
  const images = values.get('images-available') ?? 'false';
  if (images !== 'true' && images !== 'false') {
    throw new Error('--images-available must be true or false.');
  }
  const index = values.get('index');
  const output = values.get('output');
  const outputPath = output ? resolve(output) : undefined;
  const inputs = [plan, profile, index]
    .filter((path): path is string => path !== undefined)
    .map((path) => resolve(path));
  if (outputPath && inputs.some((path) => path.toLowerCase() === outputPath.toLowerCase())) {
    throw new Error('--output must not overwrite --plan, --profile, or --index.');
  }
  return {
    plan,
    profile,
    ...(index ? { index } : {}),
    ...(output ? { output } : {}),
    imagesAvailable: images === 'true',
  };
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as unknown;
}

export function layoutRemapReport(
  result: LayoutRemapComparison,
  source: { plan: string; profile: string; index?: string; imagesAvailable: boolean },
) {
  return {
    ...result,
    imagesAvailable: source.imagesAvailable,
    inputs: {
      plan: resolve(source.plan),
      profile: resolve(source.profile),
      ...(source.index ? { index: resolve(source.index) } : {}),
    },
    templateHash: result.templateHash,
    slideCount: result.slideCount,
    note: 'Structural layout comparison only. This does not score deck quality or runtime.',
  };
}

export async function compareLayoutRemapFiles(argv: readonly string[]) {
  const args = argumentsOf(argv);
  const plan = compositionPlanSchema.parse(await readJson(args.plan));
  const profile = generationProfileSchema.parse(await readJson(args.profile));
  const index = args.index
    ? storedTemplateIndexSchema.parse(await readJson(args.index))
    : undefined;
  const result = compareLayoutRemap({
    plan,
    profile,
    ...(index ? { index } : {}),
    imagesAvailable: args.imagesAvailable,
  });
  const report = layoutRemapReport(result, args);
  if (args.output) await writeFile(resolve(args.output), JSON.stringify(report, null, 2));
  return report;
}

const entry = process.argv[1];
const calledDirectly = entry !== undefined && import.meta.url === pathToFileURL(entry).href;
if (calledDirectly) {
  compareLayoutRemapFiles(process.argv.slice(2))
    .then((result) => {
      process.stdout.write(JSON.stringify(result, null, 2) + String.fromCharCode(10));
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(message + String.fromCharCode(10));
      process.exitCode = 1;
    });
}
