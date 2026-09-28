import type { GenerationStage } from '@/lib/deck-generator';
import type { GenerationRun } from '@/lib/generation-runs';

/**
 * Заголовок хода сборки — один для карточки на странице разговора и в панели редактора. Модуль
 * без React: что написать при каком состоянии прогона, проверяется тестами, а слова — в словаре
 * `assistant.work`.
 */
export type RunStatus =
  | { readonly key: 'done' | 'failed' | 'cancelled' | 'superseded' | 'starting' | 'finishing' }
  | { readonly key: 'layingOut'; readonly done: number; readonly total: number }
  | { readonly key: 'stage'; readonly stage: GenerationStage['stage'] };

/**
 * `latest` — прогон последней сборки разговора. Отменённый не последний прогон сменила новая
 * сборка: он «заменён», а не «остановлен».
 *
 * Пока прогон идёт, а этапа в работе нет, возможны две паузы: до первого события (ещё ничего не
 * сделано — «Начинаю») и после последнего этапа, пока сервер собирает итог («Завершаю»). Раньше
 * вторая тоже называлась «Начинаю», хотя все этапы уже отмечены готовыми.
 */
export function runStatus(
  run: Pick<GenerationRun, 'phase' | 'progress'>,
  latest: boolean,
): RunStatus {
  switch (run.phase) {
    case 'done':
      return { key: 'done' };
    case 'failed':
      return { key: 'failed' };
    case 'cancelled':
      return { key: latest ? 'cancelled' : 'superseded' };
    default:
      break;
  }
  const current = run.progress.stages.find((stage) => stage.state === 'running');
  if (current?.stage === 'laying-out' && current.total !== null) {
    return { key: 'layingOut', done: current.done ?? 0, total: current.total };
  }
  if (current) return { key: 'stage', stage: current.stage };
  const started = run.progress.stages.some((stage) => stage.state === 'done');
  return { key: started ? 'finishing' : 'starting' };
}
