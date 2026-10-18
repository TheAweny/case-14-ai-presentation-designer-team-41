import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalPlanHash, readSavedPreview, readSavedSlide } from './deck-inspection.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'inspection-acceptance-'));
  roots.push(root);
  const deckId = 'run-00000000-0000-4000-8000-000000000001';
  const directory = join(root, deckId);
  await mkdir(join(directory, 'previews'), { recursive: true });
  const slide = {
    patternId: 'layout',
    texts: [{ slotId: 'body', text: 'Current visible text' }],
    speakerNotes: '',
  };
  const plan = [{ index: 0, title: 'Slide', purpose: '', imageQuery: '', slide }];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const manifestFixtures = JSON.parse(
    await readFile(
      join(import.meta.dirname, '../../../../packages/contracts/fixtures/ArtifactManifest.json'),
      'utf8',
    ),
  ) as { valid: Array<{ payload: Record<string, unknown> }> };
  const payload = manifestFixtures.valid[0]?.payload;
  if (!payload) throw new Error('Missing manifest fixture');
  const manifest = {
    ...payload,
    runId: deckId,
    contentHash: canonicalPlanHash(plan),
    contentRevision: 2,
    artifacts: [
      {
        kind: 'preview',
        variant: 'balanced',
        path: 'previews/slide-01.png',
        bytes: png.length,
        sha256: createHash('sha256').update(png).digest('hex'),
      },
    ],
  };
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan, null, 2));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'previews/slide-01.png'), png);
  return { root, deckId, directory, plan };
}

describe('independent saved preview revision acceptance', () => {
  it('binds a padded PNG to the saved plan and explicitly excludes a live draft assessment', async () => {
    const ref = await fixture();
    const result = await readSavedPreview({ ...ref, slideIndex: 1 });
    expect(result).toMatchObject({
      contentHash: canonicalPlanHash(ref.plan),
      contentRevision: 2,
      savedBuild: true,
      liveEditorDraft: false,
      visionAssessment: false,
    });
    expect(result.url).toContain(`/generation/${ref.deckId}/artifacts/slide-`);
    expect(await readSavedSlide({ ...ref, slideIndex: 1 })).toEqual(ref.plan[0]?.slide);
    await expect(readSavedSlide({ ...ref, slideIndex: 2 })).rejects.toMatchObject({
      code: 'slide_out_of_bounds',
    });
  });

  it('rejects an old PNG after the plan changes and an altered PNG after the manifest was written', async () => {
    const first = await fixture();
    await writeFile(
      join(first.directory, 'plan.json'),
      JSON.stringify([{ ...first.plan[0], title: 'Changed' }]),
    );
    await expect(readSavedPreview({ ...first, slideIndex: 1 })).rejects.toMatchObject({
      code: 'stale_preview',
    });
    const second = await fixture();
    await writeFile(join(second.directory, 'previews/slide-01.png'), Buffer.from('changed bytes'));
    await expect(readSavedPreview({ ...second, slideIndex: 1 })).rejects.toMatchObject({
      code: 'stale_preview',
    });
  });
});
