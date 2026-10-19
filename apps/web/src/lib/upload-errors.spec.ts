import { describe, expect, it } from 'vitest';
import { scrubShownError, scrubUploadMessage, uploadErrorMessage } from './upload-errors';

const LEAK =
  'Template upload failed (422): <script>Bearer sk-live-secret C:\\Users\\secret\\deck.pptx postgres://user:pass@db/app</script>';

describe('uploadErrorMessage', () => {
  it('names template failures without a status code', () => {
    expect(uploadErrorMessage('template', 400)).toBe(
      'Не удалось загрузить шаблон. Проверьте, что это непустой файл .pptx или .potx.',
    );
    expect(uploadErrorMessage('template', 413)).toBe(
      'Шаблон слишком большой. Сожмите файл или уберите из него лишние картинки и загрузите снова.',
    );
    expect(uploadErrorMessage('template', 422)).toBe(
      'Не удалось прочитать шаблон. Проверьте, что файл открывается в PowerPoint, и загрузите его снова.',
    );
    expect(uploadErrorMessage('template', 500)).toBe(
      'Не удалось загрузить шаблон: сервер не смог его обработать. Попробуйте ещё раз.',
    );
    expect(uploadErrorMessage('template', 503)).toBe(uploadErrorMessage('template', 500));
    expect(uploadErrorMessage('template', 418)).toBe(
      'Не удалось загрузить шаблон. Попробуйте ещё раз.',
    );
    for (const status of [400, 413, 422, 500, 503, 418]) {
      expect(uploadErrorMessage('template', status)).not.toMatch(/\b\d{3}\b/);
    }
  });

  it('names content failures the same way', () => {
    expect(uploadErrorMessage('content', 400)).toContain('материал');
    expect(uploadErrorMessage('content', 413)).toContain('большой');
    expect(uploadErrorMessage('content', 422)).toBe(
      'Не удалось прочитать материал. Проверьте, что файл открывается, и загрузите его снова.',
    );
    expect(uploadErrorMessage('content', 502)).toBe(uploadErrorMessage('content', 500));
    expect(uploadErrorMessage('content', 409)).not.toMatch(/409|HTTP|failed/i);
  });

  it('does not repeat an unsafe fetch exception or response body', () => {
    const leaked = new Error(LEAK);
    const aborted = new Error(LEAK);
    aborted.name = 'AbortError';

    const network = uploadErrorMessage('template', leaked);
    const cancel = uploadErrorMessage('content', aborted);
    for (const message of [network, cancel, uploadErrorMessage('template', 422)]) {
      expect(message).not.toContain('sk-live-secret');
      expect(message).not.toContain('Bearer');
      expect(message).not.toContain('<script>');
      expect(message).not.toContain('postgres://');
      expect(message).not.toContain('C:\\');
      expect(message).not.toMatch(/422|Template upload failed|Content upload failed/);
    }
    expect(network).toContain('соединение');
    expect(cancel).toBe('Загрузка материала отменена.');
    expect(uploadErrorMessage('template', aborted)).toBe('Загрузка шаблона отменена.');
  });

  it('replaces a raw upload failure and leaves a sentence that is already readable', () => {
    expect(scrubUploadMessage('template', LEAK)).toBe(uploadErrorMessage('template', 422));
    expect(scrubUploadMessage('template', 'Template upload failed (500)')).toBe(
      uploadErrorMessage('template', 500),
    );
    expect(scrubShownError('Content upload failed (413)')).toBe(uploadErrorMessage('content', 413));
    const readable = uploadErrorMessage('template', 422);
    expect(scrubShownError(readable)).toBe(readable);
    expect(scrubShownError('Файл повреждён')).toBe('Файл повреждён');
  });
});
