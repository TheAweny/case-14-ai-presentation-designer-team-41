import { describe, expect, it } from 'vitest';
import type { JobEvent } from '@lct/contracts';
import { exportProgress, plannedStages, safeFileName } from './deck-export';

const base = { schemaVersion: 1 as const, runId: 'r', at: '2026-09-24T00:00:00Z' };
let seq = 0;
function event(body: Record<string, unknown>): JobEvent {
  seq += 1;
  return { ...base, seq, ...body } as JobEvent;
}

describe('plannedStages', () => {
  it('аудит — только если его попросили', () => {
    expect(plannedStages({ audit: false })).toEqual(['rendering', 'exporting']);
    expect(plannedStages({ audit: true })).toEqual(['rendering', 'auditing', 'exporting']);
  });
});

describe('exportProgress', () => {
  const planned = plannedStages({ audit: true });

  it('до первого события все этапы ждут, прогресс ноль', () => {
    const progress = exportProgress(planned, []);
    expect(progress.stages.map((stage) => stage.state)).toEqual(['pending', 'pending', 'pending']);
    expect(progress.percent).toBe(0);
    expect(progress.finished).toBe(false);
  });

  it('текущий этап даёт долю по готовым единицам', () => {
    const progress = exportProgress(planned, [
      event({ type: 'stage-started', stage: 'rendering' }),
      event({ type: 'stage-progress', stage: 'rendering', done: 6, total: 12, note: '' }),
    ]);
    expect(progress.stages[0]).toEqual({
      stage: 'rendering',
      state: 'running',
      done: 6,
      total: 12,
    });
    // Половина первого из трёх этапов.
    expect(progress.percent).toBe(16);
  });

  it('законченный этап засчитан целиком, следующий идёт', () => {
    const progress = exportProgress(planned, [
      event({ type: 'stage-started', stage: 'rendering' }),
      event({ type: 'stage-progress', stage: 'rendering', done: 3, total: 12, note: '' }),
      event({ type: 'stage-finished', stage: 'rendering', durationMs: 10 }),
      event({ type: 'stage-started', stage: 'auditing' }),
    ]);
    expect(progress.stages.map((stage) => stage.state)).toEqual(['done', 'running', 'pending']);
    expect(progress.stages[0]?.done).toBe(12);
    expect(progress.percent).toBe(33);
  });

  it('до события done не показывает 100 %', () => {
    const progress = exportProgress(planned, [
      event({ type: 'stage-finished', stage: 'rendering', durationMs: 1 }),
      event({ type: 'stage-finished', stage: 'auditing', durationMs: 1 }),
      event({ type: 'stage-finished', stage: 'exporting', durationMs: 1 }),
    ]);
    expect(progress.percent).toBe(99);
    const done = exportProgress(planned, [event({ type: 'done', totalMs: 1, manifestPath: 'm' })]);
    expect(done.percent).toBe(100);
    expect(done.finished).toBe(true);
    expect(done.stages.every((stage) => stage.state === 'done')).toBe(true);
  });

  it('неожиданный этап от сервера добавляется в конец', () => {
    const progress = exportProgress(
      ['rendering'],
      [event({ type: 'stage-started', stage: 'queued' })],
    );
    expect(progress.stages.map((stage) => stage.stage)).toEqual(['rendering', 'queued']);
  });

  it('сбой сохраняет код, текст и можно ли повторить', () => {
    const progress = exportProgress(planned, [
      event({
        type: 'failed',
        stage: 'exporting',
        code: 'engine-failed',
        message: 'Движок не смог собрать файл',
        retryable: true,
      }),
    ]);
    expect(progress.failure).toEqual({
      code: 'engine-failed',
      message: 'Движок не смог собрать файл',
      retryable: true,
    });
  });

  it('готовых единиц не больше, чем всего', () => {
    const progress = exportProgress(
      ['rendering'],
      [event({ type: 'stage-progress', stage: 'rendering', done: 20, total: 12, note: '' })],
    );
    expect(progress.stages[0]?.done).toBe(12);
  });
});

describe('safeFileName', () => {
  it('убирает символы, запрещённые в именах файлов', () => {
    expect(safeFileName('Итоги: Q3 / 2026?', 'deck')).toBe('Итоги Q3 2026');
  });

  it('убирает управляющие символы и точки в конце', () => {
    expect(safeFileName('План\tработ...', 'deck')).toBe('План работ');
  });

  it('пустое имя заменяет запасным', () => {
    expect(safeFileName('  ??  ', 'deck')).toBe('deck');
  });

  it('обрезает слишком длинное имя', () => {
    expect(safeFileName('а'.repeat(300), 'deck')).toHaveLength(120);
  });
});
