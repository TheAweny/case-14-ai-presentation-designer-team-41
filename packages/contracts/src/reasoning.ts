import { z } from 'zod';

/**
 * How deep a model may think, for servers that accept `reasoning_effort`.
 * Qwen thinking is a different switch and has no such levels.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

const QWEN3 = /(?:^|[^a-z0-9])qwen3(?:[.:-]|$)/i;
const QWEN_WITHOUT_THINKING = /instruct[-_:]?2507|qwen3[-_:]vl.*instruct/i;
/** gpt-oss, GPT-5 and the o-series. A plain GPT chat model does not take this field. */
const EFFORT_MODEL =
  /gpt-oss|(?:^|[^a-z0-9])gpt-5|(?:^|[^a-z0-9])o[134](?:-[a-z0-9]+)*(?:[^a-z0-9]|$)/i;

/**
 * What the composer may offer. `effort` — a depth slider that becomes `reasoning_effort`.
 * `thinking` — Qwen hybrids, already asked to think, with no depth control.
 * `none` — leave the server's own defaults alone.
 */
export function reasoningControl(modelId: string): 'effort' | 'thinking' | 'none' {
  const id = modelId.trim();
  if (EFFORT_MODEL.test(id)) return 'effort';
  if (QWEN3.test(id) && !QWEN_WITHOUT_THINKING.test(id)) return 'thinking';
  return 'none';
}
