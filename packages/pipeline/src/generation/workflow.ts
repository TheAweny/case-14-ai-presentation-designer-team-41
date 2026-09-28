import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import {
  composedSlideSchema,
  compositionPlanSchema,
  templateSlotCopySchema,
  slotRewriteChoicesSchema,
  compositionSchema,
  generationProfileSchema,
  type ComposedSlide,
  type GenerationProfile,
} from '@lct/contracts';
import type { TextProvider } from './provider.js';
export { compositionPlanSchema, compositionCritiqueSchema as critiqueSchema } from '@lct/contracts';

export interface GenerationDependencies {
  provider: TextProvider;
  plannerInstructions: string;
  writerInstructions: string;
  repairInstructions?: string;
  signal: AbortSignal;
  concurrency?: number;
  onProgress?: (done: number, total: number) => Promise<void>;
}
const inputSchema = z.object({
  brief: z.string(),
  slideCount: z.number().int().min(10).max(15).nullable(),
  profile: generationProfileSchema,
});
const taskSchema = z.object({
  narrative: z.array(z.string()).default([]),
  index: z.number(),
  total: z.number(),
  title: z.string(),
  brief: z.string(),
  purpose: z.string(),
  imageQuery: z.string(),
  composition: compositionSchema,
});
export const writtenSchema = z.object({
  index: z.number(),
  title: z.string(),
  slide: composedSlideSchema,
  imageQuery: z.string(),
});

function boundedSlideSchema(pattern: GenerationProfile['compositions'][number]) {
  return templateSlotCopySchema.extend({
    patternId: z.literal(pattern.patternId),
    textsBySlot: z.object(
      Object.fromEntries(
        pattern.slots.map((slot) => [slot.slotId, z.string().min(slot.role === 'title' ? 1 : 0)]),
      ),
    ),
    speakerNotes: z.string(),
  });
}

function writingComposition(pattern: GenerationProfile['compositions'][number]) {
  return {
    patternId: pattern.patternId,
    slots: pattern.slots.map(({ sample: _sample, ...slot }) => slot),
  };
}

export function createGenerationWorkflow(deps: GenerationDependencies) {
  let completed = 0;
  const plan = createStep({
    id: 'plan-compositions',
    inputSchema,
    outputSchema: z.array(taskSchema),
    execute: async ({ inputData }) => {
      const spacious = inputData.profile.compositions.filter(
        (p) =>
          p.slots.some((s) => s.role === 'title' && s.maxChars >= 25) &&
          p.slots.every((s) => s.maxChars >= 12),
      );
      const catalog = spacious.length ? spacious : inputData.profile.compositions;
      const titleSizes = catalog
        .flatMap((p) => p.slots.filter((s) => s.role === 'title').map((s) => s.fontSize))
        .sort((a, b) => a - b);
      const typicalTitle = titleSizes[Math.floor(titleSizes.length / 2)] ?? 24;
      const covers = catalog.filter(
        (p) =>
          p.slots.length <= 3 &&
          p.slots.some((s) => s.role === 'title' && s.fontSize > typicalTitle),
      );
      const plan = (
        corrections?: Record<string, unknown>,
        previous?: z.infer<typeof compositionPlanSchema>,
      ) =>
        deps.provider.generate(
          'planner',
          deps.plannerInstructions,
          {
            brief: inputData.brief,
            slideCount: inputData.slideCount,
            catalog,
            coverPatternIds: covers.map((p) => p.patternId),
            ...(previous ? { previous } : {}),
            ...(corrections ? { corrections } : {}),
          },
          compositionPlanSchema,
          deps.signal,
        );
      const countCorrections = (result: z.infer<typeof compositionPlanSchema>) =>
        inputData.slideCount === null || result.slides.length === inputData.slideCount
          ? undefined
          : {
              exactSlideCount: inputData.slideCount,
              returnedSlideCount: result.slides.length,
              message: 'Return exactly exactSlideCount slides.',
            };
      const coverCorrections = (result: z.infer<typeof compositionPlanSchema>) =>
        result.slides.length > 1 &&
        covers.length &&
        !covers.some((p) => p.patternId === result.slides[0]?.patternId)
          ? { firstSlidePatternMustBeOneOf: covers.map((p) => p.patternId) }
          : undefined;
      let result: z.infer<typeof compositionPlanSchema>;
      try {
        result = await plan();
      } catch {
        result = await plan({
          minimumSlideCount: 10,
          exactSlideCount: inputData.slideCount,
          message: 'Return 10 to 60 slides in auto mode, or exactly the requested count.',
        });
      }
      const corrections = { ...countCorrections(result), ...coverCorrections(result) };
      if (Object.keys(corrections).length) result = await plan(corrections, result);
      if (inputData.slideCount !== null && result.slides.length !== inputData.slideCount)
        throw new Error('Planner returned the wrong slide count.');
      if (coverCorrections(result)) throw new Error('Planner did not select a cover composition.');
      return result.slides.map((slide, index) => {
        const composition = inputData.profile.compositions.find(
          (p) => p.patternId === slide.patternId,
        );
        if (!composition) throw new Error('Planner selected an unknown template composition.');
        return {
          ...slide,
          narrative: result.slides.map((s) => s.purpose),
          index,
          total: result.slides.length,
          title: result.title,
          brief: inputData.brief,
          composition,
        };
      });
    },
  });
  const write = createStep({
    id: 'write-template-slide',
    inputSchema: taskSchema,
    outputSchema: writtenSchema,
    execute: async ({ inputData }) => {
      let slide: ComposedSlide | undefined;
      let problems: string[] = [];
      const raw = await deps.provider.generate(
        'writer',
        deps.writerInstructions,
        {
          ...inputData,
          composition: writingComposition(inputData.composition),
        },
        boundedSlideSchema(inputData.composition),
        deps.signal,
      );
      slide = {
        patternId: raw.patternId,
        speakerNotes: raw.speakerNotes,
        texts: Object.entries(raw.textsBySlot).map(([slotId, text]) => ({ slotId, text })),
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        problems = validateBindings(slide, inputData.composition);
        if (!problems.length) break;
        slide = await rewriteSlide(deps, {
          index: inputData.index,
          brief: inputData.brief,
          composition: inputData.composition,
          previous: slide,
          corrections: inputData.composition.slots
            .filter((slot) => {
              const text = slide?.texts.find((t) => t.slotId === slot.slotId)?.text ?? '';
              return (
                text.length > slot.maxChars ||
                text.split('\n').length > slot.maxLines ||
                (slot.role === 'title' && !text.trim())
              );
            })
            .map((slot) => ({
              slotId: slot.slotId,
              message: `Maximum ${slot.maxChars} characters and ${slot.maxLines} lines.`,
            })),
        });
        problems = validateBindings(slide, inputData.composition);
      }
      if (!slide || problems.length)
        throw new Error(`Slide ${inputData.index + 1}: ${problems.join('; ')}`);
      completed++;
      await deps.onProgress?.(completed, inputData.total);
      return {
        index: inputData.index,
        title: inputData.title,
        slide,
        imageQuery: inputData.imageQuery,
      };
    },
  });
  return createWorkflow({
    id: 'generate-template-deck',
    inputSchema,
    outputSchema: z.array(writtenSchema),
  })
    .then(plan)
    .foreach(write, { concurrency: Math.max(1, Math.min(6, deps.concurrency ?? 3)) })
    .commit();
}
export function validateBindings(
  slide: ComposedSlide,
  pattern: GenerationProfile['compositions'][number],
): string[] {
  const errors: string[] = [];
  if (slide.patternId !== pattern.patternId) errors.push('Use the selected patternId');
  if (
    slide.texts.length !== pattern.slots.length ||
    new Set(slide.texts.map((t) => t.slotId)).size !== slide.texts.length
  )
    errors.push('Bind every slot exactly once');
  for (const slot of pattern.slots) {
    const binding = slide.texts.find((t) => t.slotId === slot.slotId);
    if (!binding) errors.push(`Missing slot ${slot.slotId}`);
    else if (slot.role === 'title' && !binding.text.trim())
      errors.push(`Title ${slot.slotId} must not be empty`);
    else if (binding.text.length > slot.maxChars || binding.text.split('\n').length > slot.maxLines)
      errors.push(
        `Shorten slot ${slot.slotId} to <= ${slot.maxChars} chars and ${slot.maxLines} lines`,
      );
  }
  return errors;
}

export const repairTaskSchema = z.object({
  index: z.number(),
  brief: z.string(),
  composition: compositionSchema,
  previous: composedSlideSchema,
  corrections: z.array(z.object({ slotId: z.string(), message: z.string() })),
});
export const repairedSlideSchema = z.object({ index: z.number(), slide: composedSlideSchema });

export function createRepairWorkflow(deps: GenerationDependencies) {
  const start = createStep({
    id: 'repair-input',
    inputSchema: z.array(repairTaskSchema),
    outputSchema: z.array(repairTaskSchema),
    execute: async ({ inputData }) => inputData,
  });
  const repair = createStep({
    id: 'repair-template-slide',
    inputSchema: repairTaskSchema,
    outputSchema: repairedSlideSchema,
    execute: async ({ inputData }) => {
      const slide = await rewriteSlide(deps, inputData);
      const problems = validateBindings(slide, inputData.composition);
      if (problems.length) throw new Error(`Repair ${inputData.index + 1}: ${problems.join('; ')}`);
      return { index: inputData.index, slide };
    },
  });
  return createWorkflow({
    id: 'repair-template-deck',
    inputSchema: z.array(repairTaskSchema),
    outputSchema: z.array(repairedSlideSchema),
  })
    .then(start)
    .foreach(repair, { concurrency: deps.concurrency ?? 3 })
    .commit();
}

async function rewriteSlide(
  deps: GenerationDependencies,
  task: z.infer<typeof repairTaskSchema>,
): Promise<ComposedSlide> {
  const slots = task.composition.slots.filter((s) =>
    task.corrections.some((c) => c.slotId === s.slotId),
  );
  if (!slots.length) return task.previous;
  const schema = slotRewriteChoicesSchema.extend({
    rewrites: z.object(
      Object.fromEntries(slots.map((s) => [s.slotId, z.array(z.string()).length(3)])),
    ),
  });
  const result = await deps.provider.generate(
    'rewriter',
    deps.repairInstructions ?? deps.writerInstructions,
    {
      brief: task.brief,
      slots: slots.map((s) => ({
        slotId: s.slotId,
        role: s.role,
        maxChars: s.maxChars,
        maxLines: s.maxLines,
        text: task.previous.texts.find((t) => t.slotId === s.slotId)?.text,
        correction: task.corrections
          .filter((c) => c.slotId === s.slotId)
          .map((c) => c.message)
          .join('; '),
      })),
    },
    schema,
    deps.signal,
  );
  const slide = { ...task.previous, texts: task.previous.texts.map((t) => ({ ...t })) };
  for (const slot of slots) {
    const alternatives = result.rewrites[slot.slotId] ?? [];
    const text = alternatives
      .filter(
        (t) =>
          t.length <= slot.maxChars &&
          t.split('\n').length <= slot.maxLines &&
          (slot.role !== 'title' || t.trim()),
      )
      .sort((a, b) => b.length - a.length)[0];
    if (text === undefined)
      throw new Error(
        `No complete rewrite fits slot ${slot.slotId} (${slot.maxChars} chars; alternatives: ${alternatives.map((t) => t.length).join(',')}).`,
      );
    const binding = slide.texts.find((t) => t.slotId === slot.slotId);
    if (binding) binding.text = text;
  }
  return slide;
}
