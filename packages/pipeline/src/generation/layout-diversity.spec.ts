import { describe, expect, it } from 'vitest';
import type { GenerationProfile } from '@lct/contracts';
import { acceptVariantLayouts, assessLayoutDiversity } from './layout-diversity.js';

function pattern(
  patternId: string,
  body: { x: number; y: number; cx: number; cy: number },
): GenerationProfile['compositions'][number] {
  return {
    patternId,
    sourceIndex: 0,
    name: 'layout',
    imageCount: 0,
    slots: [
      {
        slotId: `${patternId}-title`,
        role: 'title',
        sample: 'Заголовок',
        maxChars: 40,
        maxLines: 1,
        font: 'DejaVu Sans',
        fontSize: 32,
        box: { x: 100, y: 40, cx: 800, cy: 80 },
      },
      {
        slotId: `${patternId}-body`,
        role: 'body',
        sample: 'Текст',
        maxChars: 200,
        maxLines: 6,
        font: 'DejaVu Sans',
        fontSize: 16,
        box: body,
      },
    ],
  };
}

function profile(compositions: GenerationProfile['compositions']): GenerationProfile {
  return {
    schemaVersion: 1,
    templateHash: 'ab'.repeat(32),
    designSystem: {} as GenerationProfile['designSystem'],
    compositions,
  };
}

describe('layout diversity', () => {
  it('names the limit before any model call when the template has one composition', () => {
    const one = assessLayoutDiversity(
      profile([pattern('only', { x: 0, y: 200, cx: 400, cy: 200 })]),
    );
    expect(one.independent).toBe(false);
    expect(one.distinctStructures).toBe(1);
    expect(one.limitation).toMatch(/одну композицию/);
    const two = assessLayoutDiversity(
      profile([
        pattern('a', { x: 0, y: 200, cx: 400, cy: 200 }),
        pattern('b', { x: 500, y: 200, cx: 200, cy: 400 }),
      ]),
    );
    expect(two.independent).toBe(false);
    expect(two.distinctStructures).toBe(2);
  });

  it('accepts three different placements and rejects three copies of one sequence', () => {
    const ready = profile([
      pattern('dense', { x: 0, y: 180, cx: 900, cy: 120 }),
      pattern('balanced', { x: 0, y: 220, cx: 500, cy: 280 }),
      pattern('airy', { x: 200, y: 300, cx: 300, cy: 180 }),
    ]);
    expect(assessLayoutDiversity(ready).independent).toBe(true);
    expect(assessLayoutDiversity(ready).limitation).toBeNull();
    const distinct = acceptVariantLayouts(
      [
        { patternIds: ['dense', 'dense'] },
        { patternIds: ['balanced', 'airy'] },
        { patternIds: ['airy', 'balanced'] },
      ],
      ready,
    );
    expect(distinct.accepted).toBe(true);
    expect(distinct.distinctSequences).toBe(3);
    const copies = acceptVariantLayouts(
      [
        { patternIds: ['balanced', 'balanced'] },
        { patternIds: ['balanced', 'balanced'] },
        { patternIds: ['balanced', 'balanced'] },
      ],
      ready,
    );
    expect(copies.accepted).toBe(false);
    expect(copies.distinctSequences).toBe(1);
  });
});
