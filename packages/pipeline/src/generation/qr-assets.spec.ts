import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generationProfileSchema,
  compositionPlanSchema,
  type CompositionNote,
} from '@lct/contracts';
import { declaredQrSlots, safeQrPlan, saveQrAssets, sourceQrUrls } from './qr-assets.js';

const base = generationProfileSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
      'utf8',
    ),
  ).valid[0].payload,
).compositions[0];
if (!base) throw new Error('Missing fixture composition.');
const qr = {
  ...base,
  patternId: 'qr',
  qrCandidateSlots: [
    { slotId: '3', kind: 'photo' as const, box: { x: 0, y: 0, cx: 5_000_000, cy: 5_000_000 } },
  ],
};
const plain = { ...base, patternId: 'plain' };
const note: CompositionNote = {
  patternId: 'qr',
  kind: 'statement',
  items: 1,
  title: 'QR',
  useFor: 'QR',
  skip: false,
  special: true,
  qrSlotIds: ['3'],
  requiredContent: [],
};
const notes = new Map([['qr', note]]);
const url = 'https://example.test/путь?sig=(x)&k=2;';
const plan = (requests: { slotId: string; url: string }[] = [{ slotId: '3', url }]) =>
  compositionPlanSchema.parse({
    title: 'Deck',
    slides: Array.from({ length: 10 }, () => ({
      patternId: 'qr',
      purpose: 'Exact source facts',
      qrRequests: requests,
    })),
  });
const signal = () => AbortSignal.timeout(20_000);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe('source QR assets', () => {
  it.each([
    'https://example.test/a?sig=(x)&k=2',
    'https://example.test/a?sig=x;',
    'https://example.test/a?sig=x!',
    'https://example.test/a?sig=x,',
  ])('keeps the whole source token %s', (exact) => {
    expect(sourceQrUrls(`Use ${exact}`)).toEqual([exact]);
  });

  it('reads decoded JSON Unicode leaves, including user-approved source, excluding assistant drafts', () => {
    const brief = JSON.stringify({
      brief: JSON.stringify({ text: url }),
      approvedOutline: { slides: [{ title: 'https://approved.test' }] },
      messages: [
        { role: 'assistant', content: 'https://invented.test' },
        { role: 'user', content: 'https://user.test' },
      ],
      proposedOutline: { title: 'https://model.test' },
      modelUrl: 'https://literal-source.test',
    }).replace('путь', '\\u043f\\u0443\\u0442\\u044c');
    expect(sourceQrUrls(brief)).toEqual([
      url,
      'https://approved.test',
      'https://user.test',
      'https://literal-source.test',
    ]);
    expect(
      sourceQrUrls(
        'https:example.test https://user:password@example.test https://example.test/\ud800',
      ),
    ).toEqual([]);
  });

  it.each([
    'https://example.test/путь',
    'https://example.test/путь?sig=',
    'https://example.test',
    'https://evil.test/путь?sig=(x)&k=2;',
  ])('rejects invented or partial URL %s before writing', async (invented) => {
    const result = await safeQrPlan(
      plan([{ slotId: '3', url: invented }]),
      [qr, plain],
      notes,
      `Use ${url}`,
      false,
      signal(),
    );
    expect(
      result.slides.every(
        (s) =>
          s.patternId === 'plain' && !s.qrRequests?.length && s.purpose === 'Exact source facts',
      ),
    ).toBe(true);
  });

  it('validates actual candidate ids and falls back for absent URLs, unknown slots and small slots', async () => {
    expect(declaredQrSlots(qr, { ...note, qrSlotIds: ['3', '3', 'missing'] })).toEqual(['3']);
    for (const [candidate, requests, brief] of [
      [qr, [], url],
      [qr, [{ slotId: 'unknown', url }], url],
      [qr, [{ slotId: '3', url }], 'No address'],
      [
        {
          ...qr,
          qrCandidateSlots: qr.qrCandidateSlots.map((s) => ({ ...s, box: { ...s.box, cx: 1000 } })),
        },
        [{ slotId: '3', url }],
        url,
      ],
    ] as const) {
      const result = await safeQrPlan(
        plan([...requests]),
        [candidate, plain],
        notes,
        brief,
        false,
        signal(),
      );
      expect(result.slides[0]?.patternId).toBe('plain');
    }
    await expect(safeQrPlan(plan([]), [qr], notes, url, false, signal())).rejects.toThrow(
      'Cannot safely replace QR',
    );
  });

  it('keeps content slides away from framing layouts and avoids required speaker fields', async () => {
    const cover = { ...plain, patternId: 'cover' };
    const speaker = { ...plain, patternId: 'speaker' };
    const localNotes = new Map([
      ...notes,
      [
        'cover',
        { ...note, patternId: 'cover', kind: 'cover' as const, special: false, qrSlotIds: [] },
      ],
      [
        'speaker',
        {
          ...note,
          patternId: 'speaker',
          special: false,
          qrSlotIds: [],
          requiredContent: ['person-name' as const],
        },
      ],
    ]);
    expect(
      (await safeQrPlan(plan([]), [qr, cover, speaker, plain], localNotes, '', false, signal()))
        .slides[0]?.patternId,
    ).toBe('plain');
    await expect(
      safeQrPlan(plan([]), [qr, cover, speaker], localNotes, '', false, signal()),
    ).rejects.toThrow('Cannot safely replace QR');
  });

  it('saves deterministic PNG assets and audit metadata with contain purpose', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'qr-assets-'));
    directories.push(outputDir);
    const result = await saveQrAssets(
      outputDir,
      [{ index: 0, composition: qr, qrRequests: [{ slotId: '3', url }] }],
      notes,
      JSON.stringify({ text: url }),
      signal(),
    );
    expect(result.images.get(0)).toEqual([
      { slotId: '3', path: result.manifest[0]?.path, fit: 'contain', purpose: 'qr' },
    ]);
    expect(result.manifest[0]).toMatchObject({ encodedUrl: url, quietZoneModules: 4, slotId: '3' });
    const firstAsset = result.manifest[0];
    if (!firstAsset) throw new Error('Missing QR asset.');
    expect((await readFile(join(outputDir, firstAsset.path))).subarray(0, 8).toString('hex')).toBe(
      '89504e470d0a1a0a',
    );
    expect(JSON.parse(await readFile(join(outputDir, 'qr-assets.json'), 'utf8'))).toEqual(
      result.manifest,
    );
    const aborted = AbortSignal.abort(new Error('QR cancelled'));
    await expect(saveQrAssets(outputDir, [], notes, url, aborted)).rejects.toThrow('QR cancelled');
    await expect(safeQrPlan(plan(), [qr, plain], notes, url, false, aborted)).rejects.toThrow(
      'QR cancelled',
    );
  });
});
