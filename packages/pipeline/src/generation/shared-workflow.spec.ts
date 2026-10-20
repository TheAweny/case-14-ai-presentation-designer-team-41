import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { generationProfileSchema } from '@lct/contracts';
import { createGenerationWorkflow, SharedContent, SharedPlan, writerSlots } from './workflow.js';
import { CheckpointTextProvider, TaskCheckpoints } from './checkpoints.js';
import type { TextProvider } from './provider.js';

const original = generationProfileSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
      'utf8',
    ),
  ).valid[0].payload,
);
const pattern = original.compositions[0];
if (!pattern) throw new Error('Missing fixture composition');
const profile = { ...original, compositions: [pattern] };
let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('shared content through actual generation workflows', () => {
  it.each(
    [5, 10, 15].flatMap((count) => [
      { count, approved: false },
      { count, approved: true },
    ]),
  )(
    'writes $count slides once (approved=$approved) and retains every number and unit',
    async ({ count, approved }) => {
      const calls: string[] = [];
      const provider: TextProvider = {
        model: 'fake',
        async generate<T>(
          agent: string,
          _instructions: string,
          input: unknown,
          schema: z.ZodType<T>,
        ) {
          calls.push(agent);
          if (agent === 'planner')
            return schema.parse({
              title: 'Пилот',
              slides: Array.from({ length: count }, () => ({
                patternId: pattern.patternId,
                purpose: 'Рост 18 % за 2026 год',
                imageQuery: '',
              })),
            });
          const index = (input as { index: number }).index;
          return schema.parse({
            patternId: pattern.patternId,
            textsBySlot: Object.fromEntries(
              writerSlots(pattern).map((slot) => [
                slot.slotId,
                `Рост 18 % за 2026 год: ${index + 1}`,
              ]),
            ),
            speakerNotes: 'Источник: отчёт. Пилот, без экстраполяции.',
          });
        },
      };
      const sharedPlan = new SharedPlan();
      const sharedContent = new SharedContent();
      const results = await Promise.all(
        (['dense', 'balanced', 'airy'] as const).map(async (variant) => {
          const workflow = createGenerationWorkflow({
            provider,
            sharedPlan,
            sharedContent,
            variantCopyMode: 'shared',
            variant,
            plannerInstructions: '',
            writerInstructions: '',
            repairInstructions: '',
            signal: new AbortController().signal,
          });
          return (await workflow.createRun()).start({
            inputData: {
              brief: 'Рост 18 % за 2026 год',
              slideCount: approved ? null : count,
              profile,
              ...(approved
                ? {
                    outline: {
                      title: 'Пилот',
                      audience: '',
                      goal: '',
                      slides: Array.from({ length: count }, () => ({
                        title: 'Рост 18 % за 2026 год',
                        points: ['Пилот, без экстраполяции.'],
                        kind: 'statement' as const,
                      })),
                    },
                  }
                : {}),
            },
          });
        }),
      );
      expect(calls.filter((agent) => agent === 'planner')).toHaveLength(1);
      expect(calls.filter((agent) => agent === 'writer')).toHaveLength(count);
      for (const result of results) {
        expect(result.status).toBe('success');
        if (result.status !== 'success') throw new Error('workflow failed');
        expect(result.result).toHaveLength(count);
        for (const item of result.result) {
          expect(item.slide.texts.map((text) => text.text).join(' ')).toContain('18 % за 2026 год');
          expect(item.slide.speakerNotes).toContain('без экстраполяции');
        }
      }
    },
  );

  it('replays accepted tasks on a fresh workflow after a failure at slide 8', async () => {
    root = await mkdtemp(join(tmpdir(), 'workflow-resume-'));
    const sends: string[] = [];
    let fail = true;
    const provider: TextProvider = {
      model: 'fake',
      async generate<T>(
        agent: string,
        _instructions: string,
        input: unknown,
        schema: z.ZodType<T>,
      ) {
        const index = (input as { index?: number }).index;
        sends.push(`${agent}:${index ?? ''}`);
        if (agent === 'planner')
          return schema.parse({
            title: 'Пилот',
            slides: Array.from({ length: 10 }, () => ({
              patternId: pattern.patternId,
              purpose: 'Рост 18 %',
              imageQuery: '',
            })),
          });
        if (agent === 'writer' && index === 7 && fail) throw new Error('simulated crash');
        return schema.parse({
          patternId: pattern.patternId,
          textsBySlot: Object.fromEntries(
            writerSlots(pattern).map((slot) => [slot.slotId, 'Рост 18 %']),
          ),
          speakerNotes: '',
        });
      },
    };
    const execute = async () => {
      const durable = new CheckpointTextProvider(
        provider,
        new TaskCheckpoints(root, 'immutable-spec'),
      );
      const workflow = createGenerationWorkflow({
        provider: durable,
        plannerInstructions: '',
        writerInstructions: '',
        concurrency: 1,
        signal: new AbortController().signal,
      });
      return (await workflow.createRun()).start({
        inputData: { brief: 'Рост 18 %', slideCount: 10, profile },
      });
    };
    expect((await execute()).status).toBe('failed');
    fail = false;
    expect((await execute()).status).toBe('success');
    expect(sends.filter((id) => id === 'planner:')).toHaveLength(1);
    for (let index = 0; index < 7; index++)
      expect(sends.filter((id) => id === `writer:${index}`)).toHaveLength(1);
    expect(sends.filter((id) => id === 'writer:7')).toHaveLength(2);
  });
});
