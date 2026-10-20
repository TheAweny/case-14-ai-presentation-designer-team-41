import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import {
  compositionNoteSchema,
  compositionPlanSchema,
  generationProfileSchema,
} from '@lct/contracts';
import { createGenerationWorkflow, SharedPlan } from './workflow.js';
import type { TextProvider } from './provider.js';

it.each(['independent', 'shared'] as const)(
  'keeps compatible selection in %s mode',
  async (variantCopyMode) => {
    const fixture = JSON.parse(
      await readFile(resolve('../contracts/fixtures/GenerationProfile.json'), 'utf8'),
    );
    const pattern = (patternId: string, body: number) => ({
      patternId,
      sourceIndex: 1,
      name: patternId,
      imageCount: 0,
      slots: [
        {
          slotId: 'title',
          role: 'title',
          sample: 'Заголовок',
          font: 'Inter',
          fontSize: 24,
          maxChars: 40,
          maxLines: 2,
        },
        {
          slotId: 'body',
          role: 'body',
          sample: 'Содержание',
          font: 'Inter',
          fontSize: 18,
          maxChars: body,
          maxLines: 8,
        },
      ],
    });
    const profile = generationProfileSchema.parse({
      ...fixture.valid[0].payload,
      compositions: [
        pattern('tight', 10),
        pattern('ample', 300),
        pattern('special', 250),
        pattern('reference', 250),
      ],
    });
    const notes = profile.compositions.map((p) =>
      compositionNoteSchema.parse({
        patternId: p.patternId,
        kind: p.patternId === 'tight' ? 'cover' : 'list',
        items: 1,
        useFor: 'Факты',
        requiredContent: [],
        special: p.patternId === 'special',
        skip: p.patternId === 'reference',
      }),
    );
    const fact =
      'Выручка составляет 75 млн руб., расходы составляют 61 млн руб.; операционная прибыль — 14 млн руб.';
    const plan = compositionPlanSchema.parse({
      title: 'Итоги',
      audience: 'Команда',
      goal: 'Объяснить',
      slides: Array.from({ length: 5 }, () => ({
        patternId: 'tight',
        purpose: 'Итоги',
        imageQuery: '',
        requiredClaims: [{ id: 'fact', text: fact, source: { sourceId: 'brief', quote: fact } }],
      })),
    });
    const selections: string[] = [];
    const provider: TextProvider = {
      model: 'offline',
      async generate() {
        throw new Error('Writer intentionally not executed');
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      variantCopyMode,
      notes,
      sharedPlan: new SharedPlan(plan),
      plannerInstructions: '',
      writerInstructions: '',
      deckWriterInstructions: 'offline',
      signal: new AbortController().signal,
      onPlan(slides) {
        selections.push(...slides.map((s) => s.composition.patternId));
      },
    });
    await (
      await workflow.createRun()
    ).start({ inputData: { profile, brief: fact, slideCount: 5 } });
    expect(selections).toHaveLength(5);
    expect(selections).toEqual(
      Array.from({ length: 5 }, () => (variantCopyMode === 'independent' ? 'ample' : 'tight')),
    );
    expect(selections).not.toContain('special');
    expect(selections).not.toContain('reference');
  },
);
