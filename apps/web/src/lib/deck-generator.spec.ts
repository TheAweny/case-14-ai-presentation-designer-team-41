import { describe, expect, it } from 'vitest';
import type { JobEvent } from '@lct/contracts';
import {
  LAYOUT_VARIANTS,
  SLIDE_COUNT_RANGE,
  applyEvent,
  contentFileKind,
  extensionOf,
  generationProgress,
  addContentFiles,
  hasContent,
  initialProgress,
  plannedStages,
  templateFileProblem,
} from './deck-generator';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Draft = DistributiveOmit<JobEvent, 'schemaVersion' | 'runId' | 'seq' | 'at'>;

/** События с плотным `seq`, как их шлёт сервер. */
function events(...drafts: Draft[]): JobEvent[] {
  return drafts.map(
    (draft, seq) =>
      ({ ...draft, schemaVersion: 1, runId: 'run', seq, at: '2026-09-25T09:00:00Z' }) as JobEvent,
  );
}

describe('plannedStages', () => {
  it('шаблон уже профилирован при импорте: разбора в прогоне нет', () => {
    expect(plannedStages()).toEqual(['queued', 'planning', 'laying-out', 'rendering', 'auditing']);
  });
});

describe('константы из контрактов', () => {
  it('три варианта в порядке контракта', () => {
    expect(LAYOUT_VARIANTS).toEqual(['dense', 'balanced', 'airy']);
  });

  it('границы числа слайдов — из схемы прогона', () => {
    expect(SLIDE_COUNT_RANGE).toEqual({ min: 10, max: 15 });
  });
});

describe('файлы', () => {
  it('extensionOf: нижний регистр, скрытый файл и имя без точки — без расширения', () => {
    expect(extensionOf('Отчёт.PPTX')).toBe('.pptx');
    expect(extensionOf('archive.tar.gz')).toBe('.gz');
    expect(extensionOf('.pptx')).toBe('');
    expect(extensionOf('README')).toBe('');
  });

  it('шаблоном может быть .pptx и .potx', () => {
    expect(templateFileProblem({ name: 'Бренд.pptx', size: 10 })).toBeNull();
    expect(templateFileProblem({ name: 'brand.POTX', size: 10 })).toBeNull();
  });

  it('другое расширение и пустой файл не годятся', () => {
    expect(templateFileProblem({ name: 'brand.key', size: 10 })).toBe('type');
    expect(templateFileProblem({ name: 'brand.pptx.pdf', size: 10 })).toBe('type');
    expect(templateFileProblem({ name: 'brand', size: 10 })).toBe('type');
    expect(templateFileProblem({ name: 'brand.pptx', size: 0 })).toBe('empty');
  });

  it('файлы контента становятся текстом или таблицей, картинки не принимаются', () => {
    expect(contentFileKind('бриф.docx')).toBe('text');
    expect(contentFileKind('notes.MD')).toBe('text');
    expect(contentFileKind('выручка.xlsx')).toBe('table');
    expect(contentFileKind('data.csv')).toBe('table');
    expect(contentFileKind('photo.png')).toBeNull();
    expect(contentFileKind('template.pptx')).toBeNull();
  });

  it('контент — непустой бриф или хотя бы один файл', () => {
    expect(hasContent('', [])).toBe(false);
    expect(hasContent('  \n\t', [])).toBe(false);
    expect(hasContent('О чём колода', [])).toBe(true);
    expect(hasContent('', [{}])).toBe(true);
  });
});

describe('generationProgress', () => {
  const planned = plannedStages();

  it('до событий все этапы ждут, прогресс 0', () => {
    const progress = initialProgress(planned);
    expect(progress.stages.every((stage) => stage.state === 'pending')).toBe(true);
    expect(progress.percent).toBe(0);
    expect(progress.lastSeq).toBe(-1);
  });

  it('этап идёт, считает единицы и завершается', () => {
    const progress = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        { type: 'stage-finished', stage: 'queued', durationMs: 5 },
        { type: 'stage-started', stage: 'planning' },
        { type: 'stage-progress', stage: 'planning', done: 3, total: 12, note: 'Слайд 3' },
      ),
    );
    expect(progress.stages.map((stage) => stage.state)).toEqual([
      'done',
      'running',
      'pending',
      'pending',
      'pending',
    ]);
    expect(progress.stages[1]).toMatchObject({ done: 3, total: 12, note: 'Слайд 3' });
    // Один этап из пяти готов, второй — на четверть: (1 + 0.25) / 5.
    expect(progress.percent).toBe(25);
    expect(progress.finished).toBe(false);
  });

  it('до события done прогресс не доходит до 100', () => {
    const progress = generationProgress(
      planned,
      events(
        ...planned.flatMap((stage): Draft[] => [
          { type: 'stage-started', stage },
          { type: 'stage-finished', stage, durationMs: 1 },
        ]),
      ),
    );
    expect(progress.percent).toBe(99);
    const done = applyEvent(progress, {
      type: 'done',
      schemaVersion: 1,
      runId: 'run',
      seq: progress.lastSeq + 1,
      at: '2026-09-25T09:00:00Z',
      totalMs: 10,
      manifestPath: 'manifest.json',
    });
    expect(done.percent).toBe(100);
    expect(done.finished).toBe(true);
  });

  it('сбой помечает этап и сохраняет причину', () => {
    const progress = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'planning' },
        {
          type: 'failed',
          stage: 'planning',
          code: 'model-unavailable',
          message: 'Модель недоступна',
          retryable: true,
        },
      ),
    );
    expect(progress.stages.find((stage) => stage.stage === 'planning')?.state).toBe('failed');
    expect(progress.failure).toEqual({
      stage: 'planning',
      code: 'model-unavailable',
      message: 'Модель недоступна',
      retryable: true,
    });
  });

  it('незапланированный этап добавляется в конец', () => {
    const progress = generationProgress(
      planned,
      events({ type: 'stage-started', stage: 'exporting' }),
    );
    expect(progress.stages.at(-1)).toMatchObject({ stage: 'exporting', state: 'running' });
    expect(progress.stages).toHaveLength(planned.length + 1);
  });

  it('помнит предупреждения и варианты с готовым превью', () => {
    const progress = generationProgress(
      planned,
      events(
        { type: 'warning', stage: 'planning', code: 'thin-content', message: 'Мало материала' },
        { type: 'artifact-ready', kind: 'preview', variant: 'dense', path: 'dense/preview' },
        { type: 'artifact-ready', kind: 'slide-ir', variant: 'airy', path: 'airy/slides.json' },
        { type: 'artifact-ready', kind: 'preview', variant: 'dense', path: 'dense/preview' },
      ),
    );
    expect(progress.warnings).toEqual([
      { stage: 'planning', code: 'thin-content', message: 'Мало материала' },
    ]);
    expect(progress.previewed).toEqual(['dense']);
  });

  it('повтор уже виденного seq не меняет ход', () => {
    const [started, step] = events(
      { type: 'stage-started', stage: 'planning' },
      { type: 'stage-progress', stage: 'planning', done: 2, total: 4, note: '' },
    ) as [JobEvent, JobEvent];
    const once = generationProgress(planned, [started, step]);
    const replayed = applyEvent(applyEvent(once, started), step);
    expect(replayed).toBe(once);
  });
});

describe('addContentFiles', () => {
  const csv = new File(['a,b'], 'выручка.csv', { lastModified: 1 });

  it('берёт подходящие файлы и называет те, что не подошли', () => {
    const update = addContentFiles(
      [],
      [csv, new File(['png'], 'фото.png'), new File([], 'пустой.txt')],
    );
    expect(update.files.map((file) => file.name)).toEqual(['выручка.csv']);
    expect(update.rejected).toEqual(['фото.png', 'пустой.txt']);
  });

  it('тот же файл второй раз не прикрепляет', () => {
    const again = new File(['a,b'], 'выручка.csv', { lastModified: 1 });
    expect(addContentFiles([csv], [again]).files).toEqual([csv]);
  });
});
