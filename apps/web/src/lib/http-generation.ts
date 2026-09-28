import { z } from 'zod';
import {
  designSystemSchema,
  jobEventSchema,
  slideIrSchema,
  templateIrSchema,
} from '@lct/contracts';
import { apiFetch, publicApiUrl } from './api';
import type { DeckGenerator } from './deck-generator';
import { DeckNotFoundError, type Deck, type DeckSource } from './deck-source';
import type { DeckExporter } from './deck-export';
import { templateLayoutsFromIr, templateSlideFromIr } from './template-profile';

const storedDeckSchema = z.object({
  runId: z.string(),
  title: z.string(),
  designSystem: designSystemSchema,
  templateIr: templateIrSchema,
  /**
   * The finished .pptx read back by the engine, the way its slides are drawn. Absent when the
   * engine could not read it; the slides are then rebuilt from the parser's template IR.
   */
  slides: z.array(slideIrSchema).optional(),
});
async function request(path: string, init?: RequestInit) {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message ?? `Generation API: HTTP ${response.status}`);
  }
  return response.json();
}
export function decodeGeneratedDeck(data: unknown): Deck {
  const parsed = storedDeckSchema.parse(data);
  const slides = parsed.slides?.length
    ? parsed.slides
    : parsed.templateIr.slides
        .map((_, i) => templateSlideFromIr(parsed.templateIr, i))
        .filter((slide) => slide !== null);
  return {
    deckId: parsed.runId,
    renderedPdfUrl: publicApiUrl(
      `/generation/${encodeURIComponent(parsed.runId)}/artifacts/deck.pdf`,
    ),
    title: parsed.title,
    variant: 'balanced',
    slideSize: { cx: parsed.templateIr.slideCx, cy: parsed.templateIr.slideCy },
    designSystem: parsed.designSystem,
    slides,
    layouts: templateLayoutsFromIr(parsed.templateIr),
  };
}
export function createHttpDeckSource(): DeckSource {
  return {
    async getDeck(id) {
      const response = await apiFetch(`/generation/${encodeURIComponent(id)}/deck`);
      if (response.status === 404) throw new DeckNotFoundError(id);
      if (!response.ok) throw new Error(`Deck API: ${response.status}`);
      return decodeGeneratedDeck(await response.json());
    },
    mediaUrl(id, part) {
      return publicApiUrl(
        `/generation/${encodeURIComponent(id)}/media/${encodeURIComponent(part.split('/').pop() ?? '')}`,
      );
    },
  };
}
function wait(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 700);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
export function createHttpGenerator(): DeckGenerator {
  return {
    profilesUploadedTemplates: true,
    async generate(input, onEvent, signal, onSlide) {
      await request('/generation/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ templateId: input.templateId }),
        signal,
      });
      const contentIds: string[] = [];
      for (const file of input.files) {
        const body = new FormData();
        body.set('file', file);
        const uploaded = (await request('/files/content', { method: 'POST', body, signal })) as {
          fileId: string;
        };
        contentIds.push(uploaded.fileId);
      }
      const run = (await request('/generation', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          templateId: input.templateId,
          brief: input.brief,
          slideCount: input.slideCount,
          projectId: input.projectId,
          contentIds,
          model: input.model,
        }),
        signal,
      })) as { runId: string };
      const cancel = () => {
        void request(`/generation/${run.runId}/cancel`, { method: 'POST' }).catch(() => undefined);
      };
      signal.addEventListener('abort', cancel, { once: true });
      let sequence = -1;
      try {
        for (;;) {
          signal.throwIfAborted();
          const events = z
            .array(jobEventSchema)
            .parse(await request(`/runs/${run.runId}/events?after=${sequence}`, { signal }));
          for (const event of events) {
            sequence = event.seq;
            onEvent(event);
            if (event.type === 'failed') throw new Error(event.message);
          }
          const status = (await request(`/runs/${run.runId}`, { signal })) as { state: string };
          if (status.state === 'failed') throw new Error('Генерация завершилась ошибкой.');
          if (status.state === 'done') break;
          await wait(signal);
        }
        const deck = await createHttpDeckSource().getDeck(run.runId);
        deck.slides.forEach((slide, index) =>
          onSlide?.({ index, total: deck.slides.length, slide, designSystem: deck.designSystem }),
        );
        const cover = deck.slides[0];
        if (!cover) throw new Error('The generated deck has no slides.');
        return {
          templateSubstituted: false,
          variants: [
            {
              variant: 'balanced',
              deckId: deck.deckId,
              title: deck.title,
              slideCount: deck.slides.length,
              cover,
              designSystem: deck.designSystem,
            },
          ],
        };
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}
export function createHttpExporter(): DeckExporter {
  return {
    async export(input, onEvent, signal) {
      signal.throwIfAborted();
      const fail = (message: string): never => {
        onEvent({
          schemaVersion: 1,
          runId: input.deckId,
          seq: 0,
          at: new Date().toISOString(),
          type: 'failed',
          stage: 'exporting',
          code: 'internal',
          message,
          retryable: false,
        });
        throw new Error(message);
      };
      if (input.audit)
        fail(
          'Повторный аудит при скачивании пока недоступен. Отчёт генерации сохранён в audit.json.',
        );
      const original = await createHttpDeckSource().getDeck(input.deckId);
      const content = (slides: typeof input.slides) =>
        JSON.stringify(
          slides.map((slide) => ({
            ...slide,
            elements: slide.elements.map(({ locked: _locked, ...element }) => element),
          })),
        );
      if (
        content(original.slides) !== content(input.slides) ||
        JSON.stringify(original.designSystem) !== JSON.stringify(input.designSystem)
      )
        fail('Экспорт правок редактора пока не подключён. Доступен исходный сгенерированный файл.');
      const artifact = (name: string) =>
        publicApiUrl(`/generation/${encodeURIComponent(input.deckId)}/artifacts/${name}`);
      const previews = async () =>
        z
          .array(z.string())
          .parse(
            await request(`/generation/${encodeURIComponent(input.deckId)}/previews`, { signal }),
          );
      const previewFiles = async () =>
        await Promise.all(
          (await previews()).map(async (name) => ({
            name,
            blob: await artifactBlob(artifact(name), signal),
          })),
        );
      if (input.format === 'html') {
        const images = await Promise.all(
          (await previewFiles()).map(async ({ name, blob }) => ({
            name,
            data: await dataUrl(blob),
          })),
        );
        return {
          fileName: `${input.fileName}.html`,
          url: URL.createObjectURL(
            new Blob([standaloneHtml(input.fileName, images)], { type: 'text/html;charset=utf-8' }),
          ),
        };
      }
      if (input.format === 'png') {
        return {
          fileName: `${input.fileName}.zip`,
          url: URL.createObjectURL(await zipPreviews(await previewFiles())),
        };
      }
      const blob = await artifactBlob(artifact(`deck.${input.format}`), signal);
      return {
        fileName: `${input.fileName}.${input.format}`,
        url: URL.createObjectURL(blob),
      };
    },
  };
}

async function artifactBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`Artifact API: ${response.status}`);
  return response.blob();
}

/** I create a standards-compliant store-only ZIP without depending on server-side archiving. */
export async function zipPreviews(files: readonly { name: string; blob: Blob }[]): Promise<Blob> {
  const entries = await Promise.all(
    files.map(async ({ name, blob }) => {
      const data = new Uint8Array(await blob.arrayBuffer());
      return { name: new TextEncoder().encode(name), data, crc: crc32(data) };
    }),
  );
  const parts: BlobPart[] = [];
  const central: BlobPart[] = [];
  let offset = 0;
  for (const entry of entries) {
    parts.push(localHeader(entry), entry.name, entry.data);
    central.push(centralHeader(entry, offset), entry.name);
    offset += 30 + entry.name.length + entry.data.length;
  }
  const centralSize = entries.reduce((size, entry) => size + 46 + entry.name.length, 0);
  return new Blob([...parts, ...central, endHeader(entries.length, centralSize, offset)], {
    type: 'application/zip',
  });
}

function localHeader(entry: ZipEntry): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(new ArrayBuffer(30));
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.length, true);
  view.setUint32(22, entry.data.length, true);
  view.setUint16(26, entry.name.length, true);
  return header;
}

function centralHeader(entry: ZipEntry, offset: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(new ArrayBuffer(46));
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.length, true);
  view.setUint32(24, entry.data.length, true);
  view.setUint16(28, entry.name.length, true);
  view.setUint32(42, offset, true);
  return header;
}

function endHeader(entries: number, centralSize: number, offset: number): Uint8Array<ArrayBuffer> {
  const header = new Uint8Array(new ArrayBuffer(22));
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries, true);
  view.setUint16(10, entries, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, offset, true);
  return header;
}

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  readonly name: Uint8Array<ArrayBuffer>;
  readonly data: Uint8Array<ArrayBuffer>;
  readonly crc: number;
}

async function dataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Cannot read preview.'));
    reader.readAsDataURL(blob);
  });
}

function standaloneHtml(title: string, images: readonly { name: string; data: string }[]): string {
  const escaped = title.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  );
  const slides = images
    .map(
      ({ name, data }, index) =>
        `<section id="slide-${index + 1}" aria-label="Slide ${index + 1}"><img alt="${name}" src="${data}"></section>`,
    )
    .join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escaped}</title><style>body{margin:0;background:#111;color:#fff;font-family:Arial,sans-serif}main{display:grid;gap:24px;padding:24px}section{margin:auto;width:min(100%,1200px);box-shadow:0 8px 28px #000}img{display:block;width:100%;height:auto}</style></head><body><main>${slides}</main></body></html>`;
}
