/**
 * Автосохранение с дебаунсом: правки идут очередью, а в хранилище уходит только последняя,
 * когда человек на `delay` мс остановился. Записи не перекрываются: пока пишется одна,
 * следующая ждёт и берёт самое свежее значение.
 *
 * Без React и таймеров браузера: таймер подставляется, поэтому логику видно и проверять её
 * можно на поддельных часах.
 */

/** `idle` — писать нечего и не было; `saved` — последнее записано; `error` — запись упала. */
export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface Autosave<T> {
  /** Новое значение: запишется через `delay` мс, если за это время не придёт следующее. */
  schedule(value: T): void;
  /** Записать отложенное сейчас и дождаться конца записи. */
  flush(): Promise<void>;
  /** Есть то, чего в хранилище ещё нет: ждёт таймера, пишется или запись упала. */
  busy(): boolean;
  status(): SaveStatus;
  /** Остановить таймер. Отложенное остаётся несохранённым. */
  dispose(): void;
}

export interface AutosaveOptions<T> {
  write(value: T): Promise<void>;
  delay?: number;
  onStatus?(status: SaveStatus): void;
  setTimer?(run: () => void, delay: number): unknown;
  clearTimer?(timer: unknown): void;
}

/** Пауза после правки, после которой черновик уходит в хранилище. */
export const AUTOSAVE_DELAY = 500;

export function createAutosave<T>({
  write,
  delay = AUTOSAVE_DELAY,
  onStatus,
  setTimer = (run, ms) => setTimeout(run, ms),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: AutosaveOptions<T>): Autosave<T> {
  let queued: { readonly value: T } | null = null;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let current: SaveStatus = 'idle';

  const report = (next: SaveStatus) => {
    if (next === current) return;
    current = next;
    onStatus?.(next);
  };

  const stopTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };

  /** Пишет очередь, пока она не опустеет. Второй вызов во время записи ждёт первый. */
  const drain = (): Promise<void> => {
    if (running) return running;
    const loop = async () => {
      while (queued) {
        const { value } = queued;
        queued = null;
        report('saving');
        try {
          await write(value);
        } catch {
          // Упавшее не теряем: если новее ничего нет, его запишет следующая правка или flush.
          queued ??= { value };
          report('error');
          return;
        }
      }
      report('saved');
    };
    // Цикл стартует следующей микрозадачей, уже после того как `running` назначен: иначе
    // пустая очередь закончилась бы раньше присваивания и `running` остался бы навсегда.
    running = Promise.resolve()
      .then(loop)
      .finally(() => {
        running = null;
      });
    return running;
  };

  return {
    schedule(value) {
      queued = { value };
      stopTimer();
      report(running ? 'saving' : 'pending');
      timer = setTimer(() => {
        timer = null;
        void drain();
      }, delay);
    },
    async flush() {
      stopTimer();
      // Запись, которая уже идёт, могла взять не последнее: дожидаемся её и пишем остальное.
      if (running) await running;
      if (queued) await drain();
    },
    busy: () => queued !== null || running !== null,
    status: () => current,
    dispose: stopTimer,
  };
}
