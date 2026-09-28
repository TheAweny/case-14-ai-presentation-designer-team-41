'use client';

import { useSyncExternalStore } from 'react';
import { attachTemplateAction, refreshLibraryAction } from '@/app/(library)/actions';
import { createAssistantThreads, type AssistantThread } from '@/lib/assistant-threads';
import { createDeckConversations } from '@/lib/deck-conversations';
import { createGenerationRuns, type GenerationRun } from '@/lib/generation-runs';
import type { TemplateSummary } from '@/lib/library-source';
import { createTemplateImports, type TemplateImport } from '@/lib/template-imports';
import { createHttpGenerator } from '@/lib/http-generation';
import { createDemoTemplateImporter } from '@/mocks/demo-template-importer';
import { apiBaseUrl } from '@/lib/api';
import { designSystemSchema, templateIrSchema } from '@lct/contracts';
import { templateLayoutsFromIr } from '@/lib/template-profile';

/**
 * Зарегистрировать разобранный шаблон в библиотеке. Настоящий импортёр отправляет файл целиком
 * в API: API сохраняет его и передаёт путь Python-движку, поэтому профиль строится по
 * содержимому конкретного файла.
 */
async function registerTemplate(file: File): Promise<TemplateSummary> {
  const form = new FormData();
  form.set('file', file);
  const response = await fetch(`${apiBaseUrl}/files/template`, { method: 'POST', body: form });
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { detail?: unknown; message?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (typeof body.message === 'string') detail = body.message;
    } catch {
      // Keep the HTTP status when the proxy returned a non-JSON error page.
    }
    throw new Error(`Template upload failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const payload = (await response.json()) as {
    fileId: string;
    fileName: string;
    profile?: { designSystem?: unknown; templateIr?: unknown; previewDataUrl?: unknown };
  };
  const designSystem = designSystemSchema.parse(payload.profile?.designSystem);
  const templateIr = templateIrSchema.parse(payload.profile?.templateIr);
  return {
    templateId: payload.fileId,
    fileName: payload.fileName,
    importedAt: Date.now(),
    layouts: templateLayoutsFromIr(templateIr),
    designSystem,
    templateIr,
    previewDataUrl:
      typeof payload.profile?.previewDataUrl === 'string'
        ? payload.profile.previewDataUrl
        : undefined,
  };
}

/** Импорты шаблонов: карточка «Прикрепить шаблон» проекта и агент в разговоре. */
export const templateImporter = createDemoTemplateImporter({
  register: registerTemplate,
  profilesFiles: true,
});
export const templateImports = createTemplateImports(templateImporter);

const httpGenerator = createHttpGenerator();
const deckGenerator: typeof httpGenerator = {
  ...httpGenerator,
  async generate(...args) {
    const result = await httpGenerator.generate(...args);
    await refreshLibraryAction();
    return result;
  },
};

/**
 * Сессия ассистента во вкладке: прогоны генерации, разговоры и агент, который их ведёт. Одна на
 * приложение — поле ввода начинает разговор, редактор его продолжает, и переход между
 * страницами ничего не обрывает. Обновили страницу — сессии нет: сервер разговоров не хранит.
 */
export const generationRuns = createGenerationRuns(deckGenerator);
export const assistantThreads = createAssistantThreads();
export const deckConversations = createDeckConversations({
  threads: assistantThreads,
  runs: generationRuns,
  imports: templateImports,
  // Серверным действием: проект, к которому прикрепили шаблон, видят серверные страницы.
  attachTemplate: attachTemplateAction,
  review: createVariantReview(deckSource),
});

const noSubscribe = () => () => undefined;

/** Сторы живут во вкладке: до гидратации их нет, и страница не мигает «не найдено». */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

export function useThread(threadId: string | null): AssistantThread | undefined {
  return useSyncExternalStore(
    assistantThreads.subscribe,
    () => (threadId ? assistantThreads.get(threadId) : undefined),
    () => undefined,
  );
}

/** Разговор, который открыл эту колоду: его продолжает панель редактора. */
export function useThreadForDeck(deckId: string): AssistantThread | undefined {
  return useSyncExternalStore(
    assistantThreads.subscribe,
    () => assistantThreads.forDeck(deckId),
    () => undefined,
  );
}

export function useRun(runId: string | null): GenerationRun | undefined {
  return useSyncExternalStore(
    generationRuns.subscribe,
    () => (runId ? generationRuns.get(runId) : undefined),
    () => undefined,
  );
}

export function useTemplateImport(importId: string | null): TemplateImport | undefined {
  return useSyncExternalStore(
    templateImports.subscribe,
    () => (importId ? templateImports.get(importId) : undefined),
    () => undefined,
  );
}
