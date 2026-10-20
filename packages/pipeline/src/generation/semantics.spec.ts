import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compositionNoteSchema, generationProfileSchema, type Composition } from '@lct/contracts';
import { loadAgent } from '@lct/registry';
import { compositionSemantics, semanticSlotMap } from './semantics.js';
import { createGenerationWorkflow, minChars, slotBriefs, targetRange } from './workflow.js';
import type { TextProvider } from './provider.js';

const card = (slotId: string, x: number) => ({
  slotId,
  role: 'body' as const,
  sample: 'Заголовок\nТекст',
  maxChars: 135,
  maxLines: 6,
  font: 'Fixture',
  fontSize: 18,
  capacity: { basis: 'geometry' as const, safeChars: 135 },
  box: { x, y: 2_000_000, cx: 3_000_000, cy: 2_000_000 },
});
const pattern: Composition = {
  patternId: 'integrated-cards',
  sourceIndex: 0,
  name: 'Three blocks and a note',
  imageCount: 0,
  slots: [
    {
      ...card('title', 0),
      role: 'title',
      sample: 'Заголовок',
      maxChars: 120,
      box: { x: 0, y: 0, cx: 10_000_000, cy: 500_000 },
    },
    card('card-a', 0),
    card('card-b', 3_500_000),
    card('card-c', 7_000_000),
    {
      ...card('footer', 0),
      sample: 'Текст',
      maxLines: 2,
      box: { x: 0, y: 5_500_000, cx: 6_000_000, cy: 400_000 },
    },
  ],
};
const note = compositionNoteSchema.parse({
  patternId: pattern.patternId,
  kind: 'cards',
  title: pattern.name,
  useFor: 'Three parallel points',
  items: 3,
  skip: false,
  groups: [
    { id: 'one', kind: 'card', slotIds: ['card-a', 'footer'] },
    { id: 'two', kind: 'card', slotIds: ['card-b'] },
    { id: 'three', kind: 'card', slotIds: ['card-c'] },
  ],
  slotSemantics: [
    { slotId: 'title', role: 'slide-title' },
    { slotId: 'card-a', role: 'card-heading', groupId: 'one' },
    { slotId: 'card-b', role: 'card-heading', groupId: 'two' },
    { slotId: 'card-c', role: 'card-heading', groupId: 'three' },
    { slotId: 'footer', role: 'body', groupId: 'one' },
  ],
});

describe('integrated card semantics', () => {
  it('keeps heading and body in one explicit placeholder and removes a misgrouped footer', () => {
    const before = structuredClone(note);
    const semantics = compositionSemantics(pattern, note);
    expect(semantics.groups.map((group) => group.slotIds)).toEqual([
      ['card-a'],
      ['card-b'],
      ['card-c'],
    ]);
    for (const slotId of ['card-a', 'card-b', 'card-c'])
      expect(semantics.slots.find((slot) => slot.slotId === slotId)).toMatchObject({
        semanticRole: 'body',
        contentStructure: 'heading-body',
      });
    expect(semantics.slots.find((slot) => slot.slotId === 'footer')).toEqual({
      slotId: 'footer',
      semanticRole: 'caption',
    });
    expect(note).toEqual(before);
  });

  it('does not invent integrated structure from ordinary prose, size or physical proximity', () => {
    const ordinary = {
      ...pattern,
      slots: pattern.slots.map((slot) => ({
        ...slot,
        sample: slot.role === 'title' ? slot.sample : 'Результат пилота\nСрок три месяца',
      })),
    };
    const semantics = compositionSemantics(ordinary, note);
    expect(semantics.slots.every((slot) => !slot.contentStructure)).toBe(true);
    expect(semantics.groups[0]?.slotIds).toEqual(['card-a', 'footer']);
    expect(semantics.slots.find((slot) => slot.slotId === 'footer')?.semanticRole).toBe('body');
  });

  it('recognizes mixed-case placeholder paragraphs without enforcing paragraph-length filler', () => {
    const mixed = {
      ...pattern,
      slots: pattern.slots.map((slot) => ({
        ...slot,
        sample: slot.slotId.startsWith('card-') ? '  ЗАГОЛОВОК\v Текст  ' : slot.sample,
      })),
    };
    const semantics = compositionSemantics(mixed, note);
    const integrated = semantics.slots.find((slot) => slot.slotId === 'card-a');
    expect(integrated?.contentStructure).toBe('heading-body');
    const original = mixed.slots.find((slot) => slot.slotId === 'card-a');
    if (!original) throw new Error('Missing fixture card');
    expect(minChars({ ...original, ...integrated }, 'dense')).toBe(0);
    expect(targetRange({ ...original, ...integrated }, 'dense')).toEqual({
      targetMinChars: 0,
      targetMaxChars: 135,
    });
    expect(
      slotBriefs(mixed.slots, 'dense', semantics.slots).find((slot) => slot.slotId === 'card-a'),
    ).toMatchObject({ targetMinChars: 0 });
  });

  it('preserves real split heading/body pairs and cover fields', () => {
    const split = {
      ...pattern,
      slots: pattern.slots.map((slot) => ({
        ...slot,
        sample: slot.slotId.startsWith('card-') ? 'Заголовок' : slot.sample,
      })),
    };
    expect(compositionSemantics(split, note).groups[0]?.slotIds).toEqual(['card-a', 'footer']);
    const cover = compositionSemantics(pattern, { ...note, kind: 'cover' });
    expect(cover.slots.every((slot) => !slot.contentStructure)).toBe(true);
    expect(cover.groups[0]?.slotIds).toEqual(['card-a', 'footer']);
  });

  it('does not move an integrated block into a plain body slot during variant remapping', () => {
    const plain = {
      ...pattern,
      patternId: 'plain',
      slots: pattern.slots.map((slot) => ({
        ...slot,
        sample: slot.slotId.startsWith('card-') ? 'Текст' : slot.sample,
      })),
    };
    const corrected = compositionSemantics(pattern, note);
    const plainNote = {
      ...note,
      patternId: plain.patternId,
      groups: corrected.groups,
      slotSemantics: corrected.slots.map(({ slotId, semanticRole, groupId }) => ({
        slotId,
        role: semanticRole as 'body',
        ...(groupId ? { groupId } : {}),
      })),
    };
    expect(semanticSlotMap(pattern, plain, note, plainNote)).toBeUndefined();
  });

  it('sends corrected card structure and the registry instruction to the one whole-deck writer', async () => {
    const agent = await loadAgent(resolve('../../registry/agents/deck-writer'));
    expect(agent.config.version).toBe('1.4.0');
    expect(agent.instructions).toContain('Не переноси туда сумму, ограничение, условие');
    const fixture = generationProfileSchema.parse(
      JSON.parse(readFileSync(resolve('../contracts/fixtures/GenerationProfile.json'), 'utf8'))
        .valid[0].payload,
    );
    const brief =
      'Согласовать бюджет пилота 900 000 ₽. Назначить владельца пилота. Подтвердить участие 30 операторов.';
    let writes = 0;
    const provider: TextProvider = {
      model: 'offline',
      async generate(role, instructions, input, schema) {
        if (role === 'planner')
          return schema.parse({
            title: 'Согласование пилота',
            slides: Array.from({ length: 5 }, () => ({
              patternId: pattern.patternId,
              purpose: brief,
              imageQuery: '',
              requiredClaims: [],
            })),
          });
        if (role !== 'writer') throw new Error(`Unexpected extra model call: ${role}`);
        writes++;
        expect(instructions).toBe(agent.instructions);
        const deck = input as {
          slides: { index: number; composition: ReturnType<typeof compositionSemantics> }[];
        };
        expect(deck.slides).toHaveLength(5);
        for (const slide of deck.slides) {
          expect(slide.composition.groups[0]?.slotIds).toEqual(['card-a']);
          expect(slide.composition.slots.find((slot) => slot.slotId === 'card-a')).toMatchObject({
            semanticRole: 'body',
            contentStructure: 'heading-body',
          });
          expect(slide.composition.slots.find((slot) => slot.slotId === 'footer')).toMatchObject({
            semanticRole: 'caption',
          });
        }
        return schema.parse({
          slides: Object.fromEntries(
            deck.slides.map(({ index }) => [
              String(index),
              {
                patternId: pattern.patternId,
                textsBySlot: {
                  title: 'Согласуйте пилот',
                  'card-a': 'Бюджет\nСогласовать 900 000 ₽',
                  'card-b': 'Владелец\nНазначить владельца пилота',
                  'card-c': 'Участие\nПодтвердить 30 операторов',
                  footer: '',
                },
                speakerNotes: '',
              },
            ]),
          ),
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      notes: [note],
      variant: 'balanced',
      plannerInstructions: 'planner',
      writerInstructions: 'slide',
      deckWriterInstructions: agent.instructions,
      signal: new AbortController().signal,
    });
    const result = await (
      await workflow.createRun()
    ).start({
      inputData: { brief, slideCount: 5, profile: { ...fixture, compositions: [pattern] } },
    });
    expect(result.status).toBe('success');
    expect(writes).toBe(1);
    if (result.status === 'success')
      for (const slide of result.result) {
        expect(slide.slide.texts.find((text) => text.slotId === 'card-a')?.text).toContain(
          '900 000 ₽',
        );
        expect(slide.slide.texts.find((text) => text.slotId === 'footer')?.text).toBe('');
      }
  });
});
