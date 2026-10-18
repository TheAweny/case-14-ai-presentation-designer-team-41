import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generationRequestSchema, type DeckOutline } from '@lct/contracts';
import { canonicalPlanHash, readSavedOutlineFacts, readSavedPreview } from './deck-inspection.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const TEMPLATE = '00000000-0000-4000-8000-000000000010';

function outline(): DeckOutline {
  return {
    title: 'Approved story',
    audience: '',
    goal: '',
    slides: Array.from({ length: 10 }, (_, index) => ({
      title: index === 0 ? 'Claim' : `Slide ${index + 1}`,
      points: index === 0 ? ['Fact one'] : ['Point'],
      kind: 'other' as const,
    })),
  };
}

async function savedDeck() {
  const root = await mkdtemp(join(tmpdir(), 'inspection-saved-'));
  roots.push(root);
  const deckId = 'run-00000000-0000-4000-8000-0000000000aa';
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
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'previews/slide-01.png'), png);
  return { root, deckId, directory, plan, manifest };
}

async function writeRequest(
  directory: string,
  outlineSource: 'user' | 'model' | undefined,
  withOutline: boolean,
): Promise<void> {
  const request = generationRequestSchema.parse({
    templateId: TEMPLATE,
    brief: 'Approved brief for the saved deck.',
    outline: withOutline ? outline() : null,
    ...(outlineSource === undefined ? {} : { outlineSource }),
  });
  await writeFile(join(directory, 'request.json'), JSON.stringify(request));
}

describe('saved deck inspection provenance', () => {
  it('returns no facts when the outline is missing or came from the model', async () => {
    const missing = await savedDeck();
    await writeRequest(missing.directory, undefined, false);
    await expect(readSavedOutlineFacts({ ...missing, slideIndex: 1 })).resolves.toEqual([]);

    const model = await savedDeck();
    await writeRequest(model.directory, 'model', true);
    await expect(readSavedOutlineFacts({ ...model, slideIndex: 1 })).resolves.toEqual([]);

    const user = await savedDeck();
    await writeRequest(user.directory, 'user', true);
    await expect(readSavedOutlineFacts({ ...user, slideIndex: 1 })).resolves.toEqual([
      'Claim',
      'Fact one',
    ]);
  });

  it('rejects a manifest owned by another run', async () => {
    const ref = await savedDeck();
    await writeFile(
      join(ref.directory, 'manifest.json'),
      JSON.stringify({ ...ref.manifest, runId: 'other-run' }),
    );
    await expect(readSavedPreview({ ...ref, slideIndex: 1 })).rejects.toMatchObject({
      code: 'unknown_preview',
    });
  });

  it('rejects a preview whose slide is outside the saved plan', async () => {
    const ref = await savedDeck();
    await expect(readSavedPreview({ ...ref, slideIndex: 2 })).rejects.toMatchObject({
      code: 'slide_out_of_bounds',
    });
  });

  it('returns the saved preview when the manifest belongs to this deck', async () => {
    const ref = await savedDeck();
    const result = await readSavedPreview({ ...ref, slideIndex: 1 });
    expect(result).toMatchObject({
      fileName: 'slide-01.png',
      contentHash: canonicalPlanHash(ref.plan),
      contentRevision: 2,
      savedBuild: true,
      liveEditorDraft: false,
      visionAssessment: false,
    });
  });
});
