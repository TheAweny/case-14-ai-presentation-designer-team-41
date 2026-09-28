import { describe, expect, it } from 'vitest';
import { createDemoLibrarySource } from '../mocks/demo-library';
import {
  addComposerFiles,
  chosenTemplate,
  defaultTemplate,
  templateGroups,
  templateTitle,
  type ComposerAttachments,
} from './composer-templates';

async function setup() {
  const source = createDemoLibrarySource();
  const [library, sales] = await Promise.all([source.listTemplates(), source.getProject('sales')]);
  const empty = { ...sales, projectId: 'empty', templates: [] };
  return { library, sales, empty };
}

const ids = (templates: readonly { templateId: string }[]) =>
  templates.map((template) => template.templateId);

const file = (name: string, body = 'x') => new File([body], name, { lastModified: 1 });
const none: ComposerAttachments = { files: [], templateFile: null };

describe('templateGroups', () => {
  it('в проекте: его шаблоны в порядке прикрепления, остальные — свежие первыми', async () => {
    const { library, sales } = await setup();
    const groups = templateGroups(library, sales);
    expect(ids(groups.own)).toEqual(ids(sales.templates));
    expect(ids(groups.others)).toEqual(
      ids(library.filter((item) => !ids(sales.templates).includes(item.templateId))),
    );
  });

  it('на главной: своих нет, вся библиотека — свежие первыми', async () => {
    const { library } = await setup();
    const groups = templateGroups([...library].reverse(), null);
    expect(groups.own).toEqual([]);
    expect(ids(groups.others)).toEqual(ids(library));
  });
});

describe('defaultTemplate', () => {
  it('в проекте — первый прикреплённый шаблон', async () => {
    const { library, sales } = await setup();
    expect(defaultTemplate(library, sales)?.templateId).toBe(sales.templates[0]?.templateId);
  });

  it('на главной — самый свежий шаблон библиотеки', async () => {
    const { library } = await setup();
    const newest = [...library].sort((a, b) => b.importedAt - a.importedAt)[0];
    expect(defaultTemplate([...library].reverse(), null)?.templateId).toBe(newest?.templateId);
  });

  it('пустой проект и пустая библиотека шаблона не выбирают', async () => {
    const { library, empty } = await setup();
    expect(defaultTemplate(library, empty)).toBeNull();
    expect(defaultTemplate([], null)).toBeNull();
  });
});

describe('chosenTemplate', () => {
  it('выбор из меню важнее значения по умолчанию, в том числе чужой шаблон в проекте', async () => {
    const { library, sales } = await setup();
    const other = templateGroups(library, sales).others[0];
    expect(chosenTemplate(library, sales, other?.templateId ?? null)?.templateId).toBe(
      other?.templateId,
    );
  });

  it('выбранного шаблона больше нет — возвращается значение по умолчанию', async () => {
    const { library, sales, empty } = await setup();
    expect(chosenTemplate(library, sales, 'gone')?.templateId).toBe(sales.templates[0]?.templateId);
    expect(chosenTemplate(library, empty, 'gone')).toBeNull();
  });
});

describe('addComposerFiles', () => {
  it('материалы идут в файлы, .pptx и .potx — в чип шаблона', () => {
    const notes = file('notes.md');
    const brand = file('Бренд.PPTX');
    const update = addComposerFiles(none, [notes, brand]);
    expect(update.files).toEqual([notes]);
    expect(update.templateFile).toBe(brand);
    expect(update.rejected).toEqual([]);
  });

  it('второй файл шаблона заменяет первый, материалы остаются', () => {
    const notes = file('notes.md');
    const first = file('Первый.pptx');
    const second = file('Второй.potx');
    const once = addComposerFiles(none, [notes, first]);
    const twice = addComposerFiles(once, [second]);
    expect(twice.templateFile).toBe(second);
    expect(twice.files).toEqual([notes]);
  });

  it('из нескольких файлов шаблона за раз берётся последний', () => {
    const last = file('b.pptx');
    expect(addComposerFiles(none, [file('a.pptx'), last]).templateFile).toBe(last);
  });

  it('пустой шаблон и чужой тип — в отказы, прежний шаблон остаётся', () => {
    const kept = file('Бренд.pptx');
    const update = addComposerFiles({ files: [], templateFile: kept }, [
      file('Пустой.pptx', ''),
      file('photo.png'),
    ]);
    expect(update.templateFile).toBe(kept);
    expect(update.rejected).toEqual(['Пустой.pptx', 'photo.png']);
  });

  it('файлы без шаблона чип не трогают', () => {
    const update = addComposerFiles(none, [file('data.csv')]);
    expect(update.templateFile).toBeNull();
  });
});

describe('templateTitle', () => {
  it('drops the template extension, keeping the name', () => {
    expect(templateTitle('Изумрудный минимал.potx')).toBe('Изумрудный минимал');
    expect(templateTitle('Brand.PPTX')).toBe('Brand');
    expect(templateTitle('notes.pptx.txt')).toBe('notes.pptx.txt');
    expect(templateTitle('.pptx')).toBe('.pptx');
  });
});
