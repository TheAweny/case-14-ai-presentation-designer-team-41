import { describe, expect, it } from 'vitest';
import type { ComposedSlide, RequiredSlideClaim } from '@lct/contracts';
import { selectSlideRepair } from './repair-selection.js';

const previous: ComposedSlide = {
  patternId: 'template',
  speakerNotes: 'Keep notes',
  visual: null,
  texts: [
    { slotId: 'title', text: 'Результаты 2026 года: рост 18 %' },
    { slotId: 'body', text: 'Только при предоплате; без гарантий' },
    { slotId: 'footer', text: 'Original footer' },
  ],
};
const claims: RequiredSlideClaim[] = [
  {
    id: 'c',
    text: 'В 2026 году рост 18 % только при предоплате, без гарантий',
    source: { sourceId: 'brief', quote: 'Exact original claim' },
  },
];
const slots = [
  { slotId: 'title', fitChars: 20 },
  { slotId: 'body', fitChars: 90 },
];
const best = (slot: (typeof slots)[number], candidates: readonly string[]) =>
  candidates
    .filter((text) => text.length <= slot.fitChars && !text.includes('\n'))
    .sort((a, b) => b.length - a.length)[0];

describe('atomic coordinated slide repair', () => {
  it('moves year and measurement from the title to the body without rejecting the title alone', () => {
    const result = selectSlideRepair({
      previous,
      slots,
      requiredClaims: claims,
      bestFittingAlternative: best,
      rewrites: {
        title: ['Итоги', 'Итоги', 'Итоги'],
        body: [
          '2026 год: рост 18 % только при предоплате, без гарантий',
          'Нет измерений',
          'Нет измерений',
        ],
      },
    });
    expect(result.texts.find((binding) => binding.slotId === 'title')?.text).toBe('Итоги');
    expect(result.texts.find((binding) => binding.slotId === 'body')?.text).toContain('2026');
    expect(result.texts[2]).toEqual(previous.texts[2]);
    expect(previous.texts[0]?.text).toContain('2026');
    expect(result.speakerNotes).toBe(previous.speakerNotes);
  });
  it('rejects every edit atomically when a coordinated destination overflows or loses details', () => {
    const result = selectSlideRepair({
      previous,
      slots,
      requiredClaims: claims,
      bestFittingAlternative: best,
      rewrites: {
        title: ['Итоги', 'Итоги', 'Итоги'],
        body: [
          '2026 год: рост 18 % только при предоплате, без гарантий'.repeat(5),
          'Рост',
          'Нет данных',
        ],
      },
    });
    expect(result).toBe(previous);
  });
  it('tries an independent fitting selection when aligned alternatives cannot all fit', () => {
    const result = selectSlideRepair({
      previous,
      slots,
      requiredClaims: claims,
      bestFittingAlternative: best,
      rewrites: {
        title: ['Итоги', 'Слишком длинный заголовок'.repeat(5), 'Длинный заголовок'.repeat(5)],
        body: [
          'Слишком длинная строка'.repeat(10),
          '2026 год: рост 18 % только при предоплате, без гарантий',
          'Слишком длинная строка'.repeat(10),
        ],
      },
    });
    expect(result).not.toBe(previous);
    expect(result.texts[0]?.text).toBe('Итоги');
    expect(result.texts[1]?.text).toContain('18 %');
  });
  it('keeps a slot with no fitting alternatives while accepting a safe independent improvement', () => {
    const result = selectSlideRepair({
      previous,
      slots,
      requiredClaims: claims,
      bestFittingAlternative: best,
      rewrites: {
        title: Array.from({ length: 3 }, () => 'Не помещается'.repeat(10)),
        body: [
          'Только при предоплате, без гарантий',
          'Только при предоплате, без гарантий',
          'Только при предоплате, без гарантий',
        ],
      },
    });
    expect(result.texts[0]).toEqual(previous.texts[0]);
    expect(result.texts[1]?.text).toBe('Только при предоплате, без гарантий');
    expect(result.texts[0]?.text).toContain('18 %');
    expect(previous.texts[1]?.text).toBe('Только при предоплате; без гарантий');
  });
  it('rejects independent partial edits that lose a detail without a fitting destination', () => {
    expect(
      selectSlideRepair({
        previous,
        slots,
        requiredClaims: claims,
        bestFittingAlternative: best,
        rewrites: { title: ['Итоги'] },
      }),
    ).toBe(previous);
  });
});
