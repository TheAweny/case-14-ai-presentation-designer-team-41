import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../i18n/messages/en/templates-page.json';
import ru from '../i18n/messages/ru/templates-page.json';
import { templateFileProblem } from './deck-generator';
import {
  fileNameFromContentDisposition,
  originalDownloadMessageKey,
  readOriginalTemplate,
  saveOriginalTemplate,
  type OriginalDownloadSaver,
  type OriginalTemplateFile,
} from './template-original-download';

const TEMPLATE = '11d8fefa-d032-4a95-84e5-77efd69569c2';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const POTX = 'application/vnd.openxmlformats-officedocument.presentationml.template';

function disposition(
  name: string,
  ascii = /\.potx$/i.test(name) ? 'template.potx' : 'template.pptx',
) {
  const star = encodeURIComponent(name).replace(/['()*]/g, (character) => {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
  return `attachment; filename="${ascii}"; filename*=UTF-8''${star}`;
}

const COPY = { ru, en };

function responseBody(body: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(body.byteLength);
  new Uint8Array(copy).set(body);
  return copy;
}

function responseOf(body: Uint8Array, status: number, headers?: Record<string, string>): Response {
  return new Response(responseBody(body), { status, headers });
}

describe('readOriginalTemplate', () => {
  it('returns the original bytes and the unicode upload name for another instance', async () => {
    const fileName = 'Шаблон квартала.pptx';
    const body = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x71]);
    const calls: string[] = [];
    const result = await readOriginalTemplate(TEMPLATE, async (input, init) => {
      calls.push(String(input));
      expect(init?.method).toBe('GET');
      return responseOf(body, 200, {
        'content-type': PPTX,
        'content-disposition': disposition(fileName),
      });
    });
    expect(calls).toEqual([`/api/backend/files/templates/${TEMPLATE}/download`]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.from(result.file.bytes)).toEqual(Array.from(body));
    expect(result.file.fileName).toBe(fileName);
    expect(result.file.contentType).toBe(PPTX);
    expect(
      templateFileProblem({ name: result.file.fileName, size: result.file.bytes.byteLength }),
    ).toBe(null);
  });

  it('keeps a .potx name that the existing upload accepts', async () => {
    const body = new Uint8Array([0x50, 0x4b, 0x07]);
    const result = await readOriginalTemplate(TEMPLATE, async () =>
      responseOf(body, 200, {
        'content-type': POTX,
        'content-disposition': disposition('Brand.POTX', 'Brand.POTX'),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.fileName).toBe('Brand.POTX');
    expect(templateFileProblem({ name: result.file.fileName, size: body.byteLength })).toBe(null);
  });

  it('prefers filename* and refuses a path in that name', () => {
    const header = disposition('Шаблон квартала.pptx');
    expect(fileNameFromContentDisposition(header)).toBe('Шаблон квартала.pptx');
    expect(header).toContain('filename="template.pptx"');
    expect(fileNameFromContentDisposition(disposition('../secret.pptx'))).toBeNull();
    expect(fileNameFromContentDisposition(disposition('..\\secret.pptx'))).toBeNull();
    expect(fileNameFromContentDisposition('attachment; filename="Brand.POTX"')).toBe('Brand.POTX');
  });

  it('reports a missing file and a failed download without swallowing them', async () => {
    const missing = await readOriginalTemplate(TEMPLATE, async () =>
      responseOf(new Uint8Array(), 404, { 'content-type': 'application/json' }),
    );
    const empty = await readOriginalTemplate(TEMPLATE, async () =>
      responseOf(new Uint8Array(), 200, {
        'content-disposition': disposition('empty.pptx', 'empty.pptx'),
      }),
    );
    const failed = await readOriginalTemplate(TEMPLATE, async () =>
      responseOf(new Uint8Array([1]), 500),
    );
    const offline = await readOriginalTemplate(TEMPLATE, async () => {
      throw new TypeError('network down');
    });
    const nameless = await readOriginalTemplate(TEMPLATE, async () =>
      responseOf(new Uint8Array([1, 2]), 200, { 'content-type': PPTX }),
    );
    expect(missing).toEqual({ ok: false, reason: 'missing' });
    expect(empty).toEqual({ ok: false, reason: 'missing' });
    expect(failed).toEqual({ ok: false, reason: 'failed' });
    expect(offline).toEqual({ ok: false, reason: 'failed' });
    expect(nameless).toEqual({ ok: false, reason: 'failed' });
    expect(COPY.ru[originalDownloadMessageKey('missing')].length).toBeGreaterThan(0);
    expect(COPY.en[originalDownloadMessageKey('missing')].length).toBeGreaterThan(0);
    expect(COPY.ru[originalDownloadMessageKey('failed')].length).toBeGreaterThan(0);
    expect(COPY.en[originalDownloadMessageKey('failed')].length).toBeGreaterThan(0);
    expect(COPY.ru.download.length).toBeGreaterThan(0);
    expect(COPY.en.download.length).toBeGreaterThan(0);
  });
});

describe('saveOriginalTemplate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clicks a download link carrying the same bytes and file name', async () => {
    vi.useFakeTimers();
    const file: OriginalTemplateFile = {
      bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]),
      fileName: 'Шаблон квартала.pptx',
      contentType: PPTX,
    };
    const clicks: { href: string; download: string }[] = [];
    const revoked: string[] = [];
    const saved: Blob[] = [];
    const saver: OriginalDownloadSaver = {
      createObjectURL(blob) {
        saved.push(blob);
        return 'blob:template';
      },
      revokeObjectURL(url) {
        revoked.push(url);
      },
      save(href, fileName) {
        clicks.push({ href, download: fileName });
      },
    };
    saveOriginalTemplate(file, saver);
    expect(clicks).toEqual([{ href: 'blob:template', download: file.fileName }]);
    const kept = saved[0];
    if (kept === undefined) throw new Error('download did not keep the bytes');
    expect(Array.from(new Uint8Array(await kept.arrayBuffer()))).toEqual(Array.from(file.bytes));
    expect(revoked).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(revoked).toEqual(['blob:template']);
  });
});
