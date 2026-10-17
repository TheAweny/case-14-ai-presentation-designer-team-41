import { z } from 'zod';

/**
 * Families a model picker can filter by. A family is a name pattern, not a capability: `/models`
 * returns ids only. The first matching pattern wins, so a path or vendor prefix does not hide the
 * model name (`openai/gpt-4o-mini` is GPT). A protocol prefix is not a family: `gpt://folder/qwen3/latest` is Qwen, so the GPT pattern is the last one.
 */
export const MODEL_FAMILIES = [
  'gpt',
  'claude',
  'gemini',
  'qwen',
  'llama',
  'deepseek',
  'mistral',
  'grok',
  'command',
  'phi',
  'gemma',
  'yi',
  'other',
] as const;
export const modelFamilySchema = z.enum(MODEL_FAMILIES);
export type ModelFamily = z.infer<typeof modelFamilySchema>;

/** Named families, in picker order. `other` is everything that matched none of them. */
const FAMILY_PATTERNS: readonly {
  readonly family: Exclude<ModelFamily, 'other'>;
  readonly pattern: RegExp;
}[] = [
  { family: 'claude', pattern: /claude/i },
  { family: 'gemini', pattern: /gemini/i },
  { family: 'qwen', pattern: /qwen/i },
  { family: 'llama', pattern: /llama/i },
  { family: 'deepseek', pattern: /deepseek/i },
  {
    family: 'mistral',
    pattern: /(?:^|[^a-z0-9])(?:mistral|mixtral|pixtral|codestral)(?:[^a-z0-9]|$)/i,
  },
  { family: 'grok', pattern: /grok/i },
  { family: 'command', pattern: /(?:^|[^a-z0-9])command(?:[^a-z0-9]|$)/i },
  { family: 'phi', pattern: /(?:^|[^a-z0-9])phi(?:[^a-z0-9]|$)/i },
  { family: 'gemma', pattern: /gemma/i },
  { family: 'yi', pattern: /(?:^|[^a-z0-9])yi(?:[^a-z0-9]|$)/i },
  // Last: a gpt:// prefix is a protocol, not the family.
  { family: 'gpt', pattern: /(?:^|[^a-z0-9])(?:gpt|chatgpt|o[134])(?:[^a-z0-9]|$)/i },
];

/** The family of a model id. Unknown and empty names are `other`. */
export function modelFamily(modelId: string): ModelFamily {
  const id = modelId.trim();
  for (const { family, pattern } of FAMILY_PATTERNS) {
    if (pattern.test(id)) return family;
  }
  return 'other';
}

/**
 * Which of the reported models a connection offers. `null` means every reported model: a
 * connection that has never limited its list stays unlimited. A list keeps only those ids, in the
 * order the server reported them.
 */
export function enabledModelIds(
  reported: readonly string[],
  enabled: readonly string[] | null,
): readonly string[] {
  if (enabled === null) return reported;
  const allowed = new Set(enabled);
  return reported.filter((modelId) => allowed.has(modelId));
}

/**
 * Whether one model may be picked or used. An unlimited connection allows every id, including one
 * typed by hand. A limited one allows only the ids in its list, whatever the last check said: a
 * failed check or a hand-typed alias must not reopen a model an administrator switched off.
 */
export function isModelEnabled(modelId: string, enabled: readonly string[] | null): boolean {
  return enabled === null || enabled.includes(modelId);
}

/** Speech-to-text models: Whisper, `gpt-4o-transcribe` and servers that name them STT or ASR. */
const SPEECH_MODEL =
  /whisper|transcri|speech[-_]?to[-_]?text|(?:^|[^a-z0-9])(?:stt|asr)(?:[^a-z0-9]|$)/i;

/** Whether a model turns speech into text rather than chatting. Read from the name, as a family is. */
export function isSpeechModel(modelId: string): boolean {
  return SPEECH_MODEL.test(modelId.trim());
}
