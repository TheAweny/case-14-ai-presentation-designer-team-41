import { reasoningControl, type ReasoningEffort } from '@lct/contracts';

/**
 * Thinking fields a chat request may add. Qwen3 hybrids get `enable_thinking` and nothing else:
 * they do not accept `reasoning_effort`. They think unless the person switched it off. gpt-oss,
 * GPT-5 and the o-series get that field only when a depth was chosen. Every other name keeps the
 * server defaults.
 */
export function reasoningRequestFields(
  model: string,
  effort?: ReasoningEffort | null,
  thinking?: boolean | null,
): Record<string, unknown> {
  const control = reasoningControl(model);
  if (control === 'thinking') {
    return { chat_template_kwargs: { enable_thinking: thinking ?? true } };
  }
  if (control === 'effort' && effort) return { reasoning_effort: effort };
  return {};
}
