import { z } from 'zod';

/**
 * How deep a model may think, for servers that accept `reasoning_effort`.
 * Qwen thinking is a different switch and has no such levels.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/**
 * What a model lets the person choose about thinking, as the API learnt it by asking the model
 * (`apps/api/src/models/capability-probe.ts`), never from its name.
 *
 * `toggle` — how thinking is switched on and off, when the model answers both ways:
 * `enable-thinking` through `chat_template_kwargs` (Qwen3 hybrids on vLLM and the like), or
 * `reasoning-effort`: a depth to think, `none` to answer at once. Null: it cannot be switched,
 * the model always or never thinks.
 *
 * `levels` — the provider reads `reasoning_effort` (it refuses a value that does not exist) and
 * the model thinks, so the depth reaches the model.
 */
export const reasoningCapabilitySchema = z.object({
  toggle: z.enum(['enable-thinking', 'reasoning-effort']).nullable(),
  levels: z.boolean(),
});
export type ReasoningCapability = z.infer<typeof reasoningCapabilitySchema>;

/** A model nothing is known about, or one that offers no choice: the server's defaults stand. */
export const NO_REASONING_CHOICE: ReasoningCapability = { toggle: null, levels: false };

/** The answer of `GET /model-settings/capabilities`: what one model offers. */
export const modelCapabilitiesSchema = z.object({
  reasoning: reasoningCapabilitySchema,
  /** False while the model has not been probed yet or the probe could not finish. */
  probed: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
