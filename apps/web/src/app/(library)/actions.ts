'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  ChatNotFoundError,
  DeckNotFoundError,
  InvalidDeckPatchError,
  InvalidProjectPatchError,
  InvalidTemplateFileError,
  ProjectNotFoundError,
  TemplateNotFoundError,
  type DeckPatch,
  type ProjectPatch,
  type ProjectSummary,
  type TemplateSummary,
} from '@/lib/library-source';
import { parseProjectAppearance, type ProjectAppearance } from '@/lib/project-appearance';
import { librarySource } from '@/mocks/sources';
import { requireAccount } from '../auth-session';

/**
 * Итог правки проекта. Ошибку не бросаем: в сборке для продакшена Next прячет текст
 * исключений серверного действия, а интерфейсу нужно знать, что именно не вышло.
 */
export type ProjectUpdateResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'notFound' | 'invalid' };

/**
 * Переименовать проект, сменить его иконку и цвет или закрепить в боковой панели. После правки
 * перерисовываются все страницы меню: имя, иконка и закрепление видны и в сайдбаре, и в списке
 * проектов.
 *
 * Серверное действие — публичная точка входа, поэтому аргументы проверяем, несмотря на типы.
 */
export async function updateProjectAction(
  projectId: string,
  patch: { name?: string; appearance?: ProjectAppearance; pinned?: boolean },
): Promise<ProjectUpdateResult> {
  await requireAccount();
  if (typeof projectId !== 'string' || typeof patch !== 'object' || patch === null) {
    return { ok: false, reason: 'invalid' };
  }
  const checked: { name?: string; appearance?: ProjectAppearance; pinned?: boolean } = {};
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string') return { ok: false, reason: 'invalid' };
    checked.name = patch.name;
  }
  if (patch.appearance !== undefined) checked.appearance = parseProjectAppearance(patch.appearance);
  if (patch.pinned !== undefined) {
    if (typeof patch.pinned !== 'boolean') return { ok: false, reason: 'invalid' };
    checked.pinned = patch.pinned;
  }
  if (
    checked.name === undefined &&
    checked.appearance === undefined &&
    checked.pinned === undefined
  ) {
    return { ok: false, reason: 'invalid' };
  }

  try {
    await librarySource.updateProject(projectId, checked satisfies ProjectPatch);
  } catch (error) {
    if (error instanceof ProjectNotFoundError) return { ok: false, reason: 'notFound' };
    if (error instanceof InvalidProjectPatchError) return { ok: false, reason: 'invalid' };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Итог правки или удаления из меню. Как и у проекта, ошибку отдаём значением, а не исключением. */
export type LibraryActionResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'notFound' | 'invalid' };

/**
 * Переименовать презентацию. Перерисовываются все страницы: название видно на главной, на
 * странице проекта и в редакторе.
 */
export async function updateDeckAction(
  deckId: string,
  patch: { title?: string },
): Promise<LibraryActionResult> {
  await requireAccount();
  if (typeof deckId !== 'string' || typeof patch !== 'object' || patch === null) {
    return { ok: false, reason: 'invalid' };
  }
  if (typeof patch.title !== 'string') return { ok: false, reason: 'invalid' };

  try {
    await librarySource.updateDeck(deckId, { title: patch.title } satisfies DeckPatch);
  } catch (error) {
    if (error instanceof DeckNotFoundError) return { ok: false, reason: 'notFound' };
    if (error instanceof InvalidDeckPatchError) return { ok: false, reason: 'invalid' };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Удалить презентацию. Уже удалённая — не ошибка для человека: он хотел, чтобы её не было,
 * и её нет. Страницы всё равно перерисовываются, чтобы убрать устаревшую карточку.
 */
export async function refreshLibraryAction(): Promise<void> {
  await requireAccount();
  revalidatePath('/', 'layout');
}

export async function deleteDeckAction(deckId: string): Promise<LibraryActionResult> {
  await requireAccount();
  if (typeof deckId !== 'string') return { ok: false, reason: 'invalid' };
  try {
    await librarySource.deleteDeck(deckId);
  } catch (error) {
    if (!(error instanceof DeckNotFoundError)) throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Удалить проект вместе с его презентациями. С `leave` человек стоит на странице этого
 * проекта: после удаления его уводит на главную. Переход делает само действие — иначе
 * перерисовка успела бы показать страницу 404 на месте удалённого проекта.
 */
export async function deleteProjectAction(
  projectId: string,
  options?: { leave?: boolean },
): Promise<LibraryActionResult> {
  await requireAccount();
  if (typeof projectId !== 'string') return { ok: false, reason: 'invalid' };
  try {
    await librarySource.deleteProject(projectId);
  } catch (error) {
    if (!(error instanceof ProjectNotFoundError)) throw error;
  }
  revalidatePath('/', 'layout');
  if (options?.leave === true) redirect('/');
  return { ok: true };
}

/** Итог создания проекта: id нового проекта, чтобы сразу на него перейти. */
export type CreateProjectResult =
  | { readonly ok: true; readonly projectId: string }
  | { readonly ok: false; readonly reason: 'invalid' };

/**
 * Создать пустой проект. Имя — по тем же правилам, что при переименовании; незнакомые иконка и
 * цвет сводятся к значениям по умолчанию. Новый проект сразу виден в сайдбаре.
 */
export async function createProjectAction(input: {
  name: string;
  appearance: ProjectAppearance;
}): Promise<CreateProjectResult> {
  await requireAccount();
  if (typeof input !== 'object' || input === null || typeof input.name !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  let project: ProjectSummary;
  try {
    project = await librarySource.createProject({
      name: input.name,
      appearance: parseProjectAppearance(input.appearance),
    });
  } catch (error) {
    if (error instanceof InvalidProjectPatchError) return { ok: false, reason: 'invalid' };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true, projectId: project.projectId };
}

/**
 * Прикрепить шаблон библиотеки к проекту. Уже прикреплённый — не ошибка: проект остаётся как был.
 * `notFound` — нет проекта или шаблона.
 */
export async function attachTemplateAction(
  projectId: string,
  templateId: string,
): Promise<LibraryActionResult> {
  await requireAccount();
  return changeTemplates(projectId, templateId, (project, template) =>
    librarySource.attachTemplate(project, template),
  );
}

/**
 * Открепить шаблон от проекта. Шаблон остаётся в библиотеке, презентации проекта — как были.
 * Не прикреплённый — не ошибка.
 */
export async function detachTemplateAction(
  projectId: string,
  templateId: string,
): Promise<LibraryActionResult> {
  await requireAccount();
  return changeTemplates(projectId, templateId, (project, template) =>
    librarySource.detachTemplate(project, template),
  );
}

/** Общая часть прикрепления и открепления: проверка аргументов, ошибки значением, перерисовка. */
async function changeTemplates(
  projectId: string,
  templateId: string,
  change: (projectId: string, templateId: string) => Promise<ProjectSummary>,
): Promise<LibraryActionResult> {
  if (typeof projectId !== 'string' || typeof templateId !== 'string') {
    return { ok: false, reason: 'invalid' };
  }
  try {
    await change(projectId, templateId);
  } catch (error) {
    if (error instanceof ProjectNotFoundError || error instanceof TemplateNotFoundError) {
      return { ok: false, reason: 'notFound' };
    }
    throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Перенести презентацию в другой проект; `null` — вынести из проектов. `notFound` — нет
 * презентации или проекта назначения.
 */
export async function moveDeckAction(
  deckId: string,
  projectId: string | null,
): Promise<LibraryActionResult> {
  await requireAccount();
  if (typeof deckId !== 'string' || (projectId !== null && typeof projectId !== 'string')) {
    return { ok: false, reason: 'invalid' };
  }
  try {
    await librarySource.updateDeck(deckId, { projectId } satisfies DeckPatch);
  } catch (error) {
    if (error instanceof DeckNotFoundError || error instanceof ProjectNotFoundError) {
      return { ok: false, reason: 'notFound' };
    }
    throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/** Итог импорта шаблона: сам шаблон или почему файл не подошёл. */
export type ImportTemplateResult =
  | { readonly ok: true; readonly template: TemplateSummary }
  | { readonly ok: false; readonly reason: 'invalid' | 'type' | 'empty' };

/**
 * Зарегистрировать загруженный шаблон в библиотеке. Файл приходит полем `file` формы: так его
 * можно передать в серверное действие. Разбирает .pptx движок; демо берёт демо-профиль и из
 * файла читает только имя и размер.
 */
export async function importTemplateAction(formData: FormData): Promise<ImportTemplateResult> {
  await requireAccount();
  const file = formData instanceof FormData ? formData.get('file') : null;
  if (!(file instanceof File)) return { ok: false, reason: 'invalid' };
  let template: TemplateSummary;
  try {
    template = await librarySource.importTemplate({ name: file.name, size: file.size });
  } catch (error) {
    if (error instanceof InvalidTemplateFileError) return { ok: false, reason: error.problem };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true, template };
}

/**
 * Шаблон библиотеки по id; нет такого — null. Нужен демо-генератору вкладки: у вкладки своя
 * копия демо-данных, и шаблона, импортированного через сервер, в ней нет. Настоящий генератор
 * спросит шаблон у API сам.
 */
export async function getTemplateAction(templateId: string): Promise<TemplateSummary | null> {
  await requireAccount();
  try {
    return await librarySource.getTemplate(templateId);
  } catch (error) {
    if (error instanceof TemplateNotFoundError) return null;
    throw error;
  }
}

/**
 * Переименовать чат или перенести его в проект вместе с его презентациями — из меню истории.
 * Перерисовываются все страницы меню: чат виден в истории и на странице проекта.
 */
export async function updateChatAction(
  chatId: string,
  patch: { title?: string; projectId?: string | null },
): Promise<LibraryActionResult> {
  await requireAccount();
  if (typeof chatId !== 'string' || typeof patch !== 'object' || patch === null) {
    return { ok: false, reason: 'invalid' };
  }
  const next: { title?: string; projectId?: string | null } = {};
  if (patch.title !== undefined) {
    if (typeof patch.title !== 'string' || patch.title.trim() === '') {
      return { ok: false, reason: 'invalid' };
    }
    next.title = patch.title.trim();
  }
  if (patch.projectId !== undefined) {
    if (patch.projectId !== null && typeof patch.projectId !== 'string') {
      return { ok: false, reason: 'invalid' };
    }
    next.projectId = patch.projectId;
  }
  try {
    await librarySource.updateChat(chatId, next);
  } catch (error) {
    if (error instanceof ChatNotFoundError) return { ok: false, reason: 'notFound' };
    throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Удалить чат вместе с презентациями, собранными в нём. Уже удалённый — не ошибка: его и хотели
 * убрать.
 */
export async function deleteChatAction(chatId: string): Promise<LibraryActionResult> {
  await requireAccount();
  if (typeof chatId !== 'string') return { ok: false, reason: 'invalid' };
  try {
    await librarySource.deleteChat(chatId);
  } catch (error) {
    if (!(error instanceof ChatNotFoundError)) throw error;
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Переименовать шаблон или (администратору) открыть его всем аккаунтам — со страницы «Шаблоны».
 * Чужой шаблон и чужое право API отклоняет: тогда `notFound`.
 */
export async function updateTemplateAction(
  templateId: string,
  patch: { name?: string; shared?: boolean },
): Promise<LibraryActionResult> {
  const account = await requireAccount();
  if (typeof templateId !== 'string' || typeof patch !== 'object' || patch === null) {
    return { ok: false, reason: 'invalid' };
  }
  const next: { name?: string; shared?: boolean } = {};
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || patch.name.trim() === '') {
      return { ok: false, reason: 'invalid' };
    }
    next.name = patch.name.trim();
  }
  if (patch.shared !== undefined) {
    if (typeof patch.shared !== 'boolean' || account.role !== 'admin') {
      return { ok: false, reason: 'invalid' };
    }
    next.shared = patch.shared;
  }
  try {
    await librarySource.updateTemplate(templateId, next);
  } catch (error) {
    if (error instanceof TemplateNotFoundError) return { ok: false, reason: 'notFound' };
    return { ok: false, reason: 'invalid' };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}

/**
 * Убрать шаблон из библиотеки и из проектов. Презентации, свёрстанные им, остаются.
 */
export async function deleteTemplateAction(templateId: string): Promise<LibraryActionResult> {
  await requireAccount();
  if (typeof templateId !== 'string') return { ok: false, reason: 'invalid' };
  try {
    await librarySource.deleteTemplate(templateId);
  } catch (error) {
    if (error instanceof TemplateNotFoundError) return { ok: false, reason: 'notFound' };
    return { ok: false, reason: 'invalid' };
  }
  revalidatePath('/', 'layout');
  return { ok: true };
}
