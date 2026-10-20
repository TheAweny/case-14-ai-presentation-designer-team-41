import {
  VK_AI_SPACE_BASE_URL,
  VK_AI_SPACE_MODEL,
  VK_PROJECT_HEADER,
  headerRecord,
  parseHeaderEnv,
} from '@lct/contracts';

/**
 * Where the models come from. A preset fills the settings the pipeline reads; the service
 * works with any OpenAI-compatible runtime, the presets only save typing.
 */
export interface ModelSettings {
  readonly MODEL_PROVIDER: string;
  readonly LLM_BASE_URL: string;
  readonly VLM_BASE_URL: string;
  readonly MODEL_API_KEY: string;
  readonly LLM_MODEL: string;
  readonly VLM_MODEL: string;
  /** Headers besides the key, `Name=value` pairs separated by commas. */
  readonly MODEL_HEADERS: string;
}

export const AI_STUDIO_URL = 'https://llm.api.cloud.yandex.net/v1';
// The case cap is 35B. Yandex's hosted qwen3.6-35b-a3b is about 35.95B, so the preset names the
// catalogue model. A folder that does not serve it needs another OpenAI-compatible runtime.
export const AI_STUDIO_MODEL = 'qwen3-30b-a3b-instruct-2507';

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
    MODEL_HEADERS: '',
  };
}

/**
 * VK AI Space, where the finals are judged: Qwen 3.8 27B reads text and slide images, so one
 * model serves every role. The gateway wants the project in a header besides the key.
 */
export function vkAiSpace(apiKey: string, projectId: string): ModelSettings {
  return {
    MODEL_PROVIDER: '',
    LLM_BASE_URL: VK_AI_SPACE_BASE_URL,
    VLM_BASE_URL: VK_AI_SPACE_BASE_URL,
    MODEL_API_KEY: apiKey.trim(),
    LLM_MODEL: VK_AI_SPACE_MODEL,
    VLM_MODEL: VK_AI_SPACE_MODEL,
    MODEL_HEADERS: `${VK_PROJECT_HEADER}=${projectId.trim()}`,
  };
}

/** A VK AI Space project id: a UUID. */
export function projectIdProblem(value: string): string | undefined {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim())
    ? undefined
    : 'Project ID — UUID вида 0b5e…-…-…-…-…';
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
    MODEL_HEADERS: '',
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
    MODEL_HEADERS: '',
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
        ...headerRecord(parseHeaderEnv(settings.MODEL_HEADERS)),
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
        detail: `HTTP ${response.status}. Проверьте ключ, адрес API и доступность модели.`,
        ms,
      };
    }
    const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content ?? '';
    let ok = false;
    try {
      ok = (JSON.parse(content) as { ok?: unknown }).ok === true;
    } catch {
      /* Expected one JSON object. */
    }
    return ok
      ? { ok: true, detail: `ответ за ${(ms / 1000).toFixed(1)} с`, ms }
      : { ok: false, detail: 'Модель не вернула ожидаемое подтверждение JSON.', ms };
  } catch {
    return {
      ok: false,
      detail: 'Не удалось подключиться к API или прочитать его ответ.',
      ms: Date.now() - started,
    };
  }
}
