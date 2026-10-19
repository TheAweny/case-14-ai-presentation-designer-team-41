/**
 * Текст сбоя загрузки шаблона или материала. Код ответа и тело сервера сюда не попадают.
 */
export type UploadKind = 'template' | 'content';

const COPY = {
  template: {
    400: 'Не удалось загрузить шаблон. Проверьте, что это непустой файл .pptx или .potx.',
    413: 'Шаблон слишком большой. Сожмите файл или уберите из него лишние картинки и загрузите снова.',
    422: 'Не удалось прочитать шаблон. Проверьте, что файл открывается в PowerPoint, и загрузите его снова.',
    server: 'Не удалось загрузить шаблон: сервер не смог его обработать. Попробуйте ещё раз.',
    other: 'Не удалось загрузить шаблон. Попробуйте ещё раз.',
    abort: 'Загрузка шаблона отменена.',
    network:
      'Не удалось связаться с сервером при загрузке шаблона. Проверьте соединение и попробуйте ещё раз.',
  },
  content: {
    400: 'Не удалось загрузить материал. Проверьте, что это непустой документ, таблица или PDF.',
    413: 'Материал слишком большой. Сократите файл и загрузите его снова.',
    422: 'Не удалось прочитать материал. Проверьте, что файл открывается, и загрузите его снова.',
    server: 'Не удалось загрузить материал: сервер не смог его обработать. Попробуйте ещё раз.',
    other: 'Не удалось загрузить материал. Попробуйте ещё раз.',
    abort: 'Загрузка материала отменена.',
    network:
      'Не удалось связаться с сервером при загрузке материала. Проверьте соединение и попробуйте ещё раз.',
  },
} as const;

/** Число — HTTP-статус. Иначе исключение fetch: отмена или сеть. */
export function uploadErrorMessage(kind: UploadKind, failure: unknown): string {
  const copy = COPY[kind];
  if (typeof failure === 'number') {
    if (failure === 400 || failure === 413 || failure === 422) return copy[failure];
    if (failure >= 500 && failure < 600) return copy.server;
    return copy.other;
  }
  if (isAbort(failure)) return copy.abort;
  return copy.network;
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/**
 * Сырой текст сервера или клиента: код ответа, английская обёртка загрузки, ответ движка.
 * Такое в интерфейс не попадает — вместо него понятная фраза по статусу.
 */
const RAW_UPLOAD =
  /template upload failed|content upload failed|engine responded|\bHTTP\s*\d{3}\b|\(\d{3}\)/i;

/** Если строка похожа на сырой сбой загрузки, заменить её понятной фразой. Иначе оставить. */
export function scrubUploadMessage(kind: UploadKind, message: string): string {
  if (!RAW_UPLOAD.test(message)) return message;
  const status = message.match(/\b(400|413|422|5\d\d)\b/);
  return uploadErrorMessage(kind, status ? Number(status[1]) : 422);
}

/** То же, когда вид загрузки виден по самой строке. Чужие ошибки не трогает. */
export function scrubShownError(message: string): string {
  if (!RAW_UPLOAD.test(message)) return message;
  const kind = /content upload/i.test(message) ? 'content' : 'template';
  return scrubUploadMessage(kind, message);
}
