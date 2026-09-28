import { describe, expect, it } from 'vitest';
import type { GenerationProgress, GenerationStage } from '@/lib/deck-generator';
import type { GenerationPhase } from '@/lib/generation-runs';
import { runStatus } from './run-status';

const stage = (
  name: GenerationStage['stage'],
  state: GenerationStage['state'],
  count: { done: number; total: number } | null = null,
): GenerationStage => ({
  stage: name,
  state,
  done: count?.done ?? null,
  total: count?.total ?? null,
  note: '',
});

const run = (phase: GenerationPhase, stages: readonly GenerationStage[]) => ({
  phase,
  progress: {
    stages,
    percent: 0,
    finished: false,
    failure: null,
    warnings: [],
    previewed: [],
    lastSeq: -1,
  } satisfies GenerationProgress,
});

describe('runStatus', () => {
  it('names finished runs by their phase', () => {
    expect(runStatus(run('done', []), true)).toEqual({ key: 'done' });
    expect(runStatus(run('failed', []), true)).toEqual({ key: 'failed' });
    expect(runStatus(run('cancelled', []), true)).toEqual({ key: 'cancelled' });
    expect(runStatus(run('cancelled', []), false)).toEqual({ key: 'superseded' });
  });

  it('shows the running stage, and slide counts while laying out', () => {
    expect(
      runStatus(run('running', [stage('queued', 'done'), stage('planning', 'running')]), true),
    ).toEqual({ key: 'stage', stage: 'planning' });
    expect(
      runStatus(run('running', [stage('laying-out', 'running', { done: 2, total: 6 })]), true),
    ).toEqual({ key: 'layingOut', done: 2, total: 6 });
  });

  it('starts before any stage and finishes after the last one', () => {
    expect(runStatus(run('running', [stage('queued', 'pending')]), true)).toEqual({
      key: 'starting',
    });
    // Все этапы готовы, а прогон ещё собирает итог: это конец, а не начало.
    expect(
      runStatus(run('running', [stage('queued', 'done'), stage('auditing', 'done')]), true),
    ).toEqual({ key: 'finishing' });
  });
});
