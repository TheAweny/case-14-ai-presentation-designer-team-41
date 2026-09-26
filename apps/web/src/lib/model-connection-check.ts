import { z } from 'zod';
import {
  MODEL_ID_MAX_LENGTH,
  MODEL_LIST_MAX_LENGTH,
  modelsEndpoint,
  type CheckError,
  type ConnectionCheck,
} from './model-settings';

/**
 * Проверка подключения: настоящий `GET {baseUrl}/models`, как его делает любой
 * OpenAI-совместимый клиент. Запускается только на сервере приложения — ключ в браузер не
 * попадает, а «localhost» в адресе значит машину, где запущен сервер.
 *
 * Адрес вводит сам человек, и сервер идёт по нему — ради этого подключения и существуют. Запрос
 * один, только чтение списка моделей, ответ дальше разбора не уходит.
 *
 * `fetch` внедряется: тесты проверяют разбор ответов и ошибок без сети.
 */

/** Сколько ждать ответа. Локальный сервер отвечает мгновенно, облачный — за доли секунды. */
export const CHECK_TIMEOUT_MS = 5000;

export interface CheckOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

/** Ответ `/models` в формате OpenAI: `{ object: 'list', data: [{ id, ... }] }`. */
const ModelsResponseSchema = z.object({
  data: z.array(z.looseObject({ id: z.string() })),
});

/**
 * Id моделей из ответа `/models` в порядке сервера, без повторов и пустых; не тот формат — null.
 * Лишние поля (`owned_by`, `created`, у Ollama и vLLM — свои) не мешают.
 */
export function parseModelsResponse(body: unknown): readonly string[] | null {
  const parsed = ModelsResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  const ids = new Set<string>();
  for (const item of parsed.data.data) {
    const id = item.id.trim();
    if (id === '' || id.length > MODEL_ID_MAX_LENGTH) continue;
    ids.add(id);
    if (ids.size >= MODEL_LIST_MAX_LENGTH) break;
  }
  return [...ids];
}

/**
 * Код системной ошибки, если он есть: Node кладёт его в `cause` у `fetch failed`
 * (`ECONNREFUSED` — никто не слушает порт, `ENOTFOUND` — имя не разрешилось). Текст ошибки не
 * берём: в нём бывает что угодно, а код короткий и понятный.
 */
export function unreachableDetail(error: unknown): string | null {
  const cause =
    typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : null;
  for (const candidate of [cause, error]) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const code = (candidate as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
  }
  return null;
}

class CheckTimeout extends Error {
  override readonly name = 'CheckTimeout';
}

/** Проверить сервер по адресу: найденные модели или причина, почему не вышло. */
export async function checkModelConnection(
  target: { readonly baseUrl: string; readonly apiKey: string | null },
  options: CheckOptions = {},
): Promise<ConnectionCheck> {
  const run = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? CHECK_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const fail = (error: CheckError): ConnectionCheck => ({
    ok: false,
    at: now().toISOString(),
    error,
  });

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Таймер покрывает и соединение, и чтение тела: сервер, который прислал заголовки и замолчал,
  // тоже «не ответил». Гонка — на случай `fetch`, который сигнал не слушает.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CheckTimeout());
    }, timeoutMs);
  });

  const headers: Record<string, string> = { accept: 'application/json' };
  if (target.apiKey) headers.authorization = `Bearer ${target.apiKey}`;

  const request = async () => {
    const response = await run(modelsEndpoint(target.baseUrl), {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (response.status === 401 || response.status === 403) {
      return fail({ kind: 'unauthorized', status: response.status });
    }
    if (!response.ok) return fail({ kind: 'http', status: response.status });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fail({ kind: 'invalid-response' });
    }
    const models = parseModelsResponse(body);
    if (models === null) return fail({ kind: 'invalid-response' });
    return { ok: true, at: now().toISOString(), models: [...models] } satisfies ConnectionCheck;
  };

  try {
    return await Promise.race([request(), timeout]);
  } catch (error) {
    if (error instanceof CheckTimeout || controller.signal.aborted)
      return fail({ kind: 'timeout' });
    return fail({ kind: 'unreachable', detail: unreachableDetail(error) });
  } finally {
    clearTimeout(timer);
  }
}
