import { z } from 'zod';
import { compositionCritiqueSchema } from '@lct/contracts';
import type { TextProvider } from './provider.js';

const inputSchema = z.object({
  brief: z.string(),
  approvedOutline: z.unknown(),
  proposedOutline: z.unknown(),
  slides: z.array(
    z.object({
      slideIndex: z.number(),
      approvedSlide: z.unknown(),
      speakerNotes: z.string(),
      visual: z.unknown(),
      texts: z.array(
        z.object({ slotId: z.string(), text: z.string(), role: z.string().optional() }),
      ),
    }),
  ),
});

/** Share a semantic read of identical facts, while final-file geometry audits remain per variant. */
export class SemanticTextProvider implements TextProvider {
  constructor(private readonly inner: TextProvider) {}
  get model() {
    return this.inner.model;
  }
  get calls() {
    return this.inner.calls ?? [];
  }
  setAgentGeneration(...args: Parameters<NonNullable<TextProvider['setAgentGeneration']>>) {
    this.inner.setAgentGeneration?.(...args);
  }
  async generate<T>(
    agent: string,
    instructions: string,
    input: unknown,
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    if (agent !== 'critic') return this.inner.generate(agent, instructions, input, schema, signal);
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return this.inner.generate(agent, instructions, input, schema, signal);
    const bindings = new Map<string, string>();
    const slides = parsed.data.slides.map((slide) => {
      const texts = [...slide.texts].sort(
        (a, b) => (a.role ?? '').localeCompare(b.role ?? '') || a.text.localeCompare(b.text),
      );
      const visual = slide.visual as { kind?: string; slotId?: string; block?: unknown } | null;
      return {
        slideIndex: slide.slideIndex,
        approvedSlide: slide.approvedSlide,
        speakerNotes: slide.speakerNotes,
        visual: visual?.kind === 'native' ? visual.block : slide.visual,
        texts: texts.map((text, i) => {
          const slotId = `semantic-${i}`;
          bindings.set(`${slide.slideIndex}:${slotId}`, text.slotId);
          return { slotId, text: text.text, role: text.role ?? 'body' };
        }),
      };
    });
    const audit = await this.inner.generate(
      agent,
      instructions,
      {
        scope: 'shared-semantics',
        brief: parsed.data.brief,
        approvedOutline: parsed.data.approvedOutline,
        proposedOutline: parsed.data.proposedOutline,
        slides,
      },
      compositionCritiqueSchema,
      signal,
    );
    return schema.parse({
      ...audit,
      issues: audit.issues.map((issue) => {
        const slotId = bindings.get(`${issue.slideIndex}:${issue.slotId}`);
        if (!slotId) throw new Error('Semantic audit selected an unknown content slot.');
        return { ...issue, slotId };
      }),
    });
  }
}
