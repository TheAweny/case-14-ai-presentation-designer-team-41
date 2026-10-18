import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inspectTemplateLayout, TemplateLayoutError } from './template-layout.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_STALE = 'c'.repeat(64);

type Profile = {
  schemaVersion: 1;
  templateHash: string;
  designSystem: { templateHash: string };
  compositions: Array<{
    patternId: string;
    sourceIndex: number;
    name: string;
    slots: Array<Record<string, unknown>>;
    imageCount: number;
    imageSlots?: Array<Record<string, unknown>>;
  }>;
};

function borrowed(): Profile {
  const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/contracts/fixtures/GenerationProfile.json',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    valid: Array<{ payload: Profile }>;
  };
  const payload = fixture.valid[0]?.payload;
  if (!payload) throw new Error('fixture has no payload');
  return structuredClone(payload);
}

function unfamiliar(patternId: string, hash: string, name: string): Profile {
  const profile = borrowed();
  profile.templateHash = hash;
  profile.designSystem.templateHash = hash;
  const composition = profile.compositions[0];
  if (!composition) throw new Error('fixture has no composition');
  composition.patternId = patternId;
  composition.name = name;
  composition.sourceIndex = 3;
  return profile;
}

function note(hash: string, patternId: string) {
  return {
    templateHash: hash,
    revision: 'template-indexer@1+unfamiliar',
    notes: [
      {
        patternId,
        kind: 'cards' as const,
        items: 4,
        useFor: 'Four parallel remarks, not a reading of the boxes.',
        title: 'Parallel remarks',
        skip: false,
        special: false,
        requiredContent: [],
      },
    ],
  };
}

describe('inspectTemplateLayout', () => {
  it('reads two unfamiliar profiles borrowed from the fixture, with renamed ids', () => {
    const fjord = unfamiliar('layout-fjord-cover', HASH_A, 'Fjord opening');
    const steppe = unfamiliar('layout-steppe-list', HASH_B, 'Steppe list');
    delete steppe.compositions[0]?.imageSlots;

    const first = inspectTemplateLayout(
      fjord,
      note(HASH_A, 'layout-fjord-cover'),
      'layout-fjord-cover',
    );
    const second = inspectTemplateLayout(
      steppe,
      note(HASH_B, 'layout-steppe-list'),
      'layout-steppe-list',
    );

    expect(first).toMatchObject({
      templateHash: HASH_A,
      patternId: 'layout-fjord-cover',
      name: 'Fjord opening',
      sourceIndex: 3,
      semantics: { kind: 'cards', items: 4, title: 'Parallel remarks' },
      groups: 'unknown',
      cardHeadings: 'unknown',
    });
    expect(second.templateHash).toBe(HASH_B);
    expect(second.patternId).toBe('layout-steppe-list');
    expect(second.imageSlots).toEqual([]);
    expect(second.imageSlotCount).toBe(0);
    expect(second.imageOffset).toBe(0);
    expect(second.imageNextOffset).toBeNull();
    expect(second.imageSlotsTruncated).toBe(false);
    expect(first.textSlots[0]?.sample.sampleOnly).toBe(true);
  });

  it('ignores an index whose template hash is stale or whose shape is invalid', () => {
    const profile = unfamiliar('layout-fjord-cover', HASH_A, 'Fjord opening');
    const stale = inspectTemplateLayout(
      profile,
      note(HASH_STALE, 'layout-fjord-cover'),
      'layout-fjord-cover',
    );
    const broken = inspectTemplateLayout(profile, { notes: [] }, 'layout-fjord-cover');
    expect(stale.semantics).toBeNull();
    expect(broken.semantics).toBeNull();
    expect(stale.groups).toBe('unknown');
  });

  it('pages fifty text slots by twenty and keeps a long sample from becoming a fact', () => {
    const profile = unfamiliar('layout-harbour-grid', HASH_A, 'Карточки 2x2');
    const composition = profile.compositions[0];
    if (!composition) throw new Error('missing composition');
    const factLike = 'Выручка выросла на 12%. ' + 'x'.repeat(400);
    composition.slots = Array.from({ length: 50 }, (_, index) => ({
      slotId: 'slot-' + index,
      role: index === 0 ? 'title' : 'body',
      sample: factLike,
      maxChars: 80,
      maxLines: 2,
      font: 'Y'.repeat(240),
      fontSize: index === 7 ? 44 : 16,
      box: { x: (index % 5) * 100, y: Math.floor(index / 5) * 80, cx: 90, cy: 70 },
    }));
    composition.imageSlots = Array.from({ length: 25 }, (_, index) => ({
      slotId: 'picture-' + index,
      kind: 'placeholder',
      box: { x: index, y: index, cx: 10, cy: 10 },
    }));
    composition.imageCount = 25;

    const page = inspectTemplateLayout(
      profile,
      note(HASH_A, 'layout-harbour-grid'),
      'layout-harbour-grid',
    );
    expect(page.totalSlots).toBe(50);
    expect(page.textSlots).toHaveLength(20);
    expect(page.textSlots[0]?.slotId).toBe('slot-0');
    expect(page.nextOffset).toBe(20);
    expect(page.truncated).toBe(true);
    expect(page.textSlots[7]?.role).toBe('body');
    expect(page.textSlots[7]?.fontSize).toBe(44);
    expect(page.textSlots[0]?.sample.sampleOnly).toBe(true);
    expect(page.textSlots[0]?.sample.text.startsWith('Выручка выросла на 12%. ')).toBe(true);
    expect(page.textSlots[0]?.sample.text.length).toBeLessThanOrEqual(200);
    expect(page.textSlots[0]?.sample.text.length).toBeLessThan(factLike.length);
    expect(page.textSlots[0]?.font.length).toBeLessThanOrEqual(200);
    expect(page.imageSlots).toHaveLength(20);
    expect(page.imageOffset).toBe(0);
    expect(page.imageNextOffset).toBe(20);
    expect(page.imageSlotCount).toBe(25);
    expect(page.imageSlotsTruncated).toBe(true);
    expect(page.textSlots.every((slot) => slot.maxChars === 80 && slot.maxLines === 2)).toBe(true);
    const pictures = inspectTemplateLayout(
      profile,
      null,
      'layout-harbour-grid',
      page.nextOffset ?? 0,
      page.imageNextOffset ?? 0,
    );
    expect(pictures.imageSlots.map((slot) => slot.slotId)).toEqual([
      'picture-20',
      'picture-21',
      'picture-22',
      'picture-23',
      'picture-24',
    ]);
    expect(pictures.imageNextOffset).toBeNull();
    expect(pictures.imageSlotsTruncated).toBe(false);
    expect(JSON.stringify(pictures).length).toBeLessThanOrEqual(10_000);
    expect(page.groups).toBe('unknown');
    expect(page.cardHeadings).toBe('unknown');
    expect(JSON.stringify(page).length).toBeLessThan(10_000);

    const middle = inspectTemplateLayout(profile, null, 'layout-harbour-grid', 20);
    expect(middle.textSlots[0]?.slotId).toBe('slot-20');
    expect(middle.nextOffset).toBe(40);
    expect(middle.semantics).toBeNull();

    const last = inspectTemplateLayout(profile, null, 'layout-harbour-grid', 40);
    expect(last.textSlots).toHaveLength(10);
    expect(last.nextOffset).toBeNull();
    expect(last.truncated).toBe(false);
  });

  it('keeps slot ids intact when they are long and still pages the pictures', () => {
    const profile = unfamiliar('layout-long-ids', HASH_A, 'Long ids');
    const composition = profile.compositions[0];
    if (!composition) throw new Error('missing composition');
    composition.slots = Array.from({ length: 3 }, (_, index) => ({
      slotId: 'T' + String(index) + 'z'.repeat(498),
      role: index === 0 ? 'title' : 'body',
      sample: 'sample ' + index,
      maxChars: 40 + index,
      maxLines: 3 + index,
      font: 'Face',
      fontSize: 18,
    }));
    composition.imageSlots = Array.from({ length: 25 }, (_, index) => ({
      slotId: 'I' + String(index).padStart(3, '0') + 'q'.repeat(496),
      kind: 'panel',
      box: { x: index, y: 2, cx: 3, cy: 4 },
    }));
    composition.imageCount = 25;

    const first = inspectTemplateLayout(profile, null, 'layout-long-ids', 0, 0);
    expect(JSON.stringify(first).length).toBeLessThanOrEqual(10_000);
    expect(first.textSlots.map((slot) => slot.slotId)).toEqual(
      composition.slots.map((slot) => slot.slotId),
    );
    expect(first.textSlots.map((slot) => [slot.role, slot.maxChars, slot.maxLines])).toEqual([
      ['title', 40, 3],
      ['body', 41, 4],
      ['body', 42, 5],
    ]);
    expect(first.imageSlots.length).toBeGreaterThan(0);
    expect(first.imageSlots.length).toBeLessThanOrEqual(20);
    expect(first.imageNextOffset).toBe(first.imageSlots.length);
    const seen = first.imageSlots.map((slot) => slot.slotId);
    let imageOffset = first.imageNextOffset ?? 0;
    while (imageOffset < 25) {
      const next = inspectTemplateLayout(profile, null, 'layout-long-ids', 3, imageOffset);
      expect(JSON.stringify(next).length).toBeLessThanOrEqual(10_000);
      expect(next.imageSlots.length).toBeGreaterThan(0);
      seen.push(...next.imageSlots.map((slot) => slot.slotId));
      expect(next.imageOffset).toBe(imageOffset);
      imageOffset = next.imageNextOffset ?? 25;
    }
    expect(seen).toEqual(composition.imageSlots.map((slot) => slot.slotId));
    expect(seen.every((id) => id.length === 500)).toBe(true);
  });

  it('throws when the profile is invalid or the layout id is not in it', () => {
    const profile = unfamiliar('layout-fjord-cover', HASH_A, 'Fjord opening');
    expect(() => inspectTemplateLayout({}, null, 'layout-fjord-cover')).toThrow(
      TemplateLayoutError,
    );
    expect(() => inspectTemplateLayout(profile, null, 'layout-missing')).toThrow(
      TemplateLayoutError,
    );
    try {
      inspectTemplateLayout({}, null, 'layout-fjord-cover');
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid_profile' });
    }
    try {
      inspectTemplateLayout(profile, null, 'layout-missing');
    } catch (error) {
      expect(error).toMatchObject({ code: 'unknown_layout' });
    }
  });

  it('reports a card heading only when the matching index names that body slot', () => {
    const profile = unfamiliar('layout-unfamiliar-cards', HASH_A, 'Unfamiliar cards');
    const composition = profile.compositions[0];
    if (!composition) throw new Error('missing composition');
    composition.slots = [
      {
        slotId: 'title-1',
        role: 'title',
        sample: 'Title',
        maxChars: 40,
        maxLines: 1,
        font: 'Face',
        fontSize: 28,
      },
      {
        slotId: 'body-huge',
        role: 'body',
        sample: 'Card label',
        maxChars: 40,
        maxLines: 1,
        font: 'Face',
        fontSize: 96,
      },
      {
        slotId: 'body-copy',
        role: 'body',
        sample: 'Card copy',
        maxChars: 120,
        maxLines: 3,
        font: 'Face',
        fontSize: 14,
      },
    ];
    const base = {
      templateHash: HASH_A,
      revision: 'template-indexer@1.4.0+test',
      notes: [
        {
          patternId: 'layout-unfamiliar-cards',
          kind: 'cards' as const,
          items: 1,
          useFor: 'one card',
          title: 'One card',
          skip: false,
          special: false,
          requiredContent: [],
          slotSemantics: [
            { slotId: 'body-huge', role: 'card-heading' as const, groupId: 'card-1' },
            { slotId: 'body-copy', role: 'body' as const, groupId: 'card-1' },
            { slotId: 'not-a-slot', role: 'caption' as const, groupId: 'card-1' },
          ],
          groups: [
            {
              id: 'card-1',
              kind: 'card' as const,
              slotIds: ['body-huge', 'body-copy', 'not-a-slot'],
            },
          ],
        },
      ],
    };
    const page = inspectTemplateLayout(profile, base, 'layout-unfamiliar-cards');
    expect(page.textSlots.map((slot) => slot.role)).toEqual(['title', 'body', 'body']);
    expect(page.textSlots.find((slot) => slot.slotId === 'body-huge')).toMatchObject({
      role: 'body',
      semanticRole: 'card-heading',
      fontSize: 96,
      groupId: 'card-1',
    });
    expect(page.textSlots.find((slot) => slot.slotId === 'body-copy')?.semanticRole).toBe('body');
    expect(page.textSlots.find((slot) => slot.slotId === 'title-1')?.semanticRole).toBe('unknown');
    expect(page.cardHeadings).toEqual(['body-huge']);
    expect(page.groups).toEqual([
      { id: 'card-1', kind: 'card', slotIds: ['body-huge', 'body-copy'] },
    ]);

    const old = inspectTemplateLayout(
      profile,
      note(HASH_A, 'layout-unfamiliar-cards'),
      'layout-unfamiliar-cards',
    );
    expect(old.textSlots.every((slot) => slot.semanticRole === 'unknown')).toBe(true);
    expect(old.groups).toBe('unknown');
    expect(old.cardHeadings).toBe('unknown');

    const stale = inspectTemplateLayout(
      profile,
      { ...base, templateHash: HASH_STALE },
      'layout-unfamiliar-cards',
    );
    expect(stale.semantics).toBeNull();
    expect(stale.textSlots.every((slot) => slot.semanticRole === 'unknown')).toBe(true);
    expect(stale.groups).toBe('unknown');
    expect(stale.cardHeadings).toBe('unknown');
  });
  it('omits a group id when the named group does not contain the slot', () => {
    const profile = unfamiliar('layout-unfamiliar-cards', HASH_A, 'Unfamiliar cards');
    const composition = profile.compositions[0];
    if (!composition) throw new Error('missing composition');
    composition.slots = [
      {
        slotId: 'body-huge',
        role: 'body',
        sample: 'Card label',
        maxChars: 40,
        maxLines: 1,
        font: 'Face',
        fontSize: 96,
      },
      {
        slotId: 'body-copy',
        role: 'body',
        sample: 'Card copy',
        maxChars: 80,
        maxLines: 2,
        font: 'Face',
        fontSize: 14,
      },
    ];
    const page = inspectTemplateLayout(
      profile,
      {
        templateHash: HASH_A,
        revision: 'template-indexer@1.4.0+test',
        notes: [
          {
            patternId: 'layout-unfamiliar-cards',
            kind: 'cards' as const,
            items: 2,
            useFor: 'two cards',
            title: 'Two cards',
            skip: false,
            special: false,
            requiredContent: [],
            slotSemantics: [
              { slotId: 'body-huge', role: 'card-heading' as const, groupId: 'card-2' },
              { slotId: 'body-copy', role: 'body' as const, groupId: 'card-2' },
            ],
            groups: [
              { id: 'card-1', kind: 'card' as const, slotIds: ['body-huge'] },
              { id: 'card-2', kind: 'card' as const, slotIds: ['body-copy', 'body-huge'] },
              { id: 'card-1', kind: 'step' as const, slotIds: ['body-copy'] },
            ],
          },
        ],
      },
      'layout-unfamiliar-cards',
    );
    expect(page.textSlots.find((slot) => slot.slotId === 'body-huge')).toMatchObject({
      semanticRole: 'card-heading',
    });
    expect(page.textSlots.find((slot) => slot.slotId === 'body-huge')).not.toHaveProperty(
      'groupId',
    );
    expect(page.textSlots.find((slot) => slot.slotId === 'body-copy')?.groupId).toBe('card-2');
    expect(page.groups).toEqual([
      { id: 'card-1', kind: 'card', slotIds: ['body-huge'] },
      { id: 'card-2', kind: 'card', slotIds: ['body-copy'] },
    ]);
  });
});
