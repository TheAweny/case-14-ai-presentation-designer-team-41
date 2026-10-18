import {
  NO_REASONING_CHOICE,
  type ReasoningCapability,
  type ReasoningEffort,
} from '@lct/contracts';

/** Depth when a model is asked to think and nobody picked one. */
const DEFAULT_EFFORT: ReasoningEffort = 'medium';

/**
 * Thinking fields a chat request adds, by what probing the model showed it does
 * (`ReasoningCapability`). Thinking is on unless the person switched it off.
 *
 * - `enable-thinking`: `chat_template_kwargs.enable_thinking` on or off, plus the depth when
 *   the model showed the depth changes how much it thinks.
 * - `reasoning-effort`: the depth makes the model think, `none` makes it answer at once (probing
 *   showed it thinks several times less with it); the depth is the person's when it is real, a
 *   medium one otherwise.
 * - no switch: the depth when it is real, nothing otherwise.
 */
export function reasoningRequestFields(
  capability: ReasoningCapability = NO_REASONING_CHOICE,
  effort?: ReasoningEffort | null,
  thinking?: boolean | null,
): Record<string, unknown> {
  const on = thinking !== false;
  const depth = capability.levels && effort ? effort : null;
  if (capability.toggle === 'enable-thinking') {
    return {
      chat_template_kwargs: { enable_thinking: on },
      ...(on && depth ? { reasoning_effort: depth } : {}),
    };
  }
  if (capability.toggle === 'reasoning-effort') {
    return { reasoning_effort: on ? (depth ?? DEFAULT_EFFORT) : 'none' };
  }
  return depth ? { reasoning_effort: depth } : {};
}

/**
 * Whether the request may carry `temperature` and `top_p`. A model thinking through
 * `reasoning_effort` refuses them: OpenAI reasoning models answer 400, and Claude takes only
 * temperature 1 while it thinks. A template switch (vLLM and the like) keeps sampling as it is.
 */
export function samplingAllowed(
  capability: ReasoningCapability = NO_REASONING_CHOICE,
  reasoning: Record<string, unknown>,
): boolean {
  return capability.toggle === 'enable-thinking' || !('reasoning_effort' in reasoning);
}
