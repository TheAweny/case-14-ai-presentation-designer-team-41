'use client';

import { useSyncExternalStore } from 'react';
import { attachTemplateAction, refreshLibraryAction } from '@/app/(library)/actions';
import { createAssistantThreads, type AssistantThread } from '@/lib/assistant-threads';
import { createDeckConversations } from '@/lib/deck-conversations';
import { createGenerationRuns, type GenerationRun } from '@/lib/generation-runs';
import type { TemplateSummary } from '@/lib/library-source';
import { createTemplateImports, type TemplateImport } from '@/lib/template-imports';
import { createVariantReview } from '@/lib/variant-review';
import { createHttpGenerator, sentContentId } from '@/lib/http-generation';
import { chatDocumentOf, chatSummaryOf, threadOfChat, type ChatSave } from '@/lib/chat-records';
import { createChatSync } from '@/lib/chat-sync';
import { createDemoTemplateImporter } from '@/mocks/demo-template-importer';
import { deckSource } from '@/mocks/sources';
import { apiFetch } from '@/lib/api';
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
  const response = await apiFetch('/files/template', { method: 'POST', body: form });
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
 * страницами ничего не обрывает. Разговоры сохраняются в API (`chatSync`) и после обновления
 * страницы возвращаются во вкладку (`loadChat`); прогоны генерации — нет: идущая сборка после
 * обновления не досматривается, её итог появится в библиотеке.
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
  contentIdOf: sentContentId,
});

async function saveChat(chatId: string, chat: ChatSave): Promise<void> {
  const response = await apiFetch(`/chats/${encodeURIComponent(chatId)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(chat),
  });
  if (!response.ok) throw new Error(`Chat save failed (${response.status})`);
}

/**
 * Разговоры сохраняются в API по ходу дела: чат переживает обновление страницы и виден с
 * другого устройства. Когда меняется то, что видно в истории, серверные страницы обновляются.
 */
export const chatSync =
  typeof window === 'undefined'
    ? null
    : createChatSync({
        threads: assistantThreads,
        conversations: deckConversations,
        save: saveChat,
        onSaved: (_chatId, listChanged) => {
          if (listChanged) void refreshLibraryAction();
        },
      });

/**
 * Вернуть сохранённый чат во вкладку. Уже открытый во вкладке разговор новее сохранённого и
 * остаётся как есть. Чата нет или он чужой — false.
 */
export async function loadChat(chatId: string): Promise<boolean> {
  if (assistantThreads.get(chatId)) return true;
  const response = await apiFetch(`/chats/${encodeURIComponent(chatId)}`);
  if (response.status === 404 || response.status === 400) return false;
  if (!response.ok) throw new Error(`Chat load failed (${response.status})`);
  const chat = chatDocumentOf(await response.json());
  if (!chat) return false;
  if (assistantThreads.get(chatId)) return true;
  if (chat.conversation?.agent) deckConversations.restore(chatId, chat.conversation.agent);
  const thread = threadOfChat(chat);
  chatSync?.markSaved(thread);
  assistantThreads.hydrate(thread);
  return true;
}

/** Чат, в котором собрана колода, — во вкладку; его id или null, если колода собрана без чата. */
export async function loadChatForDeck(deckId: string): Promise<string | null> {
  const open = assistantThreads.forDeck(deckId);
  if (open) return open.threadId;
  const response = await apiFetch(`/chats?deckId=${encodeURIComponent(deckId)}`);
  if (!response.ok) return null;
  const rows = (await response.json()) as unknown;
  const chat = Array.isArray(rows) ? chatSummaryOf(rows[0]) : null;
  if (!chat) return null;
  return (await loadChat(chat.chatId)) ? chat.chatId : null;
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
