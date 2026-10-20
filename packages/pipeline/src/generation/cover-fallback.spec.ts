import { describe, expect, it } from 'vitest';
import type { GenerationProfile } from '@lct/contracts';
import {
  createGenerationWorkflow,
  geometricCovers,
  prepareVariantCatalog,
  SharedPlan,
  titleCovers,
} from './workflow.js';
import { generationProfileSchema } from '@lct/contracts';
import { readFileSync } from 'node:fs';

type Composition = GenerationProfile['compositions'][number];

const slot = (slotId: string, role: 'title' | 'body', maxChars: number, fontSize: number) => ({
  slotId,
  role,
  sample: role === 'title' ? 'Заголовок' : 'Содержание',
  font: 'Inter',
  fontSize,
  maxChars,
  maxLines: role === 'title' ? 2 : 10,
});
const pattern = (patternId: string, body: number[]) =>
  ({
    patternId,
    sourceIndex: 1,
    name: patternId,
    imageCount: 0,
    slots: [
      slot('title', 'title', 60, 40),
      ...body.map((chars, i) => slot(`b${i}`, 'body', chars, 16)),
    ],
  }) as unknown as Composition;

describe('geometricCovers', () => {
  it('does not automatically choose an indexed QR cover without a bound source URL', () => {
    const ordinary = pattern('ordinary', [100]);
    const qr = {
      ...pattern('qr-cover', [30]),
      qrCandidateSlots: [
        { slotId: 'qr', kind: 'photo' as const, box: { x: 0, y: 0, cx: 3_000_000, cy: 3_000_000 } },
      ],
    };
    const result = prepareVariantCatalog(
      { compositions: [qr, ordinary] },
      [
        {
          patternId: 'qr-cover',
          kind: 'cover',
          items: 1,
          title: 'QR',
          useFor: '',
          special: true,
          skip: false,
          requiredContent: [],
          qrSlotIds: ['qr'],
        },
      ],
      { imagesAvailable: false, variant: 'balanced' },
    );
    expect(result.covers.map((p) => p.patternId)).toEqual(['ordinary']);
    expect(result.full.map((p) => p.patternId)).toContain('qr-cover');
  });
  it('keeps a short cover when approved claims would have more room on a contents list', async () => {
    const cover = pattern('cover', [30]);
    const contents = pattern('contents', [300, 300, 300]);
    const profile = generationProfileSchema.parse(
      JSON.parse(
        readFileSync(
          new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
          'utf8',
        ),
      ).valid[0].payload,
    );
    let first = '';
    const workflow = createGenerationWorkflow({
      provider: {
        model: 'fake',
        async generate(_agent, _instructions, input, schema) {
          const task = input as { composition: Composition; index: number };
          if (task.index === 0) first = task.composition.patternId;
          return schema.parse({
            patternId: task.composition.patternId,
            speakerNotes: '',
            textsBySlot: Object.fromEntries(task.composition.slots.map((s) => [s.slotId, 'Пилот'])),
          });
        },
      },
      plannerInstructions: '',
      writerInstructions: '',
      signal: new AbortController().signal,
      sharedPlan: new SharedPlan({
        title: 'Пилот',
        audience: '',
        goal: '',
        slides: [cover, contents, contents, contents, contents].map((p) => ({
          patternId: p.patternId,
          purpose: 'Согласовать пилот для всей команды',
          imageQuery: '',
          sourceEvidence: {},
          requiredClaims: [
            {
              id: 'fact',
              text: 'Пилот рассчитан на три месяца работы и 30 операторов поддержки',
              source: {
                sourceId: 'brief',
                quote: 'Пилот рассчитан на три месяца работы и 30 операторов поддержки',
              },
            },
          ],
        })),
      }),
      notes: [cover, contents].map((p) => ({
        patternId: p.patternId,
        kind: p === cover ? 'cover' : 'list',
        items: 1,
        title: '',
        useFor: '',
        special: false,
        skip: false,
        requiredContent: [],
      })),
    });
    await (
      await workflow.createRun()
    ).start({
      inputData: {
        brief: 'Пилот рассчитан на три месяца работы и 30 операторов поддержки',
        slideCount: 5,
        profile: { ...profile, compositions: [cover, contents] },
      },
    });
    expect(first).toBe('cover');
  });
  it('takes a large-title layout without room for a chart over a content slide', () => {
    const content = pattern('content', [600]);
    const cover = pattern('cover', [60]);
    expect(geometricCovers([content, cover], [content, cover])).toEqual([cover]);
  });

  it('falls back to the first titled layout of the template when nothing qualifies', () => {
    const first = pattern('first', [600]);
    const second = pattern('second', [600, 600, 600]);
    expect(geometricCovers([second], [first, second])).toEqual([first]);
  });

  it('prefers a cover with a title and one line over a list of findings', () => {
    const list = pattern('list', [80, 80, 80]);
    const title = pattern('title', [80]);
    expect(titleCovers([list, title])).toEqual([title]);
    expect(titleCovers([list])).toEqual([list]);
  });
});
