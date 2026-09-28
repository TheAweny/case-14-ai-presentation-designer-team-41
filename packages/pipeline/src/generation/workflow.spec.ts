import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema } from '@lct/contracts';
import { createGenerationWorkflow, validateBindings } from './workflow.js';
import type { TextProvider } from './provider.js';

const fixture = JSON.parse(
  readFileSync(
    new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
);
const profile = generationProfileSchema.parse(fixture.valid[0].payload);
const composition = profile.compositions[0];
if (!composition) throw new Error('Fixture has no composition.');

describe('template generation workflow', () => {
  it.each([
    { brief: 'Short', count: 3 },
    { brief: 'Detailed', count: 8 },
  ])('lets the planner size auto mode from $brief context', async ({ brief, count }) => {
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner') {
          expect(input).toMatchObject({ brief, slideCount: null });
          return schema.parse({
            title: 'Auto',
            slides: Array.from({ length: count }, (_, index) => ({
              patternId: composition.patternId,
              purpose: 'Point ' + index,
              imageQuery: '',
            })),
          });
        }
        return schema.parse({
          patternId: composition.patternId,
          textsBySlot: { '2': 'Point' },
          speakerNotes: '',
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief, slideCount: null, profile } });
    expect(result.status).toBe('success');
    if (result.status === 'success') expect(result.result).toHaveLength(count);
  });
  it('keeps an explicit count mandatory', async () => {
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        _agent: string,
        _instructions: string,
        _input: unknown,
        schema: z.ZodType<T>,
      ) {
        return schema.parse({
          title: 'Wrong count',
          slides: [{ patternId: composition.patternId, purpose: 'Only one', imageQuery: '' }],
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief: 'Two', slideCount: 2, profile } });
    expect(result.status).toBe('failed');
  });
  it('detects over-capacity and missing slot bindings', () => {
    expect(
      validateBindings(
        { patternId: composition.patternId, texts: [], speakerNotes: '' },
        composition,
      ),
    ).not.toHaveLength(0);
    expect(
      validateBindings(
        {
          patternId: composition.patternId,
          texts: [{ slotId: '2', text: 'x'.repeat(1000) }],
          speakerNotes: '',
        },
        composition,
      ),
    ).not.toHaveLength(0);
  });
  it('writes slides concurrently through Mastra with a bounded fanout', async () => {
    let active = 0;
    let peak = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent === 'planner')
          return schema.parse({
            title: 'Test',
            slides: Array.from({ length: 4 }, (_, i) => ({
              patternId: composition.patternId,
              purpose: `Slide ${i}`,
              imageQuery: '',
            })),
          });
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active--;
        const task = input as { purpose: string };
        return schema.parse({
          patternId: composition.patternId,
          textsBySlot: { '2': task.purpose },
          speakerNotes: '',
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
      concurrency: 2,
    });
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { brief: 'Test brief', slideCount: 4, profile } });
    expect(result.status).toBe('success');
    expect(peak).toBe(2);
    if (result.status === 'success')
      expect(result.result.map((s) => s.index).sort()).toEqual([0, 1, 2, 3]);
  });
  it('fails if the planner selects a composition outside the template', async () => {
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(_a: string, _i: string, _input: unknown, schema: z.ZodType<T>) {
        return schema.parse({
          title: 'Test',
          slides: [{ patternId: 'invented', purpose: 'Test', imageQuery: '' }],
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      signal: AbortSignal.timeout(10000),
    });
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { brief: 'Test', slideCount: 1, profile } });
    expect(result.status).toBe('failed');
  });
});
