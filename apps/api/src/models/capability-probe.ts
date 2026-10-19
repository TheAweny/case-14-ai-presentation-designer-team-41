import type { ReasoningCapability } from '@lct/contracts';
import type { ResolvedModel } from './model-settings.service.js';

/**
 * Whether a server reads `reasoning_effort`. An invalid value may be rejected before generation;
 * a server that ignores it can generate an answer. Neither HTTP 400 nor a short answer proves
 * a zero bill. The explicit probe transport journals unknown usage and charge accordingly.
 *
 * Used only when the provider's own description (`model-details.ts`) says nothing about how the
 * model thinks. A probe that could not be completed (rate limit, no money, server down) is
 * `unknown`: it says nothing, and nothing is stored.
 */
export type Probed<T> = { readonly known: true; readonly value: T } | { readonly known: false };

const PROBE_TIMEOUT_MS = 30000;
/** A value of `reasoning_effort` no server accepts. */
const NO_SUCH_EFFORT = 'lct-probe-no-such-effort';

/** Statuses about the request itself; the rest are about the moment or the account. */
const refusal = (status: number) =>
  status >= 400 && status < 500 && ![401, 402, 403, 408, 429].includes(status);

/** `'none'`, or `none` between other values of a list. */
const listsNone = (message: string) => /["'`]none["'`]|\bnone\s*,|,\s*none\b/.test(message);

export async function probeReasoning(
  model: ResolvedModel,
  prompt: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Probed<ReasoningCapability | null>> {
  let response: Response;
  try {
    response = await fetchImpl(`${model.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        ...model.headers,
        ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}),
        'Content-Type': 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      body: JSON.stringify({
        model: model.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1,
        reasoning_effort: NO_SUCH_EFFORT,
      }),
    });
  } catch {
    return { known: false };
  }
  if (response.ok) return { known: true, value: null };
  const message = (await response.text().catch(() => '')).toLowerCase();
  if (!refusal(response.status)) return { known: false };
  // Refused for the made-up value (it is quoted, or the real ones are listed): the server reads
  // the field and passes real depths on. Refused for the field itself ("unsupported parameter"),
  // or for anything else: it does not.
  const readsValue = message.includes(NO_SUCH_EFFORT) || /\blow\b[\s\S]*\bhigh\b/.test(message);
  if (!readsValue) return { known: true, value: null };
  // Thinking can be switched off only where `none` is among the listed values: o3, GPT-5 and
  // vLLM, which checks the field for every model, refuse it. Elsewhere only the depth is chosen.
  return {
    known: true,
    value: { toggle: listsNone(message) ? 'reasoning-effort' : null, levels: true },
  };
}
