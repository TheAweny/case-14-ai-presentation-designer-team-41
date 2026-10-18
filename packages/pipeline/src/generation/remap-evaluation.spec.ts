import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  generationProfileSchema,
  compositionPlanSchema,
  type CompositionNote,
} from '@lct/contracts';
import { compareLayoutRemap, LayoutRemapComparisonError } from './remap-evaluation.js';

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

function plan(patternIds: readonly string[]) {
  return compositionPlanSchema.parse({
    title: 'Saved',
    audience: '',
    goal: '',
    slides: Array.from({ length: 12 }, (_, index) => ({
      patternId: patternIds[index] ?? patternIds[patternIds.length - 1],
      purpose: 'Point ' + (index + 1),
      imageQuery: '',
    })),
  });
}

describe('saved layout remap comparison', () => {
  const compositions = [
    pattern('cover', [], 44),
    pattern('two', [150, 150]),
    pattern('three', [300, 300, 300]),
    pattern('four', [300, 300, 300, 300]),
    pattern('five', [300, 300, 300, 300, 300]),
    pattern('six', [300, 300, 300, 300, 300, 300]),
    pattern('one', [800]),
  ];
  const profile = generationProfileSchema.parse({
    ...base,
    templateHash: 'a'.repeat(64),
    compositions,
  });
  const index = {
    templateHash: profile.templateHash,
    revision: 'test',
    notes: [
      note('cover', 'cover'),
      note('two', 'cards'),
      note('three', 'cards'),
      note('four', 'cards'),
      note('five', 'cards'),
      note('six', 'cards'),
      note('one', 'cards'),
    ],
  };
  const saved = plan(['cover', ...Array<string>(11).fill('two')]);

  it('changes eleven dense block counts and leaves strict and balanced plans intact', () => {
    const result = compareLayoutRemap({ plan: saved, profile, index, imagesAvailable: false });
    const dense = result.variants.filter((item) => item.variant === 'dense');
    const baseline = dense.find((item) => item.policy === 'density');
    const strict = dense.find((item) => item.policy === 'preserve-block-count');
    const planned = saved.slides.map((slide) => slide.patternId);
    expect(baseline?.changedSlides).toBe(11);
    expect(baseline?.blockCountChanges).toBe(11);
    expect(baseline?.capacityChanges).toBe(11);
    expect(baseline?.distinctPatternIds).toBe(3);
    expect(strict?.changedSlides).toBe(0);
    expect(strict?.blockCountChanges).toBe(0);
    expect(strict?.distinctPatternIds).toBe(2);
    expect(strict?.patternIds).toEqual(planned);
    expect(
      result.variants.filter((item) => item.variant === 'balanced').map((item) => item.patternIds),
    ).toEqual([planned, planned]);
  });

  it('changes eleven airy block counts when the planned pair is too roomy for that catalog', () => {
    const airyCompositions = [
      pattern('cover', [], 44),
      pattern('wide', [800, 800]),
      pattern('peak', [900, 900, 900, 900]),
      pattern('near-one', [1200]),
      pattern('near-three', [400, 400, 400]),
      pattern('small', [200]),
    ];
    const airyProfile = generationProfileSchema.parse({
      ...base,
      templateHash: 'c'.repeat(64),
      compositions: airyCompositions,
    });
    const airyIndex = {
      templateHash: airyProfile.templateHash,
      revision: 'test',
      notes: airyCompositions.map((item) =>
        note(item.patternId, item.patternId === 'cover' ? 'cover' : 'cards'),
      ),
    };
    const airyPlan = plan(['cover', ...Array<string>(11).fill('wide')]);
    const result = compareLayoutRemap({
      plan: airyPlan,
      profile: airyProfile,
      index: airyIndex,
      imagesAvailable: false,
    });
    const airy = result.variants.filter((item) => item.variant === 'airy');
    const baseline = airy.find((item) => item.policy === 'density');
    const strict = airy.find((item) => item.policy === 'preserve-block-count');
    const planned = airyPlan.slides.map((slide) => slide.patternId);
    expect(baseline?.changedSlides).toBe(11);
    expect(baseline?.blockCountChanges).toBe(11);
    expect(baseline?.capacityChanges).toBe(11);
    expect(baseline?.distinctPatternIds).toBe(3);
    expect(strict?.blockCountChanges).toBe(0);
    expect(strict?.changedSlides).toBe(0);
    expect(strict?.patternIds).toEqual(planned);
    expect(
      result.variants.filter((item) => item.variant === 'balanced').map((item) => item.patternIds),
    ).toEqual([planned, planned]);
  });

  it('leaves the plan, profile, and index unchanged', () => {
    const before = JSON.stringify({ plan: saved, profile, index });
    compareLayoutRemap({ plan: saved, profile, index, imagesAvailable: false });
    expect(JSON.stringify({ plan: saved, profile, index })).toBe(before);
  });

  it('rejects a pattern id that is not in the template profile', () => {
    expect(() =>
      compareLayoutRemap({
        plan: plan(['cover', 'missing']),
        profile,
        index,
      }),
    ).toThrow(/not in this template profile/i);
  });

  it('rejects a composition that still needs a missing asset', () => {
    const branded = generationProfileSchema.parse({
      ...profile,
      compositions: [...compositions, pattern('logo', [400])],
    });
    expect(() =>
      compareLayoutRemap({
        plan: plan(['cover', 'logo']),
        profile: branded,
        index: {
          ...index,
          notes: [...index.notes, { ...note('logo', 'cards'), requiredContent: ['brand-asset'] }],
        },
        imagesAvailable: false,
      }),
    ).toThrow(/drops/i);
  });

  it('rejects a plan whose pattern the generation catalog drops', () => {
    const pictured = pattern('photo', [400]);
    const dropped = generationProfileSchema.parse({
      ...profile,
      compositions: [
        ...compositions,
        {
          ...pictured,
          imageSlots: [
            { slotId: 'p', kind: 'panel' as const, box: { x: 0, y: 0, cx: 10, cy: 10 } },
          ],
        },
      ],
    });
    expect(() =>
      compareLayoutRemap({
        plan: plan(['cover', 'photo', ...Array<string>(10).fill('one')]),
        profile: dropped,
        index,
        imagesAvailable: false,
      }),
    ).toThrow(LayoutRemapComparisonError);
  });

  it('rejects a mismatched template hash and a repeated pattern id', () => {
    expect(() =>
      compareLayoutRemap({
        plan: saved,
        profile,
        index: { ...index, templateHash: 'b'.repeat(64) },
      }),
    ).toThrow(/hash/i);
    expect(() =>
      compareLayoutRemap({
        plan: saved,
        profile: generationProfileSchema.parse({
          ...profile,
          compositions: [...compositions, pattern('one', [900])],
        }),
        index,
      }),
    ).toThrow(/repeats pattern ids/i);
  });
});
