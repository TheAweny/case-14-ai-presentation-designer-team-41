import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave, type SaveStatus } from './draft-autosave';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Запись, которую завершает сам тест: так видно, что автосохранение делает во время записи. */
function controlledWrite() {
  const written: number[] = [];
  const pending: { value: number; resolve: () => void }[] = [];
  const write = vi.fn(
    (value: number) =>
      new Promise<void>((resolve) => {
        pending.push({
          value,
          resolve: () => {
            written.push(value);
            resolve();
          },
        });
      }),
  );
  return { write, written, pending };
}

describe('autosave', () => {
  it('пишет только последнее значение, когда правки на паузе', async () => {
    const written: number[] = [];
    const statuses: SaveStatus[] = [];
    const autosave = createAutosave<number>({
      write: async (value) => {
        written.push(value);
      },
      delay: 500,
      onStatus: (status) => statuses.push(status),
    });
    expect(autosave.status()).toBe('idle');
    autosave.schedule(1);
    await vi.advanceTimersByTimeAsync(300);
    autosave.schedule(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(written).toEqual([]);
    expect(autosave.busy()).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(written).toEqual([2]);
    expect(autosave.busy()).toBe(false);
    expect(statuses).toEqual(['pending', 'saving', 'saved']);
  });

  it('не перекрывает записи: новое ждёт конца текущей и уходит следом', async () => {
    const { write, written, pending } = controlledWrite();
    const autosave = createAutosave<number>({ write, delay: 500 });
    autosave.schedule(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(1);
    autosave.schedule(2);
    autosave.schedule(3);
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(1);
    expect(autosave.busy()).toBe(true);
    pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenCalledTimes(2);
    expect(pending[1]?.value).toBe(3);
    pending[1]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual([1, 3]);
    expect(autosave.status()).toBe('saved');
    expect(autosave.busy()).toBe(false);
  });

  it('flush пишет сразу, не дожидаясь паузы', async () => {
    const written: number[] = [];
    const autosave = createAutosave<number>({
      write: async (value) => {
        written.push(value);
      },
    });
    autosave.schedule(7);
    await autosave.flush();
    expect(written).toEqual([7]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toEqual([7]);
    expect(autosave.busy()).toBe(false);
  });

  it('таймер после уже записанного ничего не пишет и не оставляет «занято»', async () => {
    const written: number[] = [];
    const autosave = createAutosave<number>({
      write: async (value) => {
        written.push(value);
      },
    });
    autosave.schedule(1);
    await vi.advanceTimersByTimeAsync(100);
    const flushed = autosave.flush();
    // Правка до начала записи ставит таймер, а цикл записи забирает её сам — последнюю.
    autosave.schedule(2);
    await flushed;
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toEqual([2]);
    expect(autosave.busy()).toBe(false);
    expect(autosave.status()).toBe('saved');
  });

  it('flush во время записи дожидается её и пишет то, что пришло после', async () => {
    const { write, written, pending } = controlledWrite();
    const autosave = createAutosave<number>({ write });
    autosave.schedule(1);
    await vi.advanceTimersByTimeAsync(500);
    autosave.schedule(2);
    const flushed = autosave.flush();
    pending[0]?.resolve();
    await vi.advanceTimersByTimeAsync(0);
    pending[1]?.resolve();
    await flushed;
    expect(written).toEqual([1, 2]);
    expect(autosave.busy()).toBe(false);
  });

  it('не теряет значение, если запись упала, и пишет его при следующей попытке', async () => {
    let fail = true;
    const written: number[] = [];
    const autosave = createAutosave<number>({
      write: async (value) => {
        if (fail) throw new Error('quota');
        written.push(value);
      },
    });
    autosave.schedule(5);
    await vi.advanceTimersByTimeAsync(500);
    expect(autosave.status()).toBe('error');
    expect(autosave.busy()).toBe(true);
    fail = false;
    await autosave.flush();
    expect(written).toEqual([5]);
    expect(autosave.busy()).toBe(false);
    expect(autosave.status()).toBe('saved');
  });

  it('конфликт оставляет значение в очереди и повторяет его', async () => {
    let fail = true;
    const written: number[] = [];
    const autosave = createAutosave<number>({
      write: async (value) => {
        if (fail) throw new Error('conflict');
        written.push(value);
      },
      classifyError: () => 'conflict',
    });
    autosave.schedule(5);
    await vi.advanceTimersByTimeAsync(500);
    expect(autosave.status()).toBe('conflict');
    expect(autosave.busy()).toBe(true);
    expect(written).toEqual([]);
    fail = false;
    await autosave.flush();
    expect(written).toEqual([5]);
    expect(autosave.status()).toBe('saved');
    expect(autosave.busy()).toBe(false);
  });

  it('dispose останавливает отложенную запись', async () => {
    const write = vi.fn(async () => undefined);
    const autosave = createAutosave<number>({ write });
    autosave.schedule(1);
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });
});
