import type { DesignSystem, SlideIr, TemplateIr } from '@lct/contracts';
import type { SlideLayout, SlideSize } from './deck-source';

export { DeckNotFoundError } from './deck-source';
import type { ProjectAppearance } from './project-appearance';

/**
 * Откуда главное меню берёт проекты и презентации. Как и `DeckSource`, это граница: сейчас за
 * ней демо-данные, потом HTTP-клиент API, и страницы этого не заметят.
 *
 * Шаблон — отдельная сущность библиотеки: его импортируют один раз, профиль извлекается при
 * импорте и дальше переиспользуется. Проект — папка презентаций с прикреплёнными к нему шаблонами:
 * шаблонов может быть несколько или ни одного. Презентация может жить и вне проектов, а свёрстана
 * она всегда каким-то шаблоном — по нему рисуется её обложка.
 *
 * Типы собраны на фронте, потому что в `@lct/contracts` проектов пока нет. Когда API их
 * опишет, источник правды переедет в контракты, а здесь останется реэкспорт.
 */

/** Шаблон библиотеки так, как его показывает меню: файл, дата импорта и извлечённый профиль. */
export interface TemplateSummary {
  readonly templateId: string;
  /** Имя загруженного файла, как его прислал человек. */
  readonly fileName: string;
  /** Когда шаблон импортирован, мс с эпохи. */
  readonly importedAt: number;
  /** Макеты шаблона в порядке файла: по ним рисуется галерея макетов проекта. */
  readonly layouts: readonly SlideLayout[];
  /** Профиль шаблона: палитра, шрифты и сетка. По нему же рисуются миниатюры. */
  readonly designSystem: DesignSystem;
  /** Полный детерминированный результат разбора, если шаблон загружен через API. */
  readonly templateIr?: TemplateIr;
  /** Настоящий PNG первого слайда, отрендеренный Python engine, если доступен. */
  readonly previewDataUrl?: string;
}

export interface ProjectSummary {
  readonly projectId: string;
  readonly name: string;
  /** Иконка и цвет проекта в интерфейсе. Это оформление оболочки, не стиль шаблона. */
  readonly appearance: ProjectAppearance;
  /** Шаблоны, прикреплённые к проекту, в порядке прикрепления. Может быть пусто. */
  readonly templates: readonly TemplateSummary[];
  readonly deckCount: number;
  /** Последняя правка любой презентации проекта, а без них — создание проекта, мс с эпохи. */
  readonly updatedAt: number;
}

export interface DeckSummary {
  readonly deckId: string;
  /** null — презентация вне проектов. */
  readonly projectId: string | null;
  /** Шаблон, которым свёрстана колода: по нему рисуется обложка. */
  readonly templateId: string;
  readonly title: string;
  readonly slideCount: number;
  readonly slideSize: SlideSize;
  /** Первый слайд: по нему рисуется обложка карточки. */
  readonly cover: SlideIr;
  /** Последняя правка, мс с эпохи. */
  readonly updatedAt: number;
  /** Замечаний последнего аудита; null — аудит ещё не запускали. */
  readonly auditFindings: number | null;
}

/** Проекта с таким id нет. */
export class ProjectNotFoundError extends Error {
  override readonly name = 'ProjectNotFoundError';
  readonly projectId: string;

  constructor(projectId: string) {
    super(`Project not found: ${projectId}`);
    this.projectId = projectId;
  }
}

/** Шаблона с таким id нет в библиотеке. */
export class TemplateNotFoundError extends Error {
  override readonly name = 'TemplateNotFoundError';
  readonly templateId: string;

  constructor(templateId: string) {
    super(`Template not found: ${templateId}`);
    this.templateId = templateId;
  }
}

/**
 * Файл не годится в шаблоны: чужое расширение (`type`) или пустой (`empty`) — те же правила,
 * что у `templateFileProblem`. Содержимое проверяет движок при разборе.
 */
export class InvalidTemplateFileError extends Error {
  override readonly name = 'InvalidTemplateFileError';
  readonly problem: 'type' | 'empty';

  constructor(problem: 'type' | 'empty') {
    super(`Invalid template file: ${problem}`);
    this.problem = problem;
  }
}

/** Самое длинное имя проекта, которое примет источник. */
export const PROJECT_NAME_MAX_LENGTH = 120;

/** Новый проект: имя по тем же правилам, что при переименовании, иконка и цвет. */
export interface NewProject {
  readonly name: string;
  readonly appearance: ProjectAppearance;
}

/** Что можно поменять в проекте. Поле, которого нет, остаётся как было. */
export interface ProjectPatch {
  readonly name?: string;
  readonly appearance?: ProjectAppearance;
}

/** Правка проекта не принята: например, пустое имя. Поле — какое именно значение не подошло. */
export class InvalidProjectPatchError extends Error {
  override readonly name = 'InvalidProjectPatchError';
  readonly field: keyof ProjectPatch;

  constructor(field: keyof ProjectPatch) {
    super(`Invalid project ${field}`);
    this.field = field;
  }
}

/** Самое длинное название презентации, которое примет источник. */
export const DECK_TITLE_MAX_LENGTH = 200;

/** Что можно поменять в презентации из меню. Поле, которого нет, остаётся как было. */
export interface DeckPatch {
  readonly title?: string;
  /** Перенести презентацию в другой проект; null — вынести из проектов. */
  readonly projectId?: string | null;
}

/** Правка презентации не принята: например, пустое название. */
export class InvalidDeckPatchError extends Error {
  override readonly name = 'InvalidDeckPatchError';
  readonly field: keyof DeckPatch;

  constructor(field: keyof DeckPatch) {
    super(`Invalid deck ${field}`);
    this.field = field;
  }
}

export interface LibrarySource {
  /** Все проекты, недавно изменённые первыми. */
  listProjects(): Promise<readonly ProjectSummary[]>;
  /** Проект по id. Проекта нет — промис отклоняется с `ProjectNotFoundError`. */
  getProject(projectId: string): Promise<ProjectSummary>;
  /**
   * Презентации, недавно изменённые первыми. С `projectId` — только этого проекта, с `null` —
   * только вне проектов, без него — все.
   */
  listDecks(filter?: { readonly projectId?: string | null }): Promise<readonly DeckSummary[]>;
  /** Все шаблоны библиотеки, недавно импортированные первыми. */
  listTemplates(): Promise<readonly TemplateSummary[]>;
  /** Шаблон по id. Шаблона нет — `TemplateNotFoundError`. */
  getTemplate(templateId: string): Promise<TemplateSummary>;
  /**
   * Создать пустой проект: без шаблонов и презентаций. Имя обрезается по краям; пустое или
   * длиннее `PROJECT_NAME_MAX_LENGTH` — `InvalidProjectPatchError`. Незнакомые иконка и цвет
   * сводятся к значениям по умолчанию.
   */
  createProject(input: NewProject): Promise<ProjectSummary>;
  /**
   * Прикрепить шаблон библиотеки к проекту — он встаёт последним. Уже прикреплён — проект
   * остаётся как был. Проекта нет — `ProjectNotFoundError`, шаблона — `TemplateNotFoundError`.
   */
  attachTemplate(projectId: string, templateId: string): Promise<ProjectSummary>;
  /**
   * Открепить шаблон от проекта. Шаблон остаётся в библиотеке, презентации проекта, свёрстанные
   * им, — как были. Не прикреплён — проект остаётся как был. Ошибки — как у `attachTemplate`.
   */
  detachTemplate(projectId: string, templateId: string): Promise<ProjectSummary>;
  /**
   * Зарегистрировать разобранный шаблон. Разбирает .pptx движок; демо-источник профиль не
   * извлекает и берёт демо-профиль (честно — см. `profilesUploadedTemplates` генератора). Файл не
   * .pptx/.potx или пустой — `InvalidTemplateFileError`.
   */
  importTemplate(file: { readonly name: string; readonly size: number }): Promise<TemplateSummary>;
  /**
   * Переименовать проект или сменить его иконку и цвет. Отдаёт проект после правки. Имя
   * обрезается по краям; пустое или длиннее `PROJECT_NAME_MAX_LENGTH` — `InvalidProjectPatchError`, проекта нет — `ProjectNotFoundError`.
   */
  updateProject(projectId: string, patch: ProjectPatch): Promise<ProjectSummary>;
  /**
   * Переименовать презентацию или перенести её между проектами. Отдаёт её после правки; время
   * правки не двигается — карточка не должна прыгать в списке «недавних» из-за нового названия
   * или папки. Название обрезается по краям; пустое или длиннее `DECK_TITLE_MAX_LENGTH` —
   * `InvalidDeckPatchError`. Колоды нет — `DeckNotFoundError`, проекта назначения —
   * `ProjectNotFoundError`. Правка проверяется целиком до того, как что-то поменяется.
   */
  updateDeck(deckId: string, patch: DeckPatch): Promise<DeckSummary>;
  /** Удалить презентацию насовсем. Колоды нет — `DeckNotFoundError`. */
  deleteDeck(deckId: string): Promise<void>;
  /**
   * Удалить проект вместе со всеми его презентациями. Шаблоны остаются в библиотеке. Отдаёт,
   * сколько презентаций удалено. Проекта нет — `ProjectNotFoundError`.
   */
  deleteProject(projectId: string): Promise<{ readonly deletedDecks: number }>;
}
