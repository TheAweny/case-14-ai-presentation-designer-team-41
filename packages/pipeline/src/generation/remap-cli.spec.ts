import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generationProfileSchema,
  compositionPlanSchema,
  type CompositionNote,
} from '@lct/contracts';
import { readFileSync } from 'node:fs';

import type { LayoutRemapComparison } from './remap-evaluation.js';

type CliReport = LayoutRemapComparison & {
  imagesAvailable: boolean;
  inputs: { plan: string; profile: string; index?: string };
  note: string;
};

const { argumentsOf, compareLayoutRemapFiles } = (await import(
  pathToFileURL(join(process.cwd(), '../../scripts/compare-layout-remap.mts')).href
)) as {
  argumentsOf: (argv: readonly string[]) => {
    plan: string;
    profile: string;
    index?: string;
    output?: string;
    imagesAvailable: boolean;
  };
  compareLayoutRemapFiles: (argv: readonly string[]) => Promise<CliReport>;
};

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
);
const base = generationProfileSchema.parse(fixture.valid[0].payload);

function pattern(patternId: string, bodies: number[], fontSize = 24) {
  return {
    patternId,
    sourceIndex: 0,
    name: patternId,
    imageCount: 0,
    slots: [
      {
        slotId: 't',
        role: 'title' as const,
        sample: '',
        maxChars: 40,
        maxLines: 1,
        font: 'A',
        fontSize,
      },
      ...bodies.map((maxChars, index) => ({
        slotId: 'b' + index,
        role: 'body' as const,
        sample: '',
        maxChars,
        maxLines: 4,
        font: 'A',
        fontSize: 16,
      })),
    ],
  };
}

function note(patternId: string, kind: CompositionNote['kind']): CompositionNote {
  return {
    patternId,
    kind,
    items: 1,
    useFor: kind,
    title: patternId,
    skip: false,
    special: false,
    requiredContent: [],
  };
}

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function savedPlanFiles() {
  const profile = generationProfileSchema.parse({
    ...base,
    templateHash: 'c'.repeat(64),
    compositions: [
      pattern('cover', [], 44),
      pattern('two', [150, 150]),
      pattern('one', [800]),
      pattern('three', [900, 900, 900]),
      pattern('four', [1200, 1200, 1200, 1200]),
      pattern('five', [1500, 1500, 1500, 1500, 1500]),
      pattern('six', [1800, 1800, 1800, 1800, 1800, 1800]),
    ],
  });
  const index = {
    templateHash: profile.templateHash,
    revision: 'test',
    notes: ['cover', 'two', 'one', 'three', 'four', 'five', 'six'].map((id) =>
      note(id, id === 'cover' ? 'cover' : id === 'two' || id === 'three' ? 'cards' : 'statement'),
    ),
  };
  const plan = compositionPlanSchema.parse({
    title: 'Saved',
    slides: Array.from({ length: 12 }, (_, slide) => ({
      patternId: slide === 0 ? 'cover' : 'two',
      purpose: 'Point ' + (slide + 1),
      imageQuery: '',
    })),
  });
  const dir = await mkdtemp(join(tmpdir(), 'layout-remap-'));
  directories.push(dir);
  const files = {
    plan: join(dir, 'plan.json'),
    profile: join(dir, 'profile.json'),
    index: join(dir, 'index.json'),
    output: join(dir, 'out.json'),
  };
  await writeFile(files.plan, JSON.stringify(plan));
  await writeFile(files.profile, JSON.stringify(profile));
  await writeFile(files.index, JSON.stringify(index));
  return files;
}

describe('compare-layout-remap CLI', () => {
  it('prints the structural comparison for a saved plan', async () => {
    const files = await savedPlanFiles();
    const result = await compareLayoutRemapFiles([
      '--plan',
      files.plan,
      '--profile',
      files.profile,
      '--index',
      files.index,
      '--images-available',
      'false',
      '--output',
      files.output,
    ]);
    const dense = result.variants.find(
      (item) => item.variant === 'dense' && item.policy === 'density',
    );
    const strict = result.variants.find(
      (item) => item.variant === 'dense' && item.policy === 'preserve-block-count',
    );
    expect(dense?.blockCountChanges).toBe(0);
    expect(strict?.blockCountChanges).toBe(0);
    const written = JSON.parse(await readFile(files.output, 'utf8')) as typeof result;
    expect(
      written.variants.find((item) => item.variant === 'dense' && item.policy === 'density')
        ?.blockCountChanges,
    ).toBe(0);
    expect(
      written.variants.find(
        (item) => item.variant === 'dense' && item.policy === 'preserve-block-count',
      )?.blockCountChanges,
    ).toBe(0);
  });

  it('rejects an unknown flag, a duplicate flag, a missing value and an overwrite of an input', async () => {
    const files = await savedPlanFiles();
    const marker = 'do-not-overwrite';
    await writeFile(files.plan, marker, 'utf8');
    expect(() => argumentsOf(['--unknown', 'x'])).toThrow(/Unknown option --unknown/);
    expect(() =>
      argumentsOf(['--plan', files.plan, '--plan', files.plan, '--profile', files.profile]),
    ).toThrow(/Duplicate option --plan/);
    expect(() => argumentsOf(['--plan'])).toThrow(/Missing value for --plan/);
    expect(() =>
      argumentsOf(['--plan', files.plan, '--profile', files.profile, '--output', files.plan]),
    ).toThrow(/overwrite/);
    expect(await readFile(files.plan, 'utf8')).toBe(marker);
  });
});
