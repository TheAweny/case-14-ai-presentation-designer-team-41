import { describe, expect, it } from 'vitest';
import { createDemoLibrarySource } from '../mocks/demo-library';
import {
  addComposerFiles,
  COMPOSER_FILE_ACCEPT,
  chosenTemplate,
  defaultTemplate,
  templateGroups,
  templateTitle,
  type ComposerAttachments,
} from './composer-templates';
import { BRANDBOOK_EXTENSIONS, BRANDBOOK_MAX_BYTES } from './brandbooks';

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
  it('берёт только явный выбор, в том числе чужой шаблон в проекте', async () => {
    const { library, sales } = await setup();
    const other = templateGroups(library, sales).others[0];
    expect(chosenTemplate(library, sales, other?.templateId ?? null)?.templateId).toBe(
      other?.templateId,
    );
  });

  it('без выбора и без пропавшего шаблона ничего не подставляет', async () => {
    const { library, sales, empty } = await setup();
    expect(chosenTemplate(library, sales, null)).toBeNull();
    expect(chosenTemplate(library, sales, 'gone')).toBeNull();
    expect(chosenTemplate(library, empty, 'gone')).toBeNull();
  });
});

describe('addComposerFiles', () => {
  it('offers every supported brandbook extension in the common attachment picker', () => {
    for (const extension of BRANDBOOK_EXTENSIONS)
      expect(COMPOSER_FILE_ACCEPT.split(',')).toContain(extension);
    expect(COMPOSER_FILE_ACCEPT).not.toContain('.exe');
  });

  it.each(BRANDBOOK_EXTENSIONS)(
    'routes an explicitly selected %s exclusively to brandbook',
    (extension) => {
      const selected = file(`Brand${extension.toUpperCase()}`);
      const existingTemplate = file('kept.pptx');
      const update = addComposerFiles(
        { ...none, templateFile: existingTemplate },
        [selected],
        'brandbook',
      );
      expect(update.brandbookFile).toBe(selected);
      expect(update.templateFile).toBe(existingTemplate);
      expect(update.files).toEqual([]);
      expect(update.rejected).toEqual([]);
    },
  );

  it('rejects unsupported, empty and oversized brandbooks without replacing the accepted file', () => {
    const kept = file('kept.fig');
    const large = new File([new Uint8Array(BRANDBOOK_MAX_BYTES + 1)], 'large.fig');
    const update = addComposerFiles(
      { ...none, brandbookFile: kept },
      [file('unsupported.exe'), file('empty.fig', ''), large],
      'brandbook',
    );
    expect(update.brandbookFile).toBe(kept);
    expect(update.files).toEqual([]);
    expect(update.rejected).toEqual(['unsupported.exe', 'empty.fig', 'large.fig']);
  });

  it('auto routes native Figma, archive, images and font drops to brandbook', () => {
    for (const extension of [
      'fig',
      'rar',
      'zip',
      'svg',
      'png',
      'jpg',
      'jpeg',
      'webp',
      'ttf',
      'otf',
      'woff',
      'woff2',
    ]) {
      const selected = file(`Brand.${extension}`);
      const update = addComposerFiles(none, [selected]);
      expect(update.brandbookFile).toBe(selected);
      expect(update.files).toEqual([]);
      expect(update.rejected).toEqual([]);
    }
    expect(addComposerFiles(none, [file('guide.pdf')]).files[0]?.name).toBe('guide.pdf');
  });
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
      file('photo.exe'),
    ]);
    expect(update.templateFile).toBe(kept);
    expect(update.rejected).toEqual(['Пустой.pptx', 'photo.exe']);
    expect(update.emptyTemplates).toEqual(['Пустой.pptx']);
  });

  it('JSON без пункта «Брендбук» — данные, а не брендбук', () => {
    const tokens = file('tokens.json', '{"color":{}}');
    const update = addComposerFiles(none, [tokens]);
    expect(update.brandbookFile ?? null).toBeNull();
    expect(addComposerFiles(none, [tokens], 'brandbook').brandbookFile).toBe(tokens);
    expect(addComposerFiles(none, [file('brand.fig')]).brandbookFile?.name).toBe('brand.fig');
  });

  it('файлы без шаблона чип не трогают', () => {
    const update = addComposerFiles(none, [file('data.csv')]);
    expect(update.templateFile).toBeNull();
  });

  it('не дублирует материал внутри одного выбора и при повторном перетаскивании', () => {
    const notes = file('notes.md');
    const duplicate = file('notes.md');
    const once = addComposerFiles(none, [notes, duplicate]);
    expect(once.files).toEqual([notes]);
    expect(addComposerFiles(once, [duplicate]).files).toEqual([notes]);
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
