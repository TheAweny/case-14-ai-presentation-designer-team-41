import { describe, expect, it } from 'vitest';
import type { DeckOutline } from '@lct/contracts';
import { approvedCoverage } from './final-review.js';

const outline: DeckOutline = {
  title: 'Guarantee',
  audience: '',
  goal: '',
  slides: [
    {
      title: 'Гарантия действует',
      kind: 'statement',
      points: ['Только при предоплате до 15 октября'],
    },
  ],
};
const written = (text: string) => [{ index: 0, slide: { texts: [{ slotId: 'body', text }] } }];

describe('approved coverage', () => {
  it('reports an approved condition missing from the visible slide', () => {
    expect(approvedCoverage(outline, written('Гарантия действует'), []).missing).toEqual([
      { slideIndex: 0, claimIndex: 1, text: 'Только при предоплате до 15 октября' },
    ]);
  });
  it('accepts a slide containing every approved claim', () => {
    expect(
      approvedCoverage(
        outline,
        written('Гарантия действует. Только при предоплате до 15 октября'),
        [],
      ).covered,
    ).toBe(2);
  });
  it('does not accept a critic citation absent from the actual slide', () => {
    expect(
      approvedCoverage(outline, written('Гарантия действует'), [
        { slideIndex: 0, claimIndex: 1, quote: 'Оплатить заранее' },
      ]).missing,
    ).toHaveLength(1);
  });
  it('accepts a semantic coverage judgment backed by an actual visible excerpt', () => {
    expect(
      approvedCoverage(outline, written('Гарантия действует. Оплатить заранее, до 15 октября'), [
        { slideIndex: 0, claimIndex: 1, quote: 'Оплатить заранее, до 15 октября' },
      ]).missing,
    ).toEqual([]);
  });
});
