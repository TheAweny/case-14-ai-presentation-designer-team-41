import { reasoningControl, type ReasoningEffort } from '@lct/contracts';

/**
 * Same names as `QWEN38` in `@lct/contracts` reasoning.ts. Kept beside the request
 * so Qwen3.8 does not inherit the hybrid switch, which turns thinking on.
 */
const QWEN38_THINKING_OFF = /(?:^|[^a-z0-9])qwen3(?:\.8|8)(?![a-z0-9])/i;

export type ReasoningRequestOptions = {
  /** Hybrid Qwen3 only. Defaults to `true`. Qwen3.8 ignores this and stays off. */
  thinking?: boolean;
};

/**
 * Thinking fields a chat request may add. Qwen3 hybrids get `enable_thinking`
 * (default `true`; `options.thinking` overrides it) and nothing else: they do not
 * accept `reasoning_effort`. Qwen3.8 (`qwen38`, `qwen3.8`) is the exception: the
 * checkpoint thinks unless asked not to, so the request forces
 * `enable_thinking: false` and still omits `reasoning_effort`, even when
 * `options.thinking` is set. gpt-oss, GPT-5 and the o-series get `reasoning_effort`
 * only when a depth was chosen. Every other name keeps the server defaults.
 */
export function reasoningRequestFields(
  model: string,
  effort?: ReasoningEffort | null,
  options?: ReasoningRequestOptions,
): Record<string, unknown> {
  if (QWEN38_THINKING_OFF.test(model.trim())) {
    return { chat_template_kwargs: { enable_thinking: false } };
  }
  const control = reasoningControl(model);
  if (control === 'thinking') {
    return {
      chat_template_kwargs: {
        enable_thinking: /(?:^|[^a-z0-9])thinking(?:[^a-z0-9]|$)/i.test(model)
          ? true
          : (options?.thinking ?? true),
      },
    };
  }
  if (control === 'effort' && effort) return { reasoning_effort: effort };
  return {};
}
