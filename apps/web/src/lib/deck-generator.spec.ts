import { describe, expect, it } from 'vitest';
import type { JobEvent } from '@lct/contracts';
import {
  LAYOUT_VARIANTS,
  SLIDE_COUNT_RANGE,
  CONTENT_FILE_ACCEPT,
  applyEvent,
  contentFileKind,
  extensionOf,
  generationProgress,
  addContentFiles,
  hasContent,
  initialProgress,
  plannedStages,
  completeProgress,
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
  it('шаблон уже профилирован, очереди в плане нет, экспорт есть', () => {
    expect(plannedStages()).toEqual([
      'planning',
      'laying-out',
      'rendering',
      'auditing',
      'exporting',
    ]);
  });
});

describe('константы из контрактов', () => {
  it('три варианта в порядке контракта', () => {
    expect(LAYOUT_VARIANTS).toEqual(['dense', 'balanced', 'airy']);
  });

  it('границы числа слайдов — из схемы прогона', () => {
    expect(SLIDE_COUNT_RANGE).toEqual({ min: 5, max: 15 });
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
    expect(contentFileKind('доли-каналов.JSON')).toBe('table');
    expect(CONTENT_FILE_ACCEPT.split(',')).toContain('.json');
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
    expect(progress.stages.map((stage) => stage.stage)).toEqual(planned);
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
      'pending',
    ]);
    expect(progress.stages[1]).toMatchObject({ done: 3, total: 12, note: 'Слайд 3' });
    // Очередь пришла событием и встала к пяти плановым: (1 + 0.25) / 6.
    expect(progress.stages).toHaveLength(planned.length + 1);
    expect(progress.percent).toBe(20);
    expect(progress.finished).toBe(false);
  });

  it('иллюстрации встают между планом и вёрсткой и считают картинки', () => {
    const progress = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'planning' },
        { type: 'stage-started', stage: 'illustrating' },
        { type: 'stage-progress', stage: 'illustrating', done: 2, total: 5, note: '' },
      ),
    );
    expect(progress.stages.map((stage) => stage.stage)).toEqual([
      'planning',
      'illustrating',
      'laying-out',
      'rendering',
      'auditing',
      'exporting',
    ]);
    expect(progress.stages[1]).toMatchObject({ state: 'running', done: 2, total: 5 });
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
    expect(progress.stages.map((stage) => stage.state)).toEqual([
      'failed',
      'pending',
      'pending',
      'pending',
      'pending',
    ]);
    expect(progress.finished).toBe(false);
  });

  it('экспорт запланирован и не дописывается вторым разом', () => {
    const progress = generationProgress(
      planned,
      events({ type: 'stage-started', stage: 'exporting' }),
    );
    expect(progress.stages.map((stage) => stage.stage)).toEqual([...planned]);
    expect(progress.stages.at(-1)).toMatchObject({ stage: 'exporting', state: 'running' });
  });

  it('счётчик этапа не выходит за total', () => {
    const progress = generationProgress(
      planned,
      events({ type: 'stage-progress', stage: 'planning', done: 9, total: 4, note: '' }),
    );
    expect(progress.stages[0]).toMatchObject({ state: 'running', done: 4, total: 4 });
  });

  it('пропущенный этап не входит в знаменатель прогресса', () => {
    const prepared = initialProgress(planned);
    const [finished] = events({ type: 'stage-finished', stage: 'planning', durationMs: 1 }) as [
      JobEvent,
    ];
    const progress = applyEvent(
      {
        ...prepared,
        stages: prepared.stages.map((stage) =>
          stage.stage === 'rendering' || stage.stage === 'auditing'
            ? { ...stage, state: 'skipped' as const }
            : stage,
        ),
      },
      finished,
    );
    // planning done, laying-out и exporting ещё ждут, rendering и auditing пропущены: 1 / 3.
    expect(progress.percent).toBe(33);
    expect(progress.finished).toBe(false);
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

  it('успех пропускает ненаблюдавшиеся этапы и досматривает идущий', () => {
    const progress = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'planning' },
        { type: 'stage-finished', stage: 'planning', durationMs: 1 },
        { type: 'stage-started', stage: 'exporting' },
        { type: 'stage-progress', stage: 'exporting', done: 1, total: 2, note: 'файл' },
        { type: 'done', totalMs: 10, manifestPath: 'manifest.json' },
      ),
    );
    expect(progress.stages.map((stage) => [stage.stage, stage.state])).toEqual([
      ['planning', 'done'],
      ['laying-out', 'skipped'],
      ['rendering', 'skipped'],
      ['auditing', 'skipped'],
      ['exporting', 'done'],
    ]);
    expect(progress.stages.every((stage) => stage.note === '')).toBe(true);
    expect(progress.finished).toBe(true);
    expect(progress.percent).toBe(100);
  });

  it('completeProgress сохраняет failed и идемпотентен', () => {
    const open = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'planning' },
        { type: 'stage-finished', stage: 'planning', durationMs: 1 },
        { type: 'stage-started', stage: 'laying-out' },
        { type: 'stage-progress', stage: 'laying-out', done: 1, total: 4, note: 'слайд' },
        {
          type: 'failed',
          stage: 'rendering',
          code: 'engine-failed',
          message: 'рендер',
          retryable: false,
        },
      ),
    );
    const closed = completeProgress(open);
    expect(closed.stages.map((stage) => [stage.stage, stage.state])).toEqual([
      ['planning', 'done'],
      ['laying-out', 'done'],
      ['rendering', 'failed'],
      ['auditing', 'skipped'],
      ['exporting', 'skipped'],
    ]);
    expect(closed.stages.every((stage) => stage.note === '')).toBe(true);
    expect(closed.failure?.stage).toBe('rendering');
    expect(closed.finished).toBe(true);
    expect(closed.percent).toBe(100);
    expect(completeProgress(closed)).toBe(closed);
  });

  it('старт аудита не закрывает параллельные иллюстрации', () => {
    const progress = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        { type: 'stage-started', stage: 'illustrating' },
        { type: 'stage-started', stage: 'auditing' },
      ),
    );
    expect(progress.stages.find((stage) => stage.stage === 'queued')?.state).toBe('done');
    expect(progress.stages.find((stage) => stage.stage === 'illustrating')?.state).toBe('running');
    expect(progress.stages.find((stage) => stage.stage === 'auditing')?.state).toBe('running');
  });

  it('очередь закрывается реальной работой другого этапа, но не своим прогрессом и не диагностикой', () => {
    const started = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        { type: 'stage-started', stage: 'planning' },
      ),
    );
    expect(started.stages.find((stage) => stage.stage === 'queued')?.state).toBe('done');
    expect(started.stages.find((stage) => stage.stage === 'planning')?.state).toBe('running');

    const progressed = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        { type: 'stage-progress', stage: 'laying-out', done: 1, total: 3, note: 'макет' },
      ),
    );
    expect(progressed.stages.find((stage) => stage.stage === 'queued')?.state).toBe('done');
    expect(progressed.stages.find((stage) => stage.stage === 'laying-out')).toMatchObject({
      state: 'running',
      done: 1,
      total: 3,
    });

    const finished = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        { type: 'stage-finished', stage: 'rendering', durationMs: 4 },
      ),
    );
    expect(finished.stages.find((stage) => stage.stage === 'queued')?.state).toBe('done');
    expect(finished.stages.find((stage) => stage.stage === 'rendering')?.state).toBe('done');

    const own = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        { type: 'stage-progress', stage: 'queued', done: 0, total: 1, note: 'ждём' },
      ),
    );
    expect(own.stages.find((stage) => stage.stage === 'queued')).toMatchObject({
      state: 'running',
      note: 'ждём',
    });

    const warned = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        { type: 'warning', stage: 'planning', code: 'thin-content', message: 'Мало материала' },
        { type: 'artifact-ready', kind: 'preview', variant: 'dense', path: 'dense/preview' },
      ),
    );
    expect(warned.stages.find((stage) => stage.stage === 'queued')?.state).toBe('running');

    const failed = generationProgress(
      planned,
      events(
        { type: 'stage-started', stage: 'queued' },
        {
          type: 'failed',
          stage: 'planning',
          code: 'model-unavailable',
          message: 'Модель недоступна',
          retryable: true,
        },
      ),
    );
    expect(failed.stages.find((stage) => stage.stage === 'queued')?.state).toBe('running');
    expect(failed.stages.find((stage) => stage.stage === 'planning')?.state).toBe('failed');
    expect(failed.stages.some((stage) => stage.state === 'skipped')).toBe(false);
    expect(
      failed.stages.filter((stage) => stage.state === 'pending').map((stage) => stage.stage),
    ).toEqual(['laying-out', 'rendering', 'auditing', 'exporting']);
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
