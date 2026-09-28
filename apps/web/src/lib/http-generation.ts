import { z } from 'zod';
import { designSystemSchema, templateIrSchema, jobEventSchema } from '@lct/contracts';
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
  const slides = parsed.templateIr.slides
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
      if (input.format !== 'pptx' && input.format !== 'pdf')
        fail('В этом режиме доступны PPTX и PDF.');
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
      return {
        fileName: `${input.fileName}.${input.format}`,
        url: publicApiUrl(
          `/generation/${encodeURIComponent(input.deckId)}/artifacts/deck.${input.format}`,
        ),
      };
    },
  };
}
