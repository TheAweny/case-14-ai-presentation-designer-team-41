/**
 * Скачивание исходного шаблона через прокси браузера. Байты и имя из
 * Content-Disposition — тот файл, который другой экземпляр принимает обычной загрузкой.
 * Отказ не превращается в пустой успех: меню показывает, что файла нет или скачивание не вышло.
 *
 * Модуль без Next и React: запрос, имя и отказ проверяются тестами.
 */

export type OriginalDownloadFailure = 'missing' | 'failed';

export interface OriginalTemplateFile {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly contentType: string;
}

export type OriginalTemplateResult =
  | { readonly ok: true; readonly file: OriginalTemplateFile }
  | { readonly ok: false; readonly reason: OriginalDownloadFailure };

/** Чем тест подменяет браузер: создать адрес, отдать файл и потом его отпустить. */
export interface OriginalDownloadSaver {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  save(href: string, fileName: string): void;
}

/** Адрес прокси: один сегмент идентификатора, без выхода из маршрута. */
export function templateDownloadPath(templateId: string): string {
  return `/api/backend/files/templates/${encodeURIComponent(templateId)}/download`;
}

/**
 * Имя из `filename*`, иначе из `filename`. Это имя загрузки, не путь:
 * слэш, обратный слэш или другое расширение сюда не проходят.
 */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (header === null || header === '') return null;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  const encoded = star?.[1]?.trim();
  if (encoded) {
    try {
      return oneFileName(decodeURIComponent(encoded).trim());
    } catch {
      return null;
    }
  }
  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  const plain = quoted?.[1] ?? /(?:^|;)\s*filename\s*=\s*([^;]+)/i.exec(header)?.[1];
  return oneFileName((plain ?? '').trim());
}

function oneFileName(name: string): string | null {
  if (name === '' || /[/\\]/.test(name)) return null;
  if (!/\.(pptx|potx)$/i.test(name)) return null;
  return name;
}

/** Ключ текста, которым меню объясняет отказ. */
export function originalDownloadMessageKey(
  reason: OriginalDownloadFailure,
): 'downloadMissing' | 'downloadFailed' {
  return reason === 'missing' ? 'downloadMissing' : 'downloadFailed';
}

/**
 * Забирает исходные байты. 404 и пустое тело — файла нет; сеть, другой статус и
 * негодное имя — скачивание не вышло. Исключение наружу не уходит.
 */
export async function readOriginalTemplate(
  templateId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OriginalTemplateResult> {
  if (templateId === '') return { ok: false, reason: 'failed' };
  try {
    const response = await fetchImpl(templateDownloadPath(templateId), { method: 'GET' });
    if (response.status === 404) return { ok: false, reason: 'missing' };
    if (!response.ok) return { ok: false, reason: 'failed' };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) return { ok: false, reason: 'missing' };
    const fileName = fileNameFromContentDisposition(response.headers.get('content-disposition'));
    if (fileName === null) return { ok: false, reason: 'failed' };
    return {
      ok: true,
      file: {
        bytes,
        fileName,
        contentType: response.headers.get('content-type') ?? '',
      },
    };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Настоящая загрузка браузера: ссылка с `download` и теми байтами, что пришли. */
export function saveOriginalTemplate(
  file: OriginalTemplateFile,
  saver: OriginalDownloadSaver = browserSaver(),
): void {
  const blob = new Blob([bytesOf(file.bytes)], {
    type: file.contentType || 'application/octet-stream',
  });
  const url = saver.createObjectURL(blob);
  saver.save(url, file.fileName);
  setTimeout(() => saver.revokeObjectURL(url), 1000);
}

function bytesOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function browserSaver(): OriginalDownloadSaver {
  return {
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    save(href, fileName) {
      const link = document.createElement('a');
      link.href = href;
      link.download = fileName;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
    },
  };
}
