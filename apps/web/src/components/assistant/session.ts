'use client';

import { useSyncExternalStore } from 'react';
import {
  attachTemplateAction,
  getTemplateAction,
  importTemplateAction,
} from '@/app/(library)/actions';
import { createAssistantThreads, type AssistantThread } from '@/lib/assistant-threads';
import { createDeckConversations } from '@/lib/deck-conversations';
import { createGenerationRuns, type GenerationRun } from '@/lib/generation-runs';
import {
  InvalidTemplateFileError,
  TemplateNotFoundError,
  type LibrarySource,
  type TemplateSummary,
} from '@/lib/library-source';
import { createTemplateImports, type TemplateImport } from '@/lib/template-imports';
import { createDemoGenerator } from '@/mocks/demo-generator';
import { createDemoTemplateImporter } from '@/mocks/demo-template-importer';
import { deckSource, librarySource } from '@/mocks/sources';

/** Сколько байт начала файла уходит демо-серверу: хватает, чтобы файл не был пустым. */
const DEMO_UPLOAD_HEAD_BYTES = 1024;

/**
 * Зарегистрировать разобранный шаблон в библиотеке — серверным действием: библиотеку, которую
 * видят серверные страницы, держит сервер, а у вкладки своя копия демо-данных.
 *
 * Демо-сервер читает у файла только имя и размер, а тело серверного действия ограничено
 * (по умолчанию 1 МБ) — настоящий .pptx в него не пролезет. Поэтому уходит начало файла под
 * тем же именем: пустым оно не будет, а содержимое демо всё равно не разбирает. Настоящий
 * импортёр отправит файл целиком в API движка, мимо серверных действий.
 */
async function registerTemplate(file: File): Promise<TemplateSummary> {
  const form = new FormData();
  form.set(
    'file',
    new File([file.slice(0, DEMO_UPLOAD_HEAD_BYTES)], file.name, { type: file.type }),
  );
  const result = await importTemplateAction(form);
  if (result.ok) return result.template;
  if (result.reason === 'invalid') throw new Error('Template upload rejected');
  throw new InvalidTemplateFileError(result.reason);
}

/** Импорты шаблонов: карточка «Прикрепить шаблон» проекта и агент в разговоре. */
export const templateImporter = createDemoTemplateImporter({ register: registerTemplate });
export const templateImports = createTemplateImports(templateImporter);

/**
 * Библиотека, которой пользуется демо-генератор вкладки. У вкладки своя копия демо-данных, а
 * шаблоны импортируются на сервере: шаблона, которого копия не знает, генератор ищет там —
 * иначе на только что загруженном шаблоне (или загруженном до обновления страницы) прогон
 * отказал бы с «шаблон не найден».
 */
const tabLibrary: LibrarySource = {
  ...librarySource,
  async getTemplate(templateId) {
    try {
      return await librarySource.getTemplate(templateId);
    } catch (error) {
      if (!(error instanceof TemplateNotFoundError)) throw error;
      const template = await getTemplateAction(templateId);
      if (template) return template;
      throw error;
    }
  },
};

const deckGenerator = createDemoGenerator({ library: tabLibrary, decks: deckSource });

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
});

/** Модели, которыми генератор умеет писать текст. */
export const writerModels = deckGenerator.models;

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
