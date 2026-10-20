import { describe, expect, it } from 'vitest';
import { compositionSchema, type RequiredSlideClaim } from '@lct/contracts';
import { ampleComposition, compositionContentBudget } from './composition-feasibility.js';

const claim = (text: string): RequiredSlideClaim => ({
  id: text,
  text,
  source: { sourceId: 'brief', quote: text },
});
const pattern = (id: string, title: number, body: number) =>
  compositionSchema.parse({
    patternId: id,
    sourceIndex: 0,
    name: id,
    imageCount: 0,
    slots: [
      {
        slotId: 'title',
        role: 'title',
        sample: '',
        maxChars: title,
        maxLines: 2,
        font: 'Arial',
        fontSize: 24,
      },
      {
        slotId: 'body',
        role: 'body',
        sample: '',
        maxChars: body,
        maxLines: 6,
        font: 'Arial',
        fontSize: 18,
      },
    ],
  });
const title = 'Результаты первого полугодия 2026 года';
const claims = [
  claim(title),
  claim('Выручка 75 млн руб.; расходы 61 млн руб.'),
  claim('Операционная прибыль 14 млн руб.'),
];

describe('pre-writing composition capacity', () => {
  it('replaces a section slide with a compatible layout that holds title and facts', () => {
    const selected = pattern('section', 17, 15);
    const ample = pattern('content', 60, 160);
    const incompatible = pattern('wrong-kind', 60, 150);
    expect(
      ampleComposition({
        selected,
        candidates: [incompatible, ample],
        title,
        claims,
        writableSlots: (p) => p.slots,
        compatible: (p) => p !== incompatible,
      }),
    ).toBe(ample);
  });
  it('allows title detail to move into body without losing its information budget', () => {
    const selected = pattern('short-heading', 24, 160);
    expect(compositionContentBudget(selected.slots, title, claims).sufficient).toBe(true);
    expect(compositionContentBudget(selected.slots, title, claims).bodyRequired).toBeGreaterThan(
      claims
        .slice(1)
        .map((c) => c.text)
        .join('\n').length,
    );
  });
  it('keeps an already sufficient selection and does not count duplicate title claims', () => {
    const selected = pattern('chosen', 60, 160);
    expect(
      compositionContentBudget(selected.slots, title, [...claims, claim(title)]).bodyRequired,
    ).toBe(
      claims
        .slice(1)
        .map((c) => c.text)
        .join('\n').length,
    );
    expect(
      ampleComposition({
        selected,
        candidates: [pattern('other', 80, 200)],
        title,
        claims,
        writableSlots: (p) => p.slots,
        compatible: () => true,
      }),
    ).toBe(selected);
  });
  it('does not treat code-owned date slots as available content room', () => {
    const selected = pattern('small', 20, 500);
    expect(
      ampleComposition({
        selected,
        candidates: [selected],
        title,
        claims,
        writableSlots: (p) => p.slots.filter((s) => s.role === 'title'),
        compatible: () => true,
      }),
    ).toBeUndefined();
  });
  it('respects measured safe capacity instead of nominal sample length', () => {
    const selected = pattern('obstacle', 60, 200);
    const body = selected.slots.find((slot) => slot.role === 'body');
    if (!body) throw new Error('Missing fixture body');
    body.capacity = { safeChars: 10, basis: 'obstacle-aware' };
    expect(compositionContentBudget(selected.slots, title, claims).sufficient).toBe(false);
  });
  it('uses adequate nearby density choices without selecting a huge outlier', () => {
    const selected = pattern('tiny', 18, 10);
    const small = pattern('small', 40, 120);
    const middle = pattern('middle', 40, 180);
    const large = pattern('large', 40, 240);
    const huge = pattern('huge', 40, 5000);
    const choose = (variant: 'dense' | 'balanced' | 'airy') =>
      ampleComposition({
        selected,
        candidates: [huge, large, small, middle],
        title,
        claims,
        variant,
        writableSlots: (p) => p.slots,
        compatible: () => true,
      });
    expect(choose('airy')).toBe(small);
    expect(choose('balanced')).toBe(middle);
    expect(choose('dense')).toBe(large);
  });
});
