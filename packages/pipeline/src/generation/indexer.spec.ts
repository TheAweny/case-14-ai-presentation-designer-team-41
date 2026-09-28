import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema, type CompositionNote } from '@lct/contracts';
import { indexTemplate, templateIndexRevision } from './indexer.js';
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

  it('changes its revision when the instructions change', () => {
    expect(templateIndexRevision('1.0.0', 'a')).not.toBe(templateIndexRevision('1.0.0', 'b'));
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
});
