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
      requiredClaims: z.array(z.unknown()).default([]),
      groups: z
        .array(
          z.object({
            id: z.string(),
            kind: z.string(),
            slotIds: z.array(z.string()),
            order: z.number().optional(),
          }),
        )
        .default([]),
      speakerNotes: z.string(),
      visual: z.unknown(),
      texts: z.array(
        z.object({
          slotId: z.string(),
          text: z.string(),
          role: z.string().optional(),
          semanticRole: z.string().optional(),
          groupId: z.string().optional(),
        }),
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
      const groupIds = new Map(slide.groups.map((group, index) => [group.id, `group-${index}`]));
      const order = (id?: string) => (id ? slide.groups.findIndex((group) => group.id === id) : -1);
      const ambiguous =
        slide.texts.length > 1 &&
        slide.texts.some((text) => !text.semanticRole || text.semanticRole === 'unknown');
      const texts = [...slide.texts].sort(
        (a, b) =>
          order(a.groupId) - order(b.groupId) ||
          (a.semanticRole ?? a.role ?? '').localeCompare(b.semanticRole ?? b.role ?? '') ||
          (ambiguous ? a.slotId.localeCompare(b.slotId) : a.text.localeCompare(b.text)),
      );
      const visual = slide.visual as { kind?: string; slotId?: string; block?: unknown } | null;
      const canonicalIds = new Map(texts.map((text, index) => [text.slotId, `semantic-${index}`]));
      return {
        slideIndex: slide.slideIndex,
        approvedSlide: slide.approvedSlide,
        requiredClaims: slide.requiredClaims,
        groups: slide.groups.map((group, index) => ({
          id: `group-${index}`,
          kind: group.kind,
          order: index,
          slotIds: group.slotIds.map((id) => canonicalIds.get(id) ?? id).sort(),
        })),
        speakerNotes: slide.speakerNotes,
        visual: visual
          ? { ...visual, slotId: canonicalIds.get(visual.slotId ?? '') ?? visual.slotId }
          : null,
        texts: texts.map((text, i) => {
          const slotId = `semantic-${i}`;
          bindings.set(`${slide.slideIndex}:${slotId}`, text.slotId);
          return {
            slotId,
            text: text.text,
            role: text.role ?? 'body',
            semanticRole: text.semanticRole ?? 'unknown',
            groupId: groupIds.get(text.groupId ?? '') ?? null,
            ...(ambiguous ? { bindingKey: text.slotId } : {}),
          };
        }),
      };
    });
    const audit = await this.inner.generate(
      agent,
      instructions,
      {
        scope: 'group-semantics-v2',
        auditSchema: z.toJSONSchema(schema),
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
