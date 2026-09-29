import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema, type CompositionNote } from '@lct/contracts';
import { indexTemplate, settleNotes, templateIndexRevision } from './indexer.js';
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
  skip: false,
  special: false,
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
    const notes = await indexTemplate({
      provider,
      instructions: '',
      profile,
      signal: AbortSignal.timeout(1000),
    });
    expect(asked).toEqual([profile.compositions.map((c) => c.patternId), ['pattern-2']]);
    expect(notes).toHaveLength(5);
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

  it('holds the counts to what the composition can show', () => {
    const blocks = first.slots.filter((slot) => slot.role !== 'title').length;
    const [cover, cards] = settle([
      answer('pattern-0', { kind: 'cover', items: 4 }),
      answer('pattern-1', { kind: 'cards', items: 12 }),
    ]);
    expect(cover?.items).toBe(1);
    expect(cards?.items).toBeLessThanOrEqual(Math.max(blocks, 1));
  });
});

describe('planning with template notes', () => {
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
      ],
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief: 'Point', slideCount: 10, profile } });
    expect(result.status).toBe('success');
    expect(catalog.map((item) => item.patternId)).not.toContain('pattern-0');
    expect(catalog.find((item) => item.patternId === 'pattern-1')).toMatchObject({
      kind: 'cards',
      useFor: 'three parallel points',
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
