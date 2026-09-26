/**
 * Серия сдвигов стрелками — один шаг отмены, как в Keynote и Slides: нажатия подряд по тем же
 * объектам без паузы дольше этого считаются одним жестом.
 */
export const NUDGE_SERIES_MS = 1000;

export interface NudgeSeries {
  /** Ключ серии для журнала: одинаковый у всех нажатий одной серии. */
  readonly key: string;
  /** Какие объекты и на каком слайде сдвигает серия. */
  readonly target: string;
  /** Когда было последнее нажатие, в миллисекундах. */
  readonly at: number;
}

/**
 * Серия после ещё одного нажатия: прежняя, если объекты те же и пауза не дольше
 * `NUDGE_SERIES_MS`, иначе новая. Любая другая правка между нажатиями серию и так рвёт: журнал
 * склеивает только с записью той же серии.
 */
export function nextNudgeSeries(
  previous: NudgeSeries | null,
  slideId: string,
  elementIds: readonly string[],
  now: number,
): NudgeSeries {
  const target = [slideId, ...[...elementIds].sort()].join('\0');
  if (previous && previous.target === target && now - previous.at <= NUDGE_SERIES_MS) {
    return { key: previous.key, target, at: now };
  }
  return { key: `nudge:${now}:${target}`, target, at: now };
}
