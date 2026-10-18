'use client';

import { useSyncExternalStore } from 'react';
import { refreshLibraryAction } from '@/app/(library)/actions';
import { createChatStore, type ChatView } from '@/lib/chat-store';
import { createGenerationRuns, type GenerationRun } from '@/lib/generation-runs';
import type { TemplateSummary } from '@/lib/library-source';
import { createTemplateImports, type TemplateImport } from '@/lib/template-imports';
import { createHttpGenerator } from '@/lib/http-generation';
import { createDemoTemplateImporter } from '@/mocks/demo-template-importer';
import { apiFetch } from '@/lib/api';
import { uploadErrorMessage } from '@/lib/upload-errors';
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
  let response: Response;
  try {
    response = await apiFetch('/files/template', { method: 'POST', body: form });
  } catch (error) {
    throw new Error(uploadErrorMessage('template', error), { cause: error });
  }
  if (!response.ok) throw new Error(uploadErrorMessage('template', response.status));
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
const { follow } = httpGenerator;
/** Готовая колода появляется в библиотеке: серверные страницы обновляются. */
const deckGenerator: typeof httpGenerator = {
  ...httpGenerator,
  async generate(...args) {
    const result = await httpGenerator.generate(...args);
    await refreshLibraryAction();
    return result;
  },
  ...(follow
    ? {
        async follow(...args) {
          const result = await follow(...args);
          await refreshLibraryAction();
          return result;
        },
      }
    : {}),
};

/**
 * Прогоны генерации во вкладке. Сборку в чате запускает агент на сервере, а вкладка досматривает
 * её прогон (`followBuild`) — отсюда ход сборки в карточке.
 */
export const generationRuns = createGenerationRuns(deckGenerator);

/** Загрузить материал: чат получает его id и имя. */
async function uploadContent(file: File) {
  const body = new FormData();
  body.set('file', file);
  let response: Response;
  try {
    response = await apiFetch('/files/content', { method: 'POST', body });
  } catch (error) {
    throw new Error(uploadErrorMessage('content', error), { cause: error });
  }
  if (!response.ok) throw new Error(uploadErrorMessage('content', response.status));
  const uploaded = (await response.json()) as { fileId: string; fileName?: string };
  return { fileId: uploaded.fileId, name: uploaded.fileName ?? file.name, size: file.size };
}

/**
 * Чаты во вкладке. Разговор ведёт агент на сервере; вкладка отправляет ходы и читает ответ
 * событиями. Ход закончился — серверные страницы обновляются: в истории новый чат или колода.
 */
export const chatStore = createChatStore({
  request: (path, init) => apiFetch(path, init),
  uploadContent,
  async uploadTemplate(file) {
    const template = await registerTemplate(file);
    return { templateId: template.templateId, name: template.fileName };
  },
  onTurnEnd: () => void refreshLibraryAction(),
});

/**
 * Досмотреть сборку, которую запустил агент: её прогон во вкладке ведёт карточку хода. Прогон
 * уже во вкладке — ничего не делает. Повторить такую сборку из карточки нельзя: её перезапускает
 * агент.
 */
export function followBuild(build: {
  readonly runId: string;
  readonly variantRunIds: readonly string[];
  readonly templateId: string;
  readonly startedAt: number;
}): void {
  generationRuns.follow(build.runId, {
    request: {
      templateId: build.templateId,
      projectId: null,
      brief: '',
      files: [],
      slideCount: null,
      model: null,
    },
    returnHref: '/',
    server: { runId: build.runId, variantRunIds: build.variantRunIds },
    startedAt: build.startedAt,
  });
}

const noSubscribe = () => () => undefined;

/** Сторы живут во вкладке: до гидратации их нет, и страница не мигает «не найдено». */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

export function useChat(chatId: string | null): ChatView | undefined {
  return useSyncExternalStore(
    chatStore.subscribe,
    () => (chatId ? chatStore.get(chatId) : undefined),
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
