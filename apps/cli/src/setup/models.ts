/**
 * Where the models come from. A preset fills the four settings the pipeline reads; the service
 * works with any OpenAI-compatible runtime, the presets only save typing.
 */
export interface ModelSettings {
  readonly MODEL_PROVIDER: string;
  readonly LLM_BASE_URL: string;
  readonly VLM_BASE_URL: string;
  readonly MODEL_API_KEY: string;
  readonly LLM_MODEL: string;
  readonly VLM_MODEL: string;
}

export const AI_STUDIO_URL = 'https://llm.api.cloud.yandex.net/v1';
export const AI_STUDIO_MODEL = 'qwen3.6-35b-a3b';

/** Yandex AI Studio: the served name carries the cloud folder id. */
export function aiStudio(apiKey: string, folderId: string): ModelSettings {
  const model = `gpt://${folderId.trim()}/${AI_STUDIO_MODEL}/latest`;
  return {
    MODEL_PROVIDER: '',
    LLM_BASE_URL: AI_STUDIO_URL,
    VLM_BASE_URL: AI_STUDIO_URL,
    MODEL_API_KEY: apiKey.trim(),
    LLM_MODEL: model,
    VLM_MODEL: model,
  };
}

/** Any OpenAI-compatible runtime: vLLM, llama.cpp, a hosted provider of open-weight models. */
export function openAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  visionModel?: string,
): ModelSettings {
  const url = baseUrl.trim().replace(/\/+$/, '');
  return {
    MODEL_PROVIDER: '',
    LLM_BASE_URL: url,
    VLM_BASE_URL: url,
    MODEL_API_KEY: apiKey.trim(),
    LLM_MODEL: model.trim(),
    VLM_MODEL: (visionModel ?? model).trim(),
  };
}

/** Recorded answers only: no network, no key. For a demo and for tests. */
export function offline(): ModelSettings {
  return {
    MODEL_PROVIDER: 'fake',
    LLM_BASE_URL: '',
    VLM_BASE_URL: '',
    MODEL_API_KEY: '',
    LLM_MODEL: '',
    VLM_MODEL: '',
  };
}

export interface ModelCheck {
  readonly ok: boolean;
  readonly detail: string;
  readonly ms: number;
}

/**
 * Asks the runtime for one short JSON answer with thinking off, which is exactly the kind of
 * call the pipeline makes. A wrong key, folder or model name shows up here, not mid-run.
 */
export async function checkModel(
  settings: ModelSettings,
  doFetch: typeof fetch = fetch,
): Promise<ModelCheck> {
  if (settings.MODEL_PROVIDER === 'fake') return { ok: true, detail: 'офлайн', ms: 0 };
  const started = Date.now();
  try {
    const response = await doFetch(`${settings.LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${settings.MODEL_API_KEY}`,
      },
      body: JSON.stringify({
        model: settings.LLM_MODEL,
        messages: [{ role: 'user', content: 'Answer with {"ok": true} and nothing else.' }],
        max_tokens: 20,
        chat_template_kwargs: { enable_thinking: false },
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const ms = Date.now() - started;
    if (!response.ok) {
      return {
        ok: false,
        detail: `HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`,
        ms,
      };
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content ?? '';
    return content.includes('ok')
      ? { ok: true, detail: `ответ за ${(ms / 1000).toFixed(1)} с`, ms }
      : { ok: false, detail: `неожиданный ответ: ${content.slice(0, 120)}`, ms };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
      ms: Date.now() - started,
    };
  }
}
