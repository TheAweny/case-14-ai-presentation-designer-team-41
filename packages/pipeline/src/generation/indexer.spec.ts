import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema, type CompositionNote } from '@lct/contracts';
import {
  indexTemplate,
  settleNote,
  settleNotes,
  templateIndexRevision,
  type IndexProgress,
} from './indexer.js';
import type { TextProvider } from './provider.js';
import { createGenerationWorkflow } from './workflow.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
);
const base = generationProfileSchema.parse(fixture.valid[0].payload);
const first = base.compositions[0];
if (!first) throw new Error('Fixture has no composition.');
const lastSlot = first.slots.at(-1);
if (!lastSlot) throw new Error('Fixture composition has no slot.');
/** Five distinct compositions: the fixture's one, renamed and with its title reworded. */
const profile = {
  ...base,
  compositions: Array.from({ length: 5 }, (_, index) => ({
    ...first,
    patternId: `pattern-${index}`,
    sourceIndex: index,
    name: `Layout ${index}`,
    slots: first.slots.map((slot) => ({ ...slot, sample: `${slot.sample} ${index}` })),
  })),
};
const note = (patternId: string, extra: Partial<CompositionNote> = {}): CompositionNote => ({
  patternId,
  kind: 'statement',
  items: 1,
  useFor: 'one claim',
  title: 'One claim',
  skip: false,
  special: false,
  requiredContent: [],
  ...extra,
});

describe('indexTemplate', () => {
  it('describes every distinct composition once, in batches the model can answer', async () => {
    const batches: string[][] = [];
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        _agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        const ids = (input as { compositions: { patternId: string }[] }).compositions.map(
          (composition) => composition.patternId,
        );
        batches.push(ids);
        return schema.parse({ notes: [...ids, ...ids.slice(0, 1)].map((id) => note(id)) });
      },
    };
    const notes = await indexTemplate({
      provider,
      instructions: '',
      profile,
      signal: AbortSignal.timeout(1000),
    });
    expect(batches.flat()).toHaveLength(5);
    expect(notes.map((item) => item.patternId).sort()).toEqual(
      profile.compositions.map((composition) => composition.patternId).sort(),
    );
  });

  it('keeps the valid notes of an answer and asks again only about the rest', async () => {
    const asked: string[][] = [];
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        _agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        const ids = (input as { compositions: { patternId: string }[] }).compositions.map(
          (composition) => composition.patternId,
        );
        asked.push(ids);
        // The first answer loses the description of one composition.
        return schema.parse({
          notes: ids.map((id) =>
            asked.length === 1 && id === 'pattern-2'
              ? { ...note(id), useFor: undefined }
              : note(id),
          ),
        });
      },
    };
    const progress: IndexProgress[] = [];
    const notes = await indexTemplate({
      provider,
      instructions: '',
      profile,
      signal: AbortSignal.timeout(1000),
      onProgress: (step) => progress.push(step),
    });
    expect(asked).toEqual([profile.compositions.map((c) => c.patternId), ['pattern-2']]);
    expect(notes).toHaveLength(5);
    // Before the first answer, after it and after asking again about what it left out.
    expect(progress).toEqual([
      { described: 0, total: 5 },
      { described: 4, total: 5 },
      { described: 5, total: 5 },
    ]);
  });

  it('changes its revision when the instructions change', () => {
    expect(templateIndexRevision('1.0.0', 'a')).not.toBe(templateIndexRevision('1.0.0', 'b'));
  });
});

describe('settleNotes', () => {
  const answer = (patternId: string, extra: Partial<CompositionNote> = {}) => {
    const { skip: _skip, ...rest } = note(patternId, extra);
    return rest;
  };
  const settle = (answers: ReturnType<typeof answer>[]) =>
    settleNotes(profile.compositions, new Map(answers.map((item) => [item.patternId, item])));

  it('makes the slides under a special catalog heading special, up to the next reference', () => {
    const notes = settle([
      answer('pattern-0', { kind: 'reference', special: true }),
      answer('pattern-1'),
      answer('pattern-2', { kind: 'cards', items: 3 }),
      answer('pattern-3', { kind: 'reference' }),
      answer('pattern-4'),
    ]);
    expect(notes.map((item) => item.special)).toEqual([false, true, true, false, false]);
    expect(notes.map((item) => item.skip)).toEqual([true, false, false, true, false]);
  });

  it('ends a special group at people or a closing slide when its heading was missed', () => {
    const notes = settle([
      answer('pattern-0', { kind: 'reference', special: true }),
      answer('pattern-1'),
      answer('pattern-2', { kind: 'other' }),
      answer('pattern-3', { kind: 'team', items: 4 }),
      answer('pattern-4'),
    ]);
    expect(notes.map((item) => item.special)).toEqual([false, true, true, false, false]);
  });

  it('holds the counts to what the composition can show', () => {
    const blocks = first.slots.filter((slot) => slot.role !== 'title').length;
    const [cover, cards] = settle([
      answer('pattern-0', { kind: 'cover', items: 4 }),
      answer('pattern-1', { kind: 'cards', items: 12 }),
    ]);
    expect(cover?.items).toBe(1);
    expect(cards?.items).toBeLessThanOrEqual(Math.max(blocks, 1));
  });

  it('keeps content requirements on usable slides but not reference pages', () => {
    const [reference, speaker] = settle([
      answer('pattern-0', { kind: 'reference', requiredContent: ['image'] }),
      answer('pattern-1', { kind: 'team', requiredContent: ['person-name', 'image'] }),
    ]);
    expect(reference?.requiredContent).toEqual([]);
    expect(speaker?.requiredContent).toEqual(['person-name', 'image']);
  });
});

describe('settleNote semantics', () => {
  const source = first.slots[0];
  if (!source) throw new Error('Fixture has no slot.');
  const body = { ...source, role: 'body' as const, fontSize: 96 };
  const answer = {
    patternId: first.patternId,
    kind: 'cards' as const,
    items: 2,
    useFor: 'cards',
    title: 'Cards',
    special: false,
    requiredContent: [] as CompositionNote['requiredContent'],
  };

  it('keeps a card heading only when the index names that slot id', () => {
    const huge = { ...body, fontSize: 96 };
    const pattern = {
      ...first,
      slots: first.slots.map((slot) => (slot.slotId === body.slotId ? huge : slot)),
    };
    const unnamed = settleNote(answer, pattern);
    expect(unnamed.slotSemantics).toBeUndefined();
    const named = settleNote(
      {
        ...answer,
        slotSemantics: [
          { slotId: huge.slotId, role: 'card-heading' as const, groupId: 'card-1' },
          { slotId: 'not-in-pattern', role: 'caption' as const },
        ],
        groups: [
          { id: 'card-1', kind: 'card' as const, slotIds: [huge.slotId, 'not-in-pattern'] },
          { id: 'card-2', kind: 'card' as const, slotIds: [huge.slotId] },
        ],
      },
      pattern,
    );
    expect(named.slotSemantics).toEqual([
      { slotId: huge.slotId, role: 'card-heading', groupId: 'card-1' },
    ]);
    expect(named.groups).toEqual([{ id: 'card-1', kind: 'card', slotIds: [huge.slotId] }]);
    expect(huge.fontSize).toBe(96);
    expect(huge.role).toBe('body');
  });

  it('drops a group id that names a real group the slot does not belong to', () => {
    const other = { ...body, slotId: body.slotId + '-copy', role: 'body' as const, fontSize: 12 };
    const pattern = {
      ...first,
      slots: [...first.slots.filter((slot) => slot.slotId !== body.slotId), body, other],
    };
    const named = settleNote(
      {
        ...answer,
        slotSemantics: [{ slotId: body.slotId, role: 'card-heading' as const, groupId: 'card-2' }],
        groups: [
          { id: 'card-1', kind: 'card' as const, slotIds: [body.slotId] },
          { id: 'card-2', kind: 'card' as const, slotIds: [other.slotId] },
        ],
      },
      pattern,
    );
    expect(named.slotSemantics).toEqual([{ slotId: body.slotId, role: 'card-heading' }]);
    expect(named.groups?.map((group) => group.id)).toEqual(['card-1', 'card-2']);
  });

  it('sends the raw slot id to the indexer and does not read font size from the brief', async () => {
    let seen: unknown;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        _agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        seen = input;
        const ids = (input as { compositions: { patternId: string }[] }).compositions.map(
          (composition) => composition.patternId,
        );
        return schema.parse({ notes: ids.map((id) => note(id)) });
      },
    };
    await indexTemplate({
      provider,
      instructions: '',
      profile,
      signal: AbortSignal.timeout(1000),
    });
    const slot = (
      seen as { compositions: { slots: { slotId: string; fontSize?: number; role: string }[] }[] }
    ).compositions[0]?.slots[0];
    expect(slot?.slotId).toBe(first.slots[0]?.slotId);
    expect(slot).not.toHaveProperty('fontSize');
  });
});

describe('planning with template notes', () => {
  it('replans when a named-person slide has no source evidence', async () => {
    let plans = 0;
    let missing: unknown;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner') {
          plans++;
          missing = (input as { corrections?: { missingRequiredContent?: unknown } }).corrections
            ?.missingRequiredContent;
          return schema.parse({
            title: 'Deck',
            slides: Array.from({ length: 10 }, (_, index) => ({
              patternId:
                (index === 1 || index === 6) && plans > 1 ? 'pattern-2' : `pattern-${index % 5}`,
              purpose: `Point ${index}`,
              imageQuery: '',
            })),
          });
        }
        return schema.parse({
          patternId: (input as { composition: { patternId: string } }).composition.patternId,
          textsBySlot: Object.fromEntries(
            (input as { composition: { slots: { slotId: string }[] } }).composition.slots.map(
              (slot) => [slot.slotId, 'Point'],
            ),
          ),
          speakerNotes: '',
          visual: null,
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
      notes: [note('pattern-1', { requiredContent: ['person-name'] })],
    });
    const result = await (
      await workflow.createRun()
    ).start({
      inputData: { brief: 'Описание продукта без имени спикера', slideCount: 10, profile },
    });
    expect(result.status).toBe('success');
    expect(plans).toBe(2);
    expect(missing).toEqual([
      { slideIndex: 1, patternId: 'pattern-1', requirements: ['person-name'] },
      { slideIndex: 6, patternId: 'pattern-1', requirements: ['person-name'] },
    ]);
  });

  it('hides reference pages from the planner and tells it what each layout is for', async () => {
    let catalog: { patternId: string; kind?: string; useFor?: string }[] = [];
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner') {
          catalog = (input as { catalog: typeof catalog }).catalog;
          return schema.parse({
            title: 'Deck',
            slides: Array.from({ length: 10 }, (_, index) => ({
              patternId: catalog[index % catalog.length]?.patternId,
              purpose: `Point ${index}`,
              imageQuery: '',
            })),
          });
        }
        return schema.parse({
          patternId: (input as { composition: { patternId: string } }).composition.patternId,
          textsBySlot: Object.fromEntries(
            (input as { composition: { slots: { slotId: string }[] } }).composition.slots.map(
              (slot) => [slot.slotId, 'Point'],
            ),
          ),
          speakerNotes: '',
          visual: null,
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
      notes: [
        note('pattern-0', { kind: 'reference', skip: true, useFor: 'fonts and colours' }),
        note('pattern-1', { kind: 'cards', items: 3, useFor: 'three parallel points' }),
        note('pattern-2', { requiredContent: ['image'] }),
      ],
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief: 'Point', slideCount: 10, profile } });
    expect(result.status).toBe('success');
    expect(catalog.map((item) => item.patternId)).not.toContain('pattern-0');
    expect(catalog.map((item) => item.patternId)).not.toContain('pattern-2');
    expect(catalog.find((item) => item.patternId === 'pattern-1')).toMatchObject({
      kind: 'cards',
      useFor: 'three parallel points',
      requiredContent: [],
    });
    const withImages = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
      imagesAvailable: true,
      notes: [note('pattern-2', { requiredContent: ['image'] })],
    });
    const second = await (
      await withImages.createRun()
    ).start({ inputData: { brief: 'Point', slideCount: 10, profile } });
    expect(second.status).toBe('success');
    expect(catalog.find((item) => item.patternId === 'pattern-2')).toMatchObject({
      requiredContent: ['image'],
    });
  });

  it('opens on the plain cover, even one with a short date line, and never on a special one', async () => {
    let planned: { catalog: { patternId: string }[]; coverPatternIds: string[] } | undefined;
    // pattern-4 is a cover whose extra line holds a date: too short for an ordinary slide.
    const withDate = {
      ...profile,
      compositions: profile.compositions.map((pattern) =>
        pattern.patternId === 'pattern-4'
          ? {
              ...pattern,
              slots: [
                ...pattern.slots,
                {
                  ...lastSlot,
                  slotId: 'date',
                  role: 'body' as const,
                  sample: 'Дата',
                  maxChars: 6,
                },
              ],
            }
          : pattern,
      ),
    };
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent !== 'planner') throw new Error('Only the plan is checked here.');
        planned = input as typeof planned;
        return schema.parse({
          title: 'Deck',
          slides: Array.from({ length: 10 }, (_, index) => ({
            patternId: index === 0 ? planned?.coverPatternIds[0] : 'pattern-1',
            purpose: `Point ${index}`,
            imageQuery: '',
          })),
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
      notes: [
        note('pattern-3', { kind: 'cover', special: true, useFor: 'co-branded cover' }),
        note('pattern-4', { kind: 'cover', useFor: 'title, subtitle and date' }),
      ],
    });
    await (
      await workflow.createRun()
    ).start({
      inputData: { brief: 'Point', slideCount: 10, profile: withDate },
    });
    expect(planned?.coverPatternIds).toEqual(['pattern-4']);
    expect(planned?.catalog.map((item) => item.patternId)).toContain('pattern-4');
  });
});
