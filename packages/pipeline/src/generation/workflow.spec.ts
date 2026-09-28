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
    { brief: 'Short', count: 10 },
    { brief: 'Detailed', count: 23 },
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
  it('asks the planner once more when a manual count is wrong', async () => {
    let plannerCalls = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent !== 'planner')
          return schema.parse({
            patternId: composition.patternId,
            textsBySlot: { '2': 'Point' },
            speakerNotes: '',
          });
        plannerCalls += 1;
        if (plannerCalls === 2)
          expect(input).toMatchObject({
            previous: expect.objectContaining({ slides: expect.any(Array) }),
            corrections: { exactSlideCount: 12, returnedSlideCount: 10 },
          });
        return schema.parse({
          title: 'Wrong count',
          slides: Array.from({ length: plannerCalls === 1 ? 10 : 12 }, (_, index) => ({
            patternId: composition.patternId,
            purpose: `Point ${index + 1}`,
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
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief: 'Twelve', slideCount: 12, profile } });
    expect(result.status).toBe('success');
    expect(plannerCalls).toBe(2);
  });
  it('retries auto mode when the planner returns fewer than 10 slides', async () => {
    let plannerCalls = 0;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        _input: unknown,
        schema: z.ZodType<T>,
      ) {
        if (agent !== 'planner')
          return schema.parse({
            patternId: composition.patternId,
            textsBySlot: { '2': 'Point' },
            speakerNotes: '',
          });
        plannerCalls += 1;
        return schema.parse({
          title: 'Auto',
          slides: Array.from({ length: plannerCalls === 1 ? 2 : 10 }, (_, index) => ({
            patternId: composition.patternId,
            purpose: `Point ${index + 1}`,
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
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief: 'Auto', slideCount: null, profile } });
    expect(result.status).toBe('success');
    expect(plannerCalls).toBe(2);
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
            slides: Array.from({ length: 10 }, (_, i) => ({
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
    const result = await run.start({ inputData: { brief: 'Test brief', slideCount: 10, profile } });
    expect(result.status).toBe('success');
    expect(peak).toBe(2);
    if (result.status === 'success')
      expect(result.result.map((s) => s.index).sort()).toEqual(
        Array.from({ length: 10 }, (_, i) => i),
      );
  });
  it('fails if the planner selects a composition outside the template', async () => {
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(_a: string, _i: string, _input: unknown, schema: z.ZodType<T>) {
        return schema.parse({
          title: 'Test',
          slides: Array.from({ length: 10 }, () => ({
            patternId: 'invented',
            purpose: 'Test',
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
    });
    const run = await workflow.createRun();
    const result = await run.start({ inputData: { brief: 'Test', slideCount: 10, profile } });
    expect(result.status).toBe('failed');
  });
});
