import type { DesignSystem, SlideIr } from '@lct/contracts';
import { templateFileProblem } from '../lib/deck-generator';
import { DeckNotFoundError, type Deck, type DeckSource } from '../lib/deck-source';
import {
  DECK_TITLE_MAX_LENGTH,
  InvalidDeckPatchError,
  InvalidProjectPatchError,
  InvalidTemplateFileError,
  PROJECT_NAME_MAX_LENGTH,
  ProjectNotFoundError,
  TemplateNotFoundError,
  type DeckPatch,
  type DeckSummary,
  type LibrarySource,
  type ProjectPatch,
  type ProjectSummary,
  type TemplateSummary,
} from '../lib/library-source';
import { parseProjectAppearance, type ProjectAppearance } from '../lib/project-appearance';
import { DEMO_DECK } from './demo-deck';
import { DEMO_DESIGN_SYSTEM } from './demo-deck/design-system';
import { createDemoDeckSource } from './demo-deck-source';

/**
 * Демо-библиотека: три шаблона, два проекта и несколько презентаций, часть — вне проектов.
 * Второй и третий шаблоны — тот же демо-профиль в другой палитре: настоящих .pptx за ними нет, а
 * меню нужно показать, что шаблоны различаются стилем. У «Отдела продаж» два шаблона; третий не
 * прикреплён ни к одному проекту — им свёрстана презентация вне проектов.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Точка отсчёта дат, чтобы демо-данные не зависели от часов машины и тестов. */
const NOW = Date.UTC(2026, 8, 25, 9, 0);

/**
 * Тот же профиль в другой палитре: цвета заменены по таблице, остальное как было. Хеш шаблона
 * получает свой префикс — для кеша профилей это другой файл.
 */
function recolor(
  system: DesignSystem,
  hashPrefix: string,
  hex: Readonly<Record<string, string>>,
): DesignSystem {
  const swap = (value: string) => hex[value] ?? value;
  return {
    ...system,
    templateHash: system.templateHash.replace(/^.{8}/, hashPrefix),
    palette: system.palette.map((entry) => ({ ...entry, hex: swap(entry.hex) })),
    surfaces: system.surfaces.map((surface) => ({
      ...surface,
      background: swap(surface.background),
      text: swap(surface.text),
      accent: surface.accent === null ? null : swap(surface.accent),
    })),
  };
}

const WARM_DESIGN_SYSTEM = recolor(DEMO_DESIGN_SYSTEM, 'b17e0c42', {
  '3355E0': 'D9480F',
  '14A085': '7048E8',
  F2F4F7: 'FFF4E6',
  '16181D': '1F1A17',
  '5F6673': '6B5E55',
});

const EMERALD_DESIGN_SYSTEM = recolor(DEMO_DESIGN_SYSTEM, 'c3a9e571', {
  '3355E0': '0B7A5F',
  '14A085': 'C2410C',
  F2F4F7: 'ECF5F1',
  '16181D': '12211B',
  '5F6673': '4F6159',
});

// Макеты у демо-шаблонов одни: они ссылаются на роли палитры и рисуются в цветах своего профиля.

const NEUTRAL: TemplateSummary = {
  templateId: 'neutral-16x9',
  fileName: 'Нейтральный 16x9.pptx',
  importedAt: NOW - 12 * DAY,
  layouts: DEMO_DECK.layouts,
  designSystem: DEMO_DESIGN_SYSTEM,
};

const WARM: TemplateSummary = {
  templateId: 'warm-16x9',
  fileName: 'Тёплый корпоративный.pptx',
  importedAt: NOW - 20 * DAY,
  layouts: DEMO_DECK.layouts,
  designSystem: WARM_DESIGN_SYSTEM,
};

const EMERALD: TemplateSummary = {
  templateId: 'emerald-16x9',
  fileName: 'Изумрудный минимал.potx',
  importedAt: NOW - 3 * DAY,
  layouts: DEMO_DECK.layouts,
  designSystem: EMERALD_DESIGN_SYSTEM,
};

const TEMPLATES: readonly TemplateSummary[] = [NEUTRAL, WARM, EMERALD];

/**
 * Профиль, которым демо регистрирует загруженный шаблон. Разбирает .pptx движок, а без него
 * профиль не извлечь: берём нейтральный демо-профиль, и интерфейс честно говорит об этом
 * (`DeckGenerator.profilesUploadedTemplates`).
 */
const IMPORTED_PROFILE: Pick<TemplateSummary, 'layouts' | 'designSystem'> = NEUTRAL;

/** Колода из части демо-слайдов: номера слайдов пересчитаны, как их отдал бы сервер. */
function deckOf(
  deckId: string,
  title: string,
  template: TemplateSummary,
  pick: (slides: readonly SlideIr[]) => readonly SlideIr[],
): Deck {
  const slides = pick(DEMO_DECK.slides).map((slide, index) => ({ ...slide, index }));
  return { ...DEMO_DECK, deckId, title, designSystem: template.designSystem, slides };
}

interface DemoEntry {
  readonly deck: Deck;
  /** null — презентация вне проектов. */
  readonly projectId: string | null;
  readonly templateId: string;
  readonly updatedAt: number;
  readonly auditFindings: number | null;
}

const ENTRIES: readonly DemoEntry[] = [
  {
    deck: DEMO_DECK,
    projectId: 'hackathon',
    templateId: NEUTRAL.templateId,
    updatedAt: NOW - 2 * HOUR,
    auditFindings: 0,
  },
  {
    deck: deckOf('pitch-short', 'Питч за три минуты', NEUTRAL, (all) => [
      ...all.slice(0, 3),
      ...all.slice(-1),
    ]),
    projectId: 'hackathon',
    templateId: NEUTRAL.templateId,
    updatedAt: NOW - 1 * DAY,
    auditFindings: 2,
  },
  {
    deck: deckOf('rollout-plan', 'План внедрения', NEUTRAL, (all) => all.slice(1, 7)),
    projectId: null,
    templateId: NEUTRAL.templateId,
    updatedAt: NOW - 4 * DAY,
    auditFindings: null,
  },
  {
    deck: deckOf('quarter-review', 'Итоги квартала', WARM, (all) => all.slice(0, 9)),
    projectId: 'sales',
    templateId: WARM.templateId,
    updatedAt: NOW - 5 * HOUR,
    auditFindings: 1,
  },
  {
    deck: deckOf('client-offer', 'Предложение клиенту', WARM, (all) => all.slice(4)),
    projectId: 'sales',
    templateId: WARM.templateId,
    updatedAt: NOW - 9 * DAY,
    auditFindings: 0,
  },
  {
    deck: deckOf('partner-report', 'Отчёт для партнёров', NEUTRAL, (all) => all.slice(2, 8)),
    projectId: 'sales',
    templateId: NEUTRAL.templateId,
    updatedAt: NOW - 11 * DAY,
    auditFindings: null,
  },
  {
    deck: deckOf('sales-kickoff', 'Старт сезона продаж', WARM, (all) => [
      ...all.slice(0, 2),
      ...all.slice(6, 10),
    ]),
    projectId: 'sales',
    templateId: WARM.templateId,
    updatedAt: NOW - 15 * DAY,
    auditFindings: 3,
  },
  {
    deck: deckOf('onboarding', 'Адаптация новых сотрудников', EMERALD, (all) => [
      ...all.slice(0, 1),
      ...all.slice(3, 8),
    ]),
    projectId: null,
    templateId: EMERALD.templateId,
    updatedAt: NOW - 2 * DAY,
    auditFindings: 0,
  },
];

/** Что о проекте хранится само по себе. Число презентаций и время правки считаются по колодам. */
interface DemoProject {
  readonly projectId: string;
  readonly name: string;
  readonly appearance: ProjectAppearance;
  /** Прикреплённые шаблоны в порядке прикрепления. */
  readonly templateIds: readonly string[];
  /** Когда проект создан: это время его правки, пока в нём нет презентаций. */
  readonly createdAt: number;
}

/** Разные иконки и цвета, чтобы в меню было видно, как проекты различаются. */
const PROJECTS: readonly DemoProject[] = [
  {
    projectId: 'hackathon',
    name: 'ЛЦТ-2026',
    appearance: { icon: 'rocket', color: 'purple' },
    templateIds: [NEUTRAL.templateId],
    createdAt: NOW - 12 * DAY,
  },
  {
    projectId: 'sales',
    name: 'Отдел продаж',
    appearance: { icon: 'chart', color: 'orange' },
    templateIds: [WARM.templateId, NEUTRAL.templateId],
    createdAt: NOW - 20 * DAY,
  },
];

/** Все демо-колоды в исходном виде, до правок из меню. */
export const DEMO_DECKS: readonly Deck[] = ENTRIES.map((entry) => entry.deck);

function summaryOf(entry: DemoEntry): DeckSummary {
  const { deck } = entry;
  return {
    deckId: deck.deckId,
    projectId: entry.projectId,
    templateId: entry.templateId,
    title: deck.title,
    slideCount: deck.slides.length,
    slideSize: deck.slideSize,
    // Пустой колоды в демо нет: у каждой есть первый слайд.
    cover: deck.slides[0] as SlideIr,
    updatedAt: entry.updatedAt,
    auditFindings: entry.auditFindings,
  };
}

function summaryOfProject(
  project: DemoProject,
  entries: readonly DemoEntry[],
  templates: readonly TemplateSummary[],
): ProjectSummary {
  const own = entries.filter((entry) => entry.projectId === project.projectId);
  return {
    projectId: project.projectId,
    name: project.name,
    appearance: project.appearance,
    templates: project.templateIds.flatMap((id) =>
      templates.filter((template) => template.templateId === id),
    ),
    deckCount: own.length,
    updatedAt: Math.max(project.createdAt, ...own.map((entry) => entry.updatedAt)),
  };
}

const newestFirst = <T extends { readonly updatedAt: number }>(items: readonly T[]) =>
  [...items].sort((a, b) => b.updatedAt - a.updatedAt);

/** Имя проекта без пробелов по краям. Пустое или слишком длинное — `InvalidProjectPatchError`. */
function checkedName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > PROJECT_NAME_MAX_LENGTH) {
    throw new InvalidProjectPatchError('name');
  }
  return trimmed;
}

/** Проект после правки. Правка проверяется целиком до того, как что-то поменяется. */
function patched(project: DemoProject, patch: ProjectPatch): DemoProject {
  let { name, appearance } = project;
  if (patch.name !== undefined) name = checkedName(patch.name);
  if (patch.appearance !== undefined) appearance = parseProjectAppearance(patch.appearance);
  // Время правки проекта — время правки его презентаций: имя и иконка его не двигают.
  return { ...project, name, appearance };
}

/**
 * Колода после правки из меню. Как и у проекта, ни название, ни перенос не двигают время правки:
 * карточка не прыгает в «недавних». Есть ли проект назначения, проверяет вызывающий.
 */
function patchedDeck(entry: DemoEntry, patch: DeckPatch): DemoEntry {
  let { deck, projectId } = entry;
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title === '' || title.length > DECK_TITLE_MAX_LENGTH) {
      throw new InvalidDeckPatchError('title');
    }
    deck = { ...deck, title };
  }
  if (patch.projectId !== undefined) projectId = patch.projectId;
  return { ...entry, deck, projectId };
}

/** Демо-данные целиком: библиотека для меню и источник колод для редактора. */
export interface DemoLibrary {
  readonly library: LibrarySource;
  readonly decks: DeckSource;
}

/**
 * Библиотека и источник колод без сети, над одним состоянием в памяти. Каждый вызов отдаёт
 * свою копию, как отдал бы HTTP-ответ.
 *
 * Правки из меню — имена, иконки, переносы, удаления — видны обоим: переименованная колода
 * открывается в редакторе с новым названием, удалённая отвечает `DeckNotFoundError`. Живут правки,
 * пока жив процесс сервера, и пропадают при его перезапуске. Настоящее хранение — дело API.
 * Новые проекты и шаблоны получают случайные id, как их выдал бы сервер.
 */
export function createDemoLibrary({ seedDemo = true }: { seedDemo?: boolean } = {}): DemoLibrary {
  let entries: readonly DemoEntry[] = seedDemo ? ENTRIES : [];
  let templates: readonly TemplateSummary[] = seedDemo ? TEMPLATES : [];
  let projects: readonly DemoProject[] = (seedDemo ? PROJECTS : []).map((project) => ({
    ...project,
    appearance: parseProjectAppearance(project.appearance),
  }));

  const findProject = (projectId: string) => {
    const project = projects.find((item) => item.projectId === projectId);
    if (!project) throw new ProjectNotFoundError(projectId);
    return project;
  };
  const findTemplate = (templateId: string) => {
    const template = templates.find((item) => item.templateId === templateId);
    if (!template) throw new TemplateNotFoundError(templateId);
    return template;
  };
  const findEntry = (deckId: string) => {
    const entry = entries.find((item) => item.deck.deckId === deckId);
    if (!entry) throw new DeckNotFoundError(deckId);
    return entry;
  };
  const summary = (project: DemoProject) => summaryOfProject(project, entries, templates);
  /** Сохранить проект после правки и отдать его копию. */
  const save = (next: DemoProject) => {
    projects = projects.map((item) => (item.projectId === next.projectId ? next : item));
    return structuredClone(summary(next));
  };

  const library: LibrarySource = {
    async listProjects() {
      return structuredClone(newestFirst(projects.map(summary)));
    },
    async getProject(projectId) {
      return structuredClone(summary(findProject(projectId)));
    },
    async createProject(input) {
      const project: DemoProject = {
        projectId: crypto.randomUUID(),
        name: checkedName(input.name),
        appearance: parseProjectAppearance(input.appearance),
        templateIds: [],
        createdAt: Date.now(),
      };
      projects = [...projects, project];
      return structuredClone(summary(project));
    },
    async updateProject(projectId, patch) {
      return save(patched(findProject(projectId), patch));
    },
    async attachTemplate(projectId, templateId) {
      const project = findProject(projectId);
      findTemplate(templateId);
      if (project.templateIds.includes(templateId)) return structuredClone(summary(project));
      return save({ ...project, templateIds: [...project.templateIds, templateId] });
    },
    async detachTemplate(projectId, templateId) {
      const project = findProject(projectId);
      findTemplate(templateId);
      return save({
        ...project,
        templateIds: project.templateIds.filter((id) => id !== templateId),
      });
    },
    async deleteProject(projectId) {
      findProject(projectId);
      const before = entries.length;
      entries = entries.filter((entry) => entry.projectId !== projectId);
      projects = projects.filter((item) => item.projectId !== projectId);
      return { deletedDecks: before - entries.length };
    },
    async listTemplates() {
      return structuredClone([...templates].sort((a, b) => b.importedAt - a.importedAt));
    },
    async getTemplate(templateId) {
      return structuredClone(findTemplate(templateId));
    },
    async importTemplate(file) {
      const problem = templateFileProblem(file);
      if (problem) throw new InvalidTemplateFileError(problem);
      const template: TemplateSummary = {
        ...IMPORTED_PROFILE,
        templateId: crypto.randomUUID(),
        fileName: file.name,
        importedAt: Date.now(),
      };
      templates = [...templates, template];
      return structuredClone(template);
    },
    async listDecks(filter) {
      const projectId = filter?.projectId;
      const own =
        projectId === undefined
          ? entries
          : entries.filter((entry) => entry.projectId === projectId);
      return structuredClone(newestFirst(own.map(summaryOf)));
    },
    async updateDeck(deckId, patch) {
      const entry = findEntry(deckId);
      if (typeof patch.projectId === 'string') findProject(patch.projectId);
      const next = patchedDeck(entry, patch);
      entries = entries.map((item) => (item.deck.deckId === deckId ? next : item));
      return structuredClone(summaryOf(next));
    },
    async deleteDeck(deckId) {
      findEntry(deckId);
      entries = entries.filter((entry) => entry.deck.deckId !== deckId);
    },
  };

  const decks = createDemoDeckSource(
    (deckId) => entries.find((entry) => entry.deck.deckId === deckId)?.deck,
  );

  return { library, decks };
}

/** Только библиотека, со своим состоянием: для тестов и генератора, которым редактор не нужен. */
export function createDemoLibrarySource(): LibrarySource {
  return createDemoLibrary().library;
}
