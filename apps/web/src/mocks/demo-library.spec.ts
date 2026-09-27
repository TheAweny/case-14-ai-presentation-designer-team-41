import { describe, expect, it } from 'vitest';
import { auditStatusOf } from '../components/library/audit-status';
import {
  DECK_TITLE_MAX_LENGTH,
  DeckNotFoundError,
  InvalidDeckPatchError,
  InvalidProjectPatchError,
  InvalidTemplateFileError,
  PROJECT_NAME_MAX_LENGTH,
  ProjectNotFoundError,
  TemplateNotFoundError,
} from '../lib/library-source';
import { parseProjectAppearance } from '../lib/project-appearance';
import { createDemoLibrary, createDemoLibrarySource } from './demo-library';
const { decks: deckSource, library: librarySource } = createDemoLibrary();

const isNewestFirst = (items: readonly { readonly updatedAt: number }[]) =>
  items.every((item, index) => index === 0 || (items[index - 1]?.updatedAt ?? 0) >= item.updatedAt);

describe('createDemoLibrarySource', () => {
  it('отдаёт проекты, недавно изменённые первыми', async () => {
    const projects = await createDemoLibrarySource().listProjects();
    expect(projects.length).toBeGreaterThan(1);
    expect(isNewestFirst(projects)).toBe(true);
  });

  it('отдаёт все колоды, недавно изменённые первыми', async () => {
    const decks = await createDemoLibrarySource().listDecks();
    expect(decks.length).toBeGreaterThan(1);
    expect(isNewestFirst(decks)).toBe(true);
  });

  it('с projectId отдаёт только колоды этого проекта, и их столько, сколько в проекте', async () => {
    const source = createDemoLibrarySource();
    for (const project of await source.listProjects()) {
      const decks = await source.listDecks({ projectId: project.projectId });
      expect(decks.length).toBe(project.deckCount);
      expect(decks.every((deck) => deck.projectId === project.projectId)).toBe(true);
      expect(isNewestFirst(decks)).toBe(true);
    }
  });

  it('у каждой колоды есть шаблон библиотеки, а проект — из списка или его нет', async () => {
    const source = createDemoLibrarySource();
    const projects = new Set((await source.listProjects()).map((project) => project.projectId));
    const templates = new Set((await source.listTemplates()).map((item) => item.templateId));
    for (const deck of await source.listDecks()) {
      expect(templates.has(deck.templateId)).toBe(true);
      if (deck.projectId !== null) expect(projects.has(deck.projectId)).toBe(true);
    }
  });

  it('с projectId: null отдаёт только колоды вне проектов', async () => {
    const source = createDemoLibrarySource();
    const loose = await source.listDecks({ projectId: null });
    expect(loose.length).toBeGreaterThan(0);
    expect(loose.every((deck) => deck.projectId === null)).toBe(true);
    expect(isNewestFirst(loose)).toBe(true);
    const all = await source.listDecks();
    expect(all.filter((deck) => deck.projectId === null)).toEqual(loose);
  });

  it('обложка колоды нарисована профилем её шаблона', async () => {
    const { library, decks } = createDemoLibrary();
    for (const summary of await library.listDecks()) {
      const template = await library.getTemplate(summary.templateId);
      expect((await decks.getDeck(summary.deckId)).designSystem).toEqual(template.designSystem);
    }
  });

  it('находит проект по id', async () => {
    const source = createDemoLibrarySource();
    const [first] = await source.listProjects();
    expect(first).toBeDefined();
    await expect(source.getProject(first?.projectId ?? '')).resolves.toEqual(first);
  });

  it('на неизвестный id отвечает ProjectNotFoundError', async () => {
    const error: unknown = await createDemoLibrarySource()
      .getProject('missing')
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProjectNotFoundError);
    expect(error).toMatchObject({ name: 'ProjectNotFoundError', projectId: 'missing' });
  });

  it('отдаёт копию: правка ответа не меняет следующий', async () => {
    const source = createDemoLibrarySource();

    const decks = await source.listDecks();
    const first = decks[0];
    expect(first).toBeDefined();
    const title = first?.title;
    // Типы ответа только для чтения; правим в обход них, как мог бы ошибиться вызывающий код.
    if (first) Object.assign(first, { title: 'changed' });
    first?.cover.elements.splice(0);
    const again = await source.listDecks();
    expect(again[0]?.title).toBe(title);
    expect(again[0]?.cover.elements.length).toBeGreaterThan(0);

    const projects = await source.listProjects();
    projects[0]?.templates[0]?.designSystem.palette.splice(0);
    const project = await source.getProject(projects[0]?.projectId ?? '');
    expect(project.templates[0]?.designSystem.palette.length).toBeGreaterThan(0);

    const templates = await source.listTemplates();
    templates[0]?.designSystem.palette.splice(0);
    expect((await source.listTemplates())[0]?.designSystem.palette.length).toBeGreaterThan(0);
  });

  it('каждая карточка открывается в редакторе тем же источником колод', async () => {
    for (const summary of await librarySource.listDecks()) {
      const deck = await deckSource.getDeck(summary.deckId);
      expect(deck.title).toBe(summary.title);
      expect(deck.slides.length).toBe(summary.slideCount);
      expect(deck.slides[0]).toEqual(summary.cover);
    }
  });
});

describe('проекты демо-библиотеки', () => {
  it('у каждого проекта знакомые иконка и цвет, и у разных проектов они разные', async () => {
    const projects = await createDemoLibrarySource().listProjects();
    for (const project of projects) {
      expect(parseProjectAppearance(project.appearance)).toEqual(project.appearance);
    }
    const looks = new Set(projects.map((p) => `${p.appearance.icon}/${p.appearance.color}`));
    expect(looks.size).toBe(projects.length);
  });

  it('у шаблона есть макеты, и каждый нарисован в размере слайда профиля', async () => {
    for (const { layouts, designSystem } of await createDemoLibrarySource().listTemplates()) {
      expect(layouts.length).toBeGreaterThan(0);
      expect(new Set(layouts.map((layout) => layout.slide.patternId)).size).toBe(layouts.length);
      for (const layout of layouts) {
        expect(layout.name.trim()).not.toBe('');
        expect(layout.slide.slideCx).toBe(designSystem.grid.slideCx);
        expect(layout.slide.slideCy).toBe(designSystem.grid.slideCy);
      }
    }
  });
});

describe('updateProject', () => {
  it('переименовывает проект, обрезая имя по краям, и имя видно в следующих ответах', async () => {
    const source = createDemoLibrarySource();
    const updated = await source.updateProject('sales', { name: '  Продажи 2027  ' });
    expect(updated.name).toBe('Продажи 2027');
    expect((await source.getProject('sales')).name).toBe('Продажи 2027');
    const listed = (await source.listProjects()).find((p) => p.projectId === 'sales');
    expect(listed?.name).toBe('Продажи 2027');
  });

  it('меняет иконку и цвет, не трогая имя и время правки', async () => {
    const source = createDemoLibrarySource();
    const before = await source.getProject('hackathon');
    const updated = await source.updateProject('hackathon', {
      appearance: { icon: 'trophy', color: 'teal' },
    });
    expect(updated.appearance).toEqual({ icon: 'trophy', color: 'teal' });
    expect(updated.name).toBe(before.name);
    expect(updated.updatedAt).toBe(before.updatedAt);
    expect((await source.getProject('hackathon')).appearance).toEqual(updated.appearance);
  });

  it('незнакомый внешний вид сводит к значению по умолчанию, а не сохраняет как есть', async () => {
    const source = createDemoLibrarySource();
    const appearance = { icon: 'unicorn', color: 'blue' } as unknown as Parameters<
      typeof source.updateProject
    >[1]['appearance'];
    const updated = await source.updateProject('sales', { appearance });
    expect(updated.appearance).toEqual({ icon: 'folder', color: 'blue' });
  });

  it('пустое или слишком длинное имя отклоняет и ничего не меняет', async () => {
    const source = createDemoLibrarySource();
    const before = await source.getProject('sales');
    for (const name of ['', '   ', 'я'.repeat(PROJECT_NAME_MAX_LENGTH + 1)]) {
      const error: unknown = await source
        .updateProject('sales', { name, appearance: { icon: 'star', color: 'red' } })
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(InvalidProjectPatchError);
      expect(error).toMatchObject({ field: 'name' });
    }
    expect(await source.getProject('sales')).toEqual(before);
  });

  it('на неизвестный проект отвечает ProjectNotFoundError', async () => {
    const error: unknown = await createDemoLibrarySource()
      .updateProject('missing', { name: 'Новое имя' })
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ProjectNotFoundError);
  });

  it('правка одного экземпляра не видна другому', async () => {
    await createDemoLibrarySource().updateProject('sales', { name: 'Только здесь' });
    expect((await createDemoLibrarySource().getProject('sales')).name).not.toBe('Только здесь');
  });

  it('отдаёт копию: правка ответа не меняет хранимый проект', async () => {
    const source = createDemoLibrarySource();
    const updated = await source.updateProject('sales', { name: 'Копия' });
    Object.assign(updated, { name: 'changed' });
    expect((await source.getProject('sales')).name).toBe('Копия');
  });
});

/** Отказ промиса как значение: так удобнее проверить класс и поля ошибки. */
const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );

describe('updateDeck', () => {
  it('переименовывает колоду, обрезая название, и редактор открывает её с новым названием', async () => {
    const { library, decks } = createDemoLibrary();
    const updated = await library.updateDeck('pitch-short', { title: '  Питч для жюри  ' });
    expect(updated.title).toBe('Питч для жюри');
    const listed = (await library.listDecks()).find((deck) => deck.deckId === 'pitch-short');
    expect(listed?.title).toBe('Питч для жюри');
    expect((await decks.getDeck('pitch-short')).title).toBe('Питч для жюри');
  });

  it('не двигает время правки и порядок недавних', async () => {
    const { library } = createDemoLibrary();
    const before = await library.listDecks();
    await library.updateDeck('rollout-plan', { title: 'Другое название' });
    const after = await library.listDecks();
    expect(after.map((deck) => deck.deckId)).toEqual(before.map((deck) => deck.deckId));
    expect(after.find((deck) => deck.deckId === 'rollout-plan')?.updatedAt).toBe(
      before.find((deck) => deck.deckId === 'rollout-plan')?.updatedAt,
    );
  });

  it('пустое или слишком длинное название отклоняет и ничего не меняет', async () => {
    const { library, decks } = createDemoLibrary();
    const before = await decks.getDeck('pitch-short');
    for (const title of ['', '  ', 'я'.repeat(DECK_TITLE_MAX_LENGTH + 1)]) {
      const error = await rejection(library.updateDeck('pitch-short', { title }));
      expect(error).toBeInstanceOf(InvalidDeckPatchError);
      expect(error).toMatchObject({ field: 'title' });
    }
    expect((await decks.getDeck('pitch-short')).title).toBe(before.title);
  });

  it('на неизвестную колоду отвечает DeckNotFoundError', async () => {
    const error = await rejection(
      createDemoLibrarySource().updateDeck('missing', { title: 'Новое' }),
    );
    expect(error).toBeInstanceOf(DeckNotFoundError);
    expect(error).toMatchObject({ deckId: 'missing' });
  });
});

describe('deleteDeck', () => {
  it('убирает колоду из списков, пересчитывает проект, а редактор отвечает DeckNotFoundError', async () => {
    const { library, decks } = createDemoLibrary();
    const project = await library.getProject('sales');
    await library.deleteDeck('client-offer');

    const all = await library.listDecks();
    expect(all.some((deck) => deck.deckId === 'client-offer')).toBe(false);
    const own = await library.listDecks({ projectId: 'sales' });
    expect(own.length).toBe(project.deckCount - 1);
    expect((await library.getProject('sales')).deckCount).toBe(project.deckCount - 1);
    expect(await rejection(decks.getDeck('client-offer'))).toBeInstanceOf(DeckNotFoundError);
  });

  it('повторное удаление и неизвестная колода — DeckNotFoundError', async () => {
    const library = createDemoLibrarySource();
    await library.deleteDeck('client-offer');
    expect(await rejection(library.deleteDeck('client-offer'))).toBeInstanceOf(DeckNotFoundError);
    expect(await rejection(library.deleteDeck('missing'))).toBeInstanceOf(DeckNotFoundError);
  });

  it('удаление в одном экземпляре не видно другому', async () => {
    await createDemoLibrarySource().deleteDeck('client-offer');
    const decks = await createDemoLibrarySource().listDecks();
    expect(decks.some((deck) => deck.deckId === 'client-offer')).toBe(true);
  });
});

describe('deleteProject', () => {
  it('удаляет проект вместе с его колодами и отдаёт, сколько удалено', async () => {
    const { library, decks } = createDemoLibrary();
    const project = await library.getProject('sales');
    const own = await library.listDecks({ projectId: 'sales' });
    const others = (await library.listDecks()).filter((deck) => deck.projectId !== 'sales');
    expect(own.length).toBeGreaterThan(0);

    await expect(library.deleteProject('sales')).resolves.toEqual({
      deletedDecks: project.deckCount,
    });

    expect((await library.listProjects()).some((item) => item.projectId === 'sales')).toBe(false);
    expect(await rejection(library.getProject('sales'))).toBeInstanceOf(ProjectNotFoundError);
    expect(await library.listDecks({ projectId: 'sales' })).toEqual([]);
    expect(await library.listDecks()).toEqual(others);
    for (const deck of own) {
      expect(await rejection(decks.getDeck(deck.deckId))).toBeInstanceOf(DeckNotFoundError);
    }
    // Колоды других проектов по-прежнему открываются.
    for (const deck of others) {
      await expect(decks.getDeck(deck.deckId)).resolves.toMatchObject({ deckId: deck.deckId });
    }
  });

  it('на неизвестный проект отвечает ProjectNotFoundError и ничего не удаляет', async () => {
    const library = createDemoLibrarySource();
    const before = await library.listDecks();
    expect(await rejection(library.deleteProject('missing'))).toBeInstanceOf(ProjectNotFoundError);
    expect(await library.listDecks()).toEqual(before);
  });

  it('удалённый проект нельзя ни править, ни удалить ещё раз', async () => {
    const library = createDemoLibrarySource();
    await library.deleteProject('hackathon');
    expect(await rejection(library.updateProject('hackathon', { name: 'Снова' }))).toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(await rejection(library.deleteProject('hackathon'))).toBeInstanceOf(
      ProjectNotFoundError,
    );
  });
});

describe('шаблоны библиотеки', () => {
  it('отдаёт шаблоны, недавно импортированные первыми, и находит шаблон по id', async () => {
    const source = createDemoLibrarySource();
    const templates = await source.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(3);
    expect(
      templates.every(
        (item, index) => index === 0 || (templates[index - 1]?.importedAt ?? 0) >= item.importedAt,
      ),
    ).toBe(true);
    const [first] = templates;
    await expect(source.getTemplate(first?.templateId ?? '')).resolves.toEqual(first);
  });

  it('на неизвестный шаблон отвечает TemplateNotFoundError', async () => {
    const error = await rejection(createDemoLibrarySource().getTemplate('missing'));
    expect(error).toBeInstanceOf(TemplateNotFoundError);
    expect(error).toMatchObject({ name: 'TemplateNotFoundError', templateId: 'missing' });
  });

  it('у проекта может быть несколько шаблонов, в порядке прикрепления', async () => {
    const sales = await createDemoLibrarySource().getProject('sales');
    expect(sales.templates.map((item) => item.templateId)).toEqual(['warm-16x9', 'neutral-16x9']);
  });
});

describe('createProject', () => {
  it('создаёт пустой проект с обрезанным именем, и он виден в списке', async () => {
    const source = createDemoLibrarySource();
    const project = await source.createProject({
      name: '  Маркетинг  ',
      appearance: { icon: 'star', color: 'teal' },
    });
    expect(project).toMatchObject({
      name: 'Маркетинг',
      appearance: { icon: 'star', color: 'teal' },
      templates: [],
      deckCount: 0,
    });
    await expect(source.getProject(project.projectId)).resolves.toEqual(project);
    expect((await source.listProjects()).some((p) => p.projectId === project.projectId)).toBe(true);
    expect(await source.listDecks({ projectId: project.projectId })).toEqual([]);
  });

  it('каждый новый проект получает свой id', async () => {
    const source = createDemoLibrarySource();
    const input = { name: 'Дубль', appearance: { icon: 'folder', color: 'blue' } } as const;
    const a = await source.createProject(input);
    const b = await source.createProject(input);
    expect(a.projectId).not.toBe(b.projectId);
  });

  it('пустое или слишком длинное имя отклоняет и проект не создаёт', async () => {
    const source = createDemoLibrarySource();
    const before = await source.listProjects();
    for (const name of ['', '   ', 'я'.repeat(PROJECT_NAME_MAX_LENGTH + 1)]) {
      const error = await rejection(
        source.createProject({ name, appearance: { icon: 'star', color: 'red' } }),
      );
      expect(error).toBeInstanceOf(InvalidProjectPatchError);
      expect(error).toMatchObject({ field: 'name' });
    }
    expect(await source.listProjects()).toEqual(before);
  });

  it('незнакомый внешний вид сводит к значению по умолчанию', async () => {
    const appearance = { icon: 'unicorn', color: 'blue' } as unknown as Parameters<
      ReturnType<typeof createDemoLibrarySource>['createProject']
    >[0]['appearance'];
    const project = await createDemoLibrarySource().createProject({ name: 'Проект', appearance });
    expect(project.appearance).toEqual({ icon: 'folder', color: 'blue' });
  });
});

describe('attachTemplate и detachTemplate', () => {
  it('прикрепляет шаблон последним, повторное прикрепление ничего не меняет', async () => {
    const source = createDemoLibrarySource();
    const attached = await source.attachTemplate('hackathon', 'emerald-16x9');
    expect(attached.templates.map((item) => item.templateId)).toEqual([
      'neutral-16x9',
      'emerald-16x9',
    ]);
    await expect(source.attachTemplate('hackathon', 'emerald-16x9')).resolves.toEqual(attached);
    await expect(source.getProject('hackathon')).resolves.toEqual(attached);
  });

  it('открепляет шаблон: он остаётся в библиотеке, презентации проекта — как были', async () => {
    const source = createDemoLibrarySource();
    const decksBefore = await source.listDecks({ projectId: 'sales' });
    const detached = await source.detachTemplate('sales', 'warm-16x9');
    expect(detached.templates.map((item) => item.templateId)).toEqual(['neutral-16x9']);
    expect(detached.deckCount).toBe(decksBefore.length);
    expect(await source.listDecks({ projectId: 'sales' })).toEqual(decksBefore);
    await expect(source.getTemplate('warm-16x9')).resolves.toMatchObject({
      templateId: 'warm-16x9',
    });
    // Не прикреплённый шаблон открепить — не ошибка.
    await expect(source.detachTemplate('sales', 'warm-16x9')).resolves.toEqual(detached);
  });

  it('неизвестный проект или шаблон — ошибка, и ничего не меняется', async () => {
    const source = createDemoLibrarySource();
    const before = await source.getProject('sales');
    expect(await rejection(source.attachTemplate('missing', 'warm-16x9'))).toBeInstanceOf(
      ProjectNotFoundError,
    );
    expect(await rejection(source.attachTemplate('sales', 'missing'))).toBeInstanceOf(
      TemplateNotFoundError,
    );
    expect(await rejection(source.detachTemplate('sales', 'missing'))).toBeInstanceOf(
      TemplateNotFoundError,
    );
    await expect(source.getProject('sales')).resolves.toEqual(before);
  });

  it('удаление проекта оставляет его шаблоны в библиотеке', async () => {
    const source = createDemoLibrarySource();
    const before = await source.listTemplates();
    await source.deleteProject('sales');
    expect(await source.listTemplates()).toEqual(before);
  });
});

describe('importTemplate', () => {
  it('регистрирует шаблон с именем файла и демо-профилем, он первый среди недавних', async () => {
    const source = createDemoLibrarySource();
    const template = await source.importTemplate({ name: 'Бренд 2027.potx', size: 2048 });
    expect(template.fileName).toBe('Бренд 2027.potx');
    expect(template.layouts.length).toBeGreaterThan(0);
    expect(template.designSystem.palette.length).toBeGreaterThan(0);
    expect((await source.listTemplates())[0]).toEqual(template);
    await expect(source.getTemplate(template.templateId)).resolves.toEqual(template);
    // Импорт не прикрепляет шаблон ни к одному проекту.
    for (const project of await source.listProjects()) {
      expect(project.templates.some((item) => item.templateId === template.templateId)).toBe(false);
    }
  });

  it('два импорта одного файла — два разных шаблона', async () => {
    const source = createDemoLibrarySource();
    const file = { name: 'Бренд.pptx', size: 10 };
    const a = await source.importTemplate(file);
    const b = await source.importTemplate(file);
    expect(a.templateId).not.toBe(b.templateId);
  });

  it('не .pptx/.potx или пустой файл отклоняет и ничего не регистрирует', async () => {
    const source = createDemoLibrarySource();
    const before = await source.listTemplates();
    expect(await rejection(source.importTemplate({ name: 'бриф.docx', size: 10 }))).toMatchObject({
      name: 'InvalidTemplateFileError',
      problem: 'type',
    });
    const empty = await rejection(source.importTemplate({ name: 'Пустой.pptx', size: 0 }));
    expect(empty).toBeInstanceOf(InvalidTemplateFileError);
    expect(empty).toMatchObject({ problem: 'empty' });
    expect(await source.listTemplates()).toEqual(before);
  });

  it('импортированный шаблон можно прикрепить к проекту', async () => {
    const source = createDemoLibrarySource();
    const template = await source.importTemplate({ name: 'Бренд.pptx', size: 10 });
    const project = await source.attachTemplate('hackathon', template.templateId);
    expect(project.templates.at(-1)).toEqual(template);
  });
});

describe('перенос презентации (updateDeck с projectId)', () => {
  it('переносит колоду в другой проект, пересчитывая оба, и не двигает время правки', async () => {
    const source = createDemoLibrarySource();
    const [sales, hackathon] = await Promise.all([
      source.getProject('sales'),
      source.getProject('hackathon'),
    ]);
    const before = (await source.listDecks()).find((deck) => deck.deckId === 'client-offer');
    const moved = await source.updateDeck('client-offer', { projectId: 'hackathon' });
    expect(moved.projectId).toBe('hackathon');
    expect(moved.updatedAt).toBe(before?.updatedAt);
    expect(moved.title).toBe(before?.title);
    expect((await source.getProject('sales')).deckCount).toBe(sales.deckCount - 1);
    expect((await source.getProject('hackathon')).deckCount).toBe(hackathon.deckCount + 1);
    const own = await source.listDecks({ projectId: 'hackathon' });
    expect(own.some((deck) => deck.deckId === 'client-offer')).toBe(true);
  });

  it('с null выносит колоду из проектов, и обратно — в проект', async () => {
    const source = createDemoLibrarySource();
    await source.updateDeck('quarter-review', { projectId: null });
    const loose = await source.listDecks({ projectId: null });
    expect(loose.some((deck) => deck.deckId === 'quarter-review')).toBe(true);
    await source.updateDeck('rollout-plan', { projectId: 'sales' });
    const sales = await source.listDecks({ projectId: 'sales' });
    expect(sales.some((deck) => deck.deckId === 'rollout-plan')).toBe(true);
    expect(sales.some((deck) => deck.deckId === 'quarter-review')).toBe(false);
  });

  it('в несуществующий проект не переносит и не применяет остальную правку', async () => {
    const source = createDemoLibrarySource();
    const before = await source.listDecks();
    const error = await rejection(
      source.updateDeck('client-offer', { title: 'Новое', projectId: 'missing' }),
    );
    expect(error).toBeInstanceOf(ProjectNotFoundError);
    expect(await source.listDecks()).toEqual(before);
  });

  it('переименование и перенос одной правкой', async () => {
    const source = createDemoLibrarySource();
    const updated = await source.updateDeck('onboarding', {
      title: ' Адаптация ',
      projectId: 'hackathon',
    });
    expect(updated).toMatchObject({ title: 'Адаптация', projectId: 'hackathon' });
  });
});

describe('auditStatusOf', () => {
  it('null — аудит не запускали', () => {
    expect(auditStatusOf(null)).toEqual({ kind: 'notRun' });
  });

  it('ноль замечаний — чисто', () => {
    expect(auditStatusOf(0)).toEqual({ kind: 'clean' });
  });

  it('замечания — их число', () => {
    expect(auditStatusOf(3)).toEqual({ kind: 'findings', count: 3 });
  });
});
