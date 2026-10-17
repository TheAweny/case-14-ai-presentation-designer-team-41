import { z } from 'zod';

/**
 * How deep a model may think, for servers that accept `reasoning_effort`.
 * Qwen thinking is a different switch and has no such levels.
 */
export const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;
export const reasoningEffortSchema = z.enum(REASONING_EFFORTS);
export type ReasoningEffort = z.infer<typeof reasoningEffortSchema>;

/**
 * What a model lets the person choose about thinking. `/models` returns names only, so this is
 * read from the name, as a family is.
 *
 * - `thinking` — Qwen3 hybrids: thinking on or off through `enable_thinking`, no depth.
 * - `hybrid` — answers with or without thinking, and with a depth when it thinks:
 *   `reasoning_effort` asks for it, leaving the field out answers at once (GPT-5.1 and later,
 *   Claude 3.7 and 4+, Gemini Flash 2.5 and later).
 * - `effort` — always thinks; only the depth is a choice (gpt-oss, GPT-5, the o-series,
 *   Gemini Pro, Grok 3 mini).
 * - `none` — leave the server's own defaults alone.
 */
export type ReasoningControl = 'thinking' | 'hybrid' | 'effort' | 'none';

/** `qwen3`, `qwen3.5`, `qwen38` (VK AI Space's Qwen 3.8), `qwen3-8b`: not `qwen2.5`. */
const QWEN3 = /(?:^|[^a-z0-9])qwen3(?:\d|[.:_-]|$)/i;
/** Instruct checkpoints never think, Thinking checkpoints always do, Coder is an instruct model. */
const QWEN_FIXED = /instruct|thinking|coder/i;
const GPT_OSS = /gpt-oss/i;
/** GPT-5.1, GPT-5.2, GPT-6, GPT-6.1…: reasoning can be switched off with the field left out. */
const GPT_HYBRID = /(?:^|[^a-z0-9])gpt-(?:5\.\d|[6-9]|\d{2})/i;
/** GPT-5, GPT-5 mini and nano: they always reason. */
const GPT_5 = /(?:^|[^a-z0-9])gpt-5(?!\.\d)/i;
const O_SERIES = /(?:^|[^a-z0-9])o[134](?:-[a-z0-9]+)*(?:[^a-z0-9]|$)/i;
const GROK_MINI = /grok-3-mini/i;

/** The first version after a family name: `claude-3-7-sonnet` → [3, 7], `claude-sonnet-4.5` → [4, 5]. */
function versionAfter(id: string, family: string): readonly [number, number] | null {
  const match = new RegExp(`${family}\\D*?(\\d+)(?:[-._](\\d)(?!\\d))?`, 'i').exec(id);
  if (!match?.[1]) return null;
  return [Number(match[1]), Number(match[2] ?? 0)];
}

const atLeast = (version: readonly [number, number] | null, major: number, minor: number) =>
  version !== null && (version[0] > major || (version[0] === major && version[1] >= minor));

export function reasoningControl(modelId: string): ReasoningControl {
  const id = modelId.trim();
  if (QWEN3.test(id)) return QWEN_FIXED.test(id) ? 'none' : 'thinking';
  if (GPT_OSS.test(id)) return 'effort';
  if (GPT_HYBRID.test(id)) return 'hybrid';
  if (GPT_5.test(id) || O_SERIES.test(id)) return 'effort';
  if (/claude/i.test(id)) return atLeast(versionAfter(id, 'claude'), 3, 7) ? 'hybrid' : 'none';
  if (/gemini/i.test(id)) {
    if (!atLeast(versionAfter(id, 'gemini'), 2, 5)) return 'none';
    return /pro/i.test(id) ? 'effort' : 'hybrid';
  }
  if (GROK_MINI.test(id)) return 'effort';
  return 'none';
}

/** The model can answer both with and without thinking: the composer offers the switch. */
export function canSwitchThinking(control: ReasoningControl): boolean {
  return control === 'thinking' || control === 'hybrid';
}
