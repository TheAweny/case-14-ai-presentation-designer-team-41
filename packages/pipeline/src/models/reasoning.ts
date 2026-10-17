import { reasoningControl, type ReasoningEffort } from '@lct/contracts';

/** Depth when a hybrid model is asked to think and nobody picked one. */
const DEFAULT_EFFORT: ReasoningEffort = 'medium';

/**
 * Thinking fields a chat request may add, by what the model allows (`reasoningControl`).
 *
 * - Qwen3 hybrids get `enable_thinking` and nothing else: they do not accept `reasoning_effort`.
 *   They think unless the person switched it off.
 * - Hybrids that think on request (GPT-5.1+, Claude, Gemini Flash) get `reasoning_effort` while
 *   thinking is on; switched off, the field is left out and they answer at once.
 * - Models that always reason get `reasoning_effort` only when a depth was chosen.
 * - Every other name keeps the server defaults.
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
  if (control === 'hybrid') {
    return thinking === false ? {} : { reasoning_effort: effort ?? DEFAULT_EFFORT };
  }
  if (control === 'effort' && effort) return { reasoning_effort: effort };
  return {};
}

/**
 * Whether the request may carry `temperature` and `top_p`. A model thinking through
 * `reasoning_effort` refuses them: OpenAI reasoning models answer 400, and Claude takes only
 * temperature 1 while it thinks.
 */
export function samplingAllowed(model: string, reasoning: Record<string, unknown>): boolean {
  return !('reasoning_effort' in reasoning) && reasoningControl(model) !== 'effort';
}
