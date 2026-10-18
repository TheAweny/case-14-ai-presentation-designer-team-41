import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generationProfileSchema } from '@lct/contracts';
import { inspectTemplateLayout } from './template-layout.js';

function profile() {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../../packages/contracts/fixtures/GenerationProfile.json', import.meta.url),
      'utf8',
    ),
  ) as { valid: { payload: unknown }[] };
  return generationProfileSchema.parse(fixture.valid[0]?.payload);
}

describe('independent template inspection counterexamples', () => {
  it('uses named card roles without assigning a slot to a group which does not own it', () => {
    const source = profile();
    const layout = source.compositions[0];
    const base = layout?.slots[0];
    if (!layout || !base) throw new Error('Missing fixture composition');
    layout.slots = ['a', 'b', 'c'].map((slotId) => ({
      ...base,
      slotId,
      role: 'body' as const,
      fontSize: 96,
    }));
    const index = {
      templateHash: source.templateHash,
      revision: 'tested',
      notes: [
        {
          patternId: layout.patternId,
          kind: 'cards',
          items: 2,
          title: 'Cards',
          useFor: '',
          skip: false,
          special: false,
          requiredContent: [],
          groups: [{ id: 'card-a', kind: 'card', slotIds: ['a'] }],
          slotSemantics: [
            { slotId: 'a', role: 'card-heading', groupId: 'card-a' },
            { slotId: 'b', role: 'body', groupId: 'card-a' },
          ],
        },
      ],
    };
    const result = inspectTemplateLayout(source, index, layout.patternId);
    expect(result.textSlots[0]).toMatchObject({
      role: 'body',
      semanticRole: 'card-heading',
      groupId: 'card-a',
    });
    expect(result.textSlots[1]?.groupId).toBeUndefined();
    expect(result.textSlots[2]).toMatchObject({ role: 'body', semanticRole: 'unknown' });
    const stale = inspectTemplateLayout(
      source,
      { ...index, templateHash: 'f'.repeat(64) },
      layout.patternId,
    );
    expect(stale.textSlots.every((slot) => slot.semanticRole === 'unknown')).toBe(true);
    expect(stale.cardHeadings).toBe('unknown');
  });

  it('can enumerate every opaque slot identifier without exceeding the response budget', () => {
    const source = profile();
    const layout = source.compositions[0];
    if (!layout?.slots[0]) throw new Error('Missing fixture composition');
    const originalSlot = layout.slots[0];
    layout.patternId = 'unseen-layout';
    layout.slots = Array.from({ length: 30 }, (_, i) => ({
      ...originalSlot,
      slotId: `text-${i}-${'x'.repeat(500)}`,
    }));
    layout.imageSlots = Array.from({ length: 25 }, (_, i) => ({
      slotId: `picture-${i}-${'y'.repeat(500)}`,
      kind: 'panel',
      box: { x: i, y: i, cx: 100, cy: 100 },
    }));
    const textIds: string[] = [];
    const imageIds: string[] = [];
    let textOffset = 0;
    let imageOffset = 0;
    for (let page = 0; page < 100; page++) {
      const result = inspectTemplateLayout(source, null, layout.patternId, textOffset, imageOffset);
      expect(JSON.stringify(result).length).toBeLessThan(10000);
      textIds.push(...result.textSlots.map((slot) => slot.slotId));
      imageIds.push(...result.imageSlots.map((slot) => slot.slotId));
      if (result.nextOffset === null && result.imageNextOffset === null) break;
      expect(result.textSlots.length + result.imageSlots.length).toBeGreaterThan(0);
      textOffset = result.nextOffset ?? layout.slots.length;
      imageOffset = result.imageNextOffset ?? layout.imageSlots.length;
    }
    expect(textIds).toEqual(layout.slots.map((slot) => slot.slotId));
    expect(imageIds).toEqual(layout.imageSlots.map((slot) => slot.slotId));
  });

  it('keeps a decorative large-font body as body and template samples as samples', () => {
    const source = profile();
    const layout = source.compositions[0];
    if (!layout?.slots[0]) throw new Error('Missing fixture composition');
    layout.slots[0].role = 'body';
    layout.slots[0].fontSize = 96;
    layout.slots[0].sample = 'Выручка — 99 млн ₽';
    const result = inspectTemplateLayout(source, null, layout.patternId);
    expect(result.textSlots[0]).toMatchObject({
      role: 'body',
      fontSize: 96,
      sample: { text: 'Выручка — 99 млн ₽', sampleOnly: true },
    });
    expect(result.semantics).toBeNull();
    expect(result.cardHeadings).toBe('unknown');
  });
});
