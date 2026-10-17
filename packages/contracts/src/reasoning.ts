import { z } from 'zod';

/**
 * How deep a model may think, for servers that accept `reasoning_effort`.
 * Qwen thinking is a different switch and has no such levels.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

const QWEN3 = /(?:^|[^a-z0-9])qwen3(?:[.:-]|$)/i;
/**
 * Qwen3.8, including the final alias `qwen38-27b-fp8`. The next character is `8`
 * or `.8`, so this must stay separate from `QWEN3`: that hybrid path asks the
 * model to think. Request fields force this checkpoint's thinking off.
 */
const QWEN38 = /(?:^|[^a-z0-9])qwen3(?:\.8|8)(?![a-z0-9])/i;
const QWEN_WITHOUT_THINKING = /instruct[-_:]?2507|qwen3[-_:]vl.*instruct/i;
/** gpt-oss, GPT-5 and the o-series. A plain GPT chat model does not take this field. */
const EFFORT_MODEL =
  /gpt-oss|(?:^|[^a-z0-9])gpt-5|(?:^|[^a-z0-9])o[134](?:-[a-z0-9]+)*(?:[^a-z0-9]|$)/i;

/**
 * What the composer may offer. `effort` — a depth slider that becomes `reasoning_effort`.
 * `thinking` — Qwen3 hybrids other than Qwen3.8, already asked to think, with no depth control.
 * `none` — no slider. Qwen3.8 is recognized here so it does not take the hybrid path;
 * its requests force thinking off. Every other `none` leaves the server defaults alone.
 */
export function reasoningControl(modelId: string): 'effort' | 'thinking' | 'none' {
  const id = modelId.trim();
  if (EFFORT_MODEL.test(id)) return 'effort';
  if (QWEN38.test(id)) return 'none';
  if (QWEN3.test(id) && !QWEN_WITHOUT_THINKING.test(id)) return 'thinking';
  return 'none';
}
