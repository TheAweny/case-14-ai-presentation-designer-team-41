import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoLibrarySource } from '../mocks/demo-library';
import { createDemoTemplateImporter } from '../mocks/demo-template-importer';
import { InvalidTemplateFileError, type TemplateSummary } from './library-source';
import { importStages, type TemplateImporter } from './template-importer';
import { createTemplateImports } from './template-imports';

const ids = () => {
  let next = 0;
  return () => `import-${(next += 1)}`;
};

const pptx = (name = 'Бренд.pptx') => new File(['PK'], name);

const demo = (register?: (file: File) => Promise<TemplateSummary>) => {
  const library = createDemoLibrarySource();
  return createDemoTemplateImporter({
    register: register ?? ((file) => library.importTemplate(file)),
    stepMs: 10,
  });
};

describe('createTemplateImports', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('импорт идёт по этапам разбора и профиля и заканчивается шаблоном', async () => {
    const imports = createTemplateImports(demo(), ids());
    const importId = imports.start(pptx());
    const started = imports.get(importId);
    expect(started?.phase).toBe('running');
    expect(started?.progress.stages.map((stage) => stage.stage)).toEqual(importStages());
    expect(started?.file.name).toBe('Бренд.pptx');

    await vi.runAllTimersAsync();
    const item = imports.get(importId);
    expect(item?.phase).toBe('done');
    expect(item?.progress.finished).toBe(true);
    expect(item?.result?.fileName).toBe('Бренд.pptx');
    expect(item?.failure).toBeNull();
  });

  it('сообщает подписчикам о каждом изменении и меняет снимок целиком', async () => {
    const imports = createTemplateImports(demo(), ids());
    const listener = vi.fn();
    const unsubscribe = imports.subscribe(listener);
    const importId = imports.start(pptx());
    const first = imports.get(importId);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30);
    expect(listener.mock.calls.length).toBeGreaterThan(1);
    expect(imports.get(importId)).not.toBe(first);
    expect(imports.get(importId)?.progress.percent).toBeGreaterThan(0);

    unsubscribe();
    const calls = listener.mock.calls.length;
    await vi.runAllTimersAsync();
    expect(listener).toHaveBeenCalledTimes(calls);
  });

  it('негодный файл импорта не начинает', () => {
    const imports = createTemplateImports(demo(), ids());
    const listener = vi.fn();
    imports.subscribe(listener);
    expect(() => imports.start(new File(['x'], 'отчёт.docx'))).toThrow(InvalidTemplateFileError);
    expect(() => imports.start(new File([], 'пустой.pptx'))).toThrow(InvalidTemplateFileError);
    expect(listener).not.toHaveBeenCalled();
    expect(imports.get('import-1')).toBeUndefined();
  });

  it('сбой регистрации — ошибка, которую можно повторить тем же файлом под тем же id', async () => {
    const library = createDemoLibrarySource();
    let fail = true;
    const register = vi.fn((file: File) =>
      fail ? Promise.reject(new Error('server')) : library.importTemplate(file),
    );
    const imports = createTemplateImports(demo(register), ids());
    const importId = imports.start(pptx('Второй.potx'));
    await vi.runAllTimersAsync();
    expect(imports.get(importId)?.phase).toBe('failed');
    expect(imports.get(importId)?.failure?.retryable).toBe(true);

    fail = false;
    imports.retry(importId);
    expect(imports.get(importId)?.phase).toBe('running');
    expect(imports.get(importId)?.failure).toBeNull();
    expect(imports.get(importId)?.progress.lastSeq).toBe(-1);
    await vi.runAllTimersAsync();
    expect(imports.get(importId)?.phase).toBe('done');
    expect(imports.get(importId)?.result?.fileName).toBe('Второй.potx');
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('причина из события failed важнее общей ошибки', async () => {
    const importer: TemplateImporter = {
      profilesFiles: true,
      import(_file, onEvent) {
        onEvent({
          schemaVersion: 1,
          runId: 'run',
          seq: 0,
          at: new Date(0).toISOString(),
          type: 'failed',
          stage: 'parsing-template',
          code: 'template-unreadable',
          message: 'Файл повреждён',
          retryable: false,
        });
        return Promise.reject(new Error('failed'));
      },
    };
    const imports = createTemplateImports(importer, ids());
    const importId = imports.start(pptx());
    await vi.runAllTimersAsync();
    expect(imports.get(importId)?.phase).toBe('failed');
    expect(imports.get(importId)?.failure).toMatchObject({
      stage: 'parsing-template',
      code: 'template-unreadable',
      retryable: false,
    });
  });

  it('повтор идущего или готового импорта ничего не делает', async () => {
    const register = vi.fn((file: File) => createDemoLibrarySource().importTemplate(file));
    const imports = createTemplateImports(demo(register), ids());
    const importId = imports.start(pptx());
    imports.retry(importId);
    await vi.runAllTimersAsync();
    imports.retry(importId);
    await vi.runAllTimersAsync();
    expect(register).toHaveBeenCalledTimes(1);
    expect(imports.get(importId)?.phase).toBe('done');
  });

  it('неизвестный импорт — undefined', () => {
    expect(createTemplateImports(demo(), ids()).get('nope')).toBeUndefined();
  });
});
