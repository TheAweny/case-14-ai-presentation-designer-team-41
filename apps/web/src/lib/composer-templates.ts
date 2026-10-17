import {
  CONTENT_FILE_ACCEPT,
  TEMPLATE_EXTENSIONS,
  addContentFiles,
  extensionOf,
  templateFileProblem,
} from './deck-generator';
import type { ProjectSummary, TemplateSummary } from './library-source';

/**
 * Чем собирать презентацию из поля генерации: шаблон библиотеки или новый файл шаблона. Модуль
 * без React — выбор по умолчанию и то, как файлы делятся на материалы и шаблон, проверяются
 * тестами.
 *
 * Шаблон — не часть проекта, а сущность библиотеки: на странице проекта первыми предлагаются
 * его шаблоны, но выбрать можно любой. Новый файл шаблона разбирает агент в разговоре, пока поле
 * только держит его чипом.
 */

/** Шаблоны меню: прикреплённые к проекту страницы и остальные шаблоны библиотеки. */
export interface TemplateGroups {
  /** Шаблоны проекта в порядке прикрепления; на главной — пусто. */
  readonly own: readonly TemplateSummary[];
  /** Остальные шаблоны библиотеки, недавно импортированные первыми. */
  readonly others: readonly TemplateSummary[];
}

export function templateGroups(
  library: readonly TemplateSummary[],
  project: ProjectSummary | null,
): TemplateGroups {
  const own = project?.templates ?? [];
  const ownIds = new Set(own.map((template) => template.templateId));
  return {
    own,
    others: [...library]
      .filter((template) => !ownIds.has(template.templateId))
      .sort((a, b) => b.importedAt - a.importedAt),
  };
}

/**
 * Шаблон, который можно было бы предложить: в проекте — первый прикреплённый, на главной —
 * самый свежий. Поле его не подставляет. Чип появляется, только когда человек выбрал сам.
 */
export function defaultTemplate(
  library: readonly TemplateSummary[],
  project: ProjectSummary | null,
): TemplateSummary | null {
  if (project) return project.templates[0] ?? null;
  return templateGroups(library, null).others[0] ?? null;
}

/**
 * Шаблон, который человек выбрал сам. Пока выбора нет — null: поле не подставляет «самый свежий»
 * и не возвращает его, когда чип сняли. Выбор пропадает, если шаблон удалили, пока поле открыто.
 */
export function chosenTemplate(
  library: readonly TemplateSummary[],
  project: ProjectSummary | null,
  pickedId: string | null,
): TemplateSummary | null {
  if (pickedId === null) return null;
  const { own, others } = templateGroups(library, project);
  return [...own, ...others].find((template) => template.templateId === pickedId) ?? null;
}

/** Файл шаблона: .pptx и .potx в контент-пак не идут — это всегда шаблон. */
/**
 * Название шаблона для интерфейса: имя файла без расширения. В кнопке и в строке под сообщением
 * это название, а не файл; полное имя остаётся в подсказке.
 */
export function templateTitle(fileName: string): string {
  const title = fileName.replace(/\.(pptx|potx)$/i, '');
  return title === '' ? fileName : title;
}

export function isTemplateFile(fileName: string): boolean {
  return (TEMPLATE_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/** Значение `accept` скрепки: и материалы, и шаблоны. */
export const COMPOSER_FILE_ACCEPT = [CONTENT_FILE_ACCEPT, ...TEMPLATE_EXTENSIONS].join(',');

/** Значение `accept` пункта «Загрузить шаблон…». */
export const TEMPLATE_FILE_ACCEPT = TEMPLATE_EXTENSIONS.join(',');

/** Вложения поля: материалы контент-пака и, может быть, новый файл шаблона. */
export interface ComposerAttachments {
  readonly files: readonly File[];
  /** Новый шаблон: пока он есть, он заменяет шаблон, выбранный в меню. */
  readonly templateFile: File | null;
}

export interface ComposerAttachmentsUpdate extends ComposerAttachments {
  /** Имена файлов, которые не подошли ни в материалы, ни в шаблоны. */
  readonly rejected: readonly string[];
}

/**
 * Добавить файлы в поле. Файлы шаблона становятся чипом шаблона: шаблон у презентации один,
 * поэтому последний годный файл заменяет прежний. Пустой файл шаблона не годится
 * (`templateFileProblem`) и уходит в отказы вместе с чужими типами.
 */
export function addComposerFiles(
  current: ComposerAttachments,
  added: readonly File[],
): ComposerAttachmentsUpdate {
  const templates = added.filter((file) => isTemplateFile(file.name));
  const good = templates.filter((file) => templateFileProblem(file) === null);
  const content = addContentFiles(
    current.files,
    added.filter((file) => !isTemplateFile(file.name)),
  );
  return {
    files: content.files,
    templateFile: good.at(-1) ?? current.templateFile,
    rejected: [
      ...templates.filter((file) => !good.includes(file)).map((file) => file.name),
      ...content.rejected,
    ],
  };
}
