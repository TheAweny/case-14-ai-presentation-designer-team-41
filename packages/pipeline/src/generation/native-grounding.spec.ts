import { describe, expect, it } from 'vitest';
import type { SlotVisual } from '@lct/contracts';
import { groundedVisual } from './workflow.js';

describe('native visual grounding', () => {
  const quote = 'Revenue: 2026 18 %. Pilot only.';
  const visual: SlotVisual = {
    kind: 'native',
    slotId: 'body',
    block: {
      kind: 'kpi',
      items: [
        {
          value: { state: 'present', literal: '18', value: 18 },
          unit: '%',
          unitAmbiguous: false,
          caption: 'Revenue',
          period: '2026',
          periodKnown: true,
          caveat: 'Pilot only.',
          sources: [{ itemId: 'brief', quote, status: 'grounded' }],
        },
      ],
    },
  };
  it('keeps literal, unit, period, source and caveat', () => {
    expect(groundedVisual(visual, quote)).toEqual(visual);
  });
  it('rejects an invented quote, a changed unit or period, and disagreement with the literal', () => {
    if (visual.kind !== 'native' || visual.block.kind !== 'kpi') throw new Error('fixture');
    for (const change of [
      { unit: 'RUB' },
      { period: '2025' },
      { value: { state: 'present', literal: '18', value: 19 } },
      { sources: [{ itemId: 'brief', quote: 'Revenue 999 %', status: 'grounded' }] },
    ]) {
      const changed = {
        ...visual,
        block: { ...visual.block, items: [{ ...visual.block.items[0], ...change }] },
      } as SlotVisual;
      expect(groundedVisual(changed, quote)).toBeNull();
    }
  });
});
