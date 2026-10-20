import { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import type { SpinnerResult } from '@clack/prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { displayWidth } from './theme.js';
import * as theme from './theme.js';
import { progress } from './progress.js';
import type { ProgressResult } from './progress.js';

class Terminal extends Writable {
  isTTY = true;
  columns = 80;
  chunks: string[] = [];

  getColorDepth(): number {
    return 24;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get text(): string {
    return this.chunks.join('');
  }

  get last(): string {
    return stripVTControlCharacters(this.chunks.at(-1) ?? '').replace(/\r/g, '');
  }
}

class SlowTerminal extends Terminal {
  pending: (() => void)[] = [];

  constructor() {
    super({ highWaterMark: 1 });
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.chunks.push(chunk.toString());
    this.pending.push(callback);
  }

  flush(): void {
    while (this.pending.length) this.pending.shift()?.();
  }
}

const env = { TERM: 'xterm-256color', COLORTERM: 'truecolor', WT_SESSION: 'test' };
const indicators: ProgressResult[] = [];
let exitListeners = process.listeners('exit');

function setup(output = new Terminal(), extraEnv: NodeJS.ProcessEnv = {}) {
  const indicator = progress({ output, env: { ...env, ...extraEnv } });
  indicators.push(indicator);
  return { output, indicator };
}

function track(output: Terminal): string {
  return output.last.split('\n')[1]?.trim() ?? '';
}

function expectClean(output: Terminal): void {
  expect(vi.getTimerCount()).toBe(0);
  for (const event of ['resize', 'drain', 'error', 'close']) {
    expect(output.listenerCount(event)).toBe(0);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  exitListeners = process.listeners('exit');
});

afterEach(() => {
  for (const indicator of indicators.splice(0)) indicator.clear();
  expect(process.listeners('exit')).toEqual(exitListeners);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('terminal progress', () => {
  it('implements the synchronous SpinnerResult interface', () => {
    const { indicator } = setup();
    const spinner: SpinnerResult = indicator;
    expect(spinner.start('Загрузка')).toBeUndefined();
    expect(spinner.message('Распаковка')).toBeUndefined();
    expect(indicator.update(1, 2)).toBeUndefined();
    expect(spinner.stop()).toBeUndefined();
  });

  it.each([24, 80, 160, 240])(
    'uses a separate thin track of columns minus four at %i columns',
    (columns) => {
      const { output, indicator } = setup();
      output.columns = columns;
      indicator.start('Загрузка');
      expect(track(output)).toHaveLength(columns - 4);
      expect(track(output)).toMatch(/^[━─]+$/u);
      expect(output.last.split('\n')).toHaveLength(2);
      expect(output.last).not.toMatch(/[[\]│╭╮╰╯]/u);
      for (const line of output.last.split('\n')) expect(displayWidth(line)).toBeLessThan(columns);
    },
  );

  it('moves the unknown-length wave and shimmers the header on a 120ms interval', () => {
    const interval = vi.spyOn(globalThis, 'setInterval');
    const { output, indicator } = setup();
    indicator.start('Загрузка модели');
    const firstTrack = track(output);
    const firstHeader = output.chunks.at(-1)?.split('\n')[0];
    vi.advanceTimersByTime(120);
    expect(track(output)).not.toBe(firstTrack);
    expect(output.chunks.at(-1)?.split('\n')[0]).not.toBe(firstHeader);
    expect(output.text).toContain('\x1b[38;2;');
    expect(output.text).not.toContain('%');
    expect(interval).toHaveBeenCalledWith(expect.any(Function), 120);
    expect(interval.mock.results[0]?.value.hasRef()).toBe(false);
  });

  it('covers every position with the travelling wave during a cycle', () => {
    const { output, indicator } = setup();
    indicator.start();
    const lit = new Set<number>();
    for (let tick = 0; tick < 50; tick++) {
      Array.from(track(output)).forEach((cell, index) => {
        if (cell === '━') lit.add(index);
      });
      vi.advanceTimersByTime(120);
    }
    expect(lit.size).toBe(output.columns - 4);
    expect(output.text).not.toContain('%');
  });

  it('uses ASCII track characters when Unicode is unavailable', () => {
    const output = new Terminal();
    const originalStyle = theme.terminalStyle;
    vi.spyOn(theme, 'terminalStyle').mockImplementationOnce((stream, settings) => ({
      ...originalStyle(stream, settings),
      unicode: false,
    }));
    const ascii = progress({ output, env });
    indicators.push(ascii);
    ascii.start('Download');
    expect(track(output)).toMatch(/^[=-]+$/);
    ascii.update(1, 4);
    expect(track(output)).toBe('='.repeat(19) + '-'.repeat(57));
    ascii.stop();
    expectClean(output);
  });

  it('shows measured progress and elapsed time on the clipped header', () => {
    const { output, indicator } = setup();
    indicator.start('Загрузка 界 👩‍💻 '.repeat(30));
    vi.advanceTimersByTime(2340);
    indicator.update(25, 100);
    const header = output.last.split('\n')[0] ?? '';
    expect(header).toContain('25/100 · 25% · 2с');
    expect(header).toContain('…');
    expect(displayWidth(header)).toBeLessThanOrEqual(78);
    expect(track(output)).toBe('━'.repeat(19) + '─'.repeat(57));
    indicator.update(50);
    expect(output.last).toContain('50/100 · 50%');
  });

  it('does not round incomplete measurements to 100 percent', () => {
    const { output, indicator } = setup();
    indicator.start();
    indicator.update(9999, 10000);
    expect(output.last).toContain('99%');
    expect(output.last).not.toContain('100%');
    expect(track(output)).toContain('─');
    indicator.stop();
    expect(output.last).toContain('99%');
    expect(track(output)).toContain('─');
  });

  it('finishes known progress only at the measured value and restores the cursor', () => {
    const { output, indicator } = setup();
    indicator.start();
    indicator.update(100, 100);
    indicator.stop('Установлено');
    expect(output.last).toContain('Готово · Установлено');
    expect(output.last).toContain('100/100 · 100%');
    expect(track(output)).toBe('━'.repeat(76));
    expect(output.text).toContain('\x1b[?25l');
    expect(output.text.endsWith('\x1b[?25h')).toBe(true);
    expectClean(output);
  });

  it('finishes unknown progress with a full static gradient without inventing a percentage', () => {
    const { output, indicator } = setup();
    indicator.start();
    indicator.update(2048);
    indicator.stop('Загружено');
    expect(track(output)).toBe('━'.repeat(76));
    expect(output.last).toContain('2048');
    expect(output.text).not.toContain('%');
    expectClean(output);
  });

  it.each(['error', 'cancel'] as const)(
    'does not show success on %s even after a 100 percent measurement',
    (method) => {
      const { output, indicator } = setup();
      indicator.start();
      indicator.update(100, 100);
      indicator[method]('Проверка не прошла');
      expect(output.last).toContain(method === 'error' ? 'Ошибка' : 'Отменено');
      expect(output.last).not.toContain('Готово');
      expect(output.last).not.toContain('100%');
      expect(track(output)).toBe('─'.repeat(76));
      expect(indicator.isCancelled).toBe(method === 'cancel');
      expect(output.text.endsWith('\x1b[?25h')).toBe(true);
      expectClean(output);
    },
  );

  it('resets measurements and cancellation when the same instance starts another task', () => {
    const { output, indicator } = setup();
    indicator.start('Первая');
    indicator.update(100, 100);
    indicator.cancel();
    indicator.start('Вторая');
    expect(indicator.isCancelled).toBe(false);
    expect(output.last).toContain('Вторая');
    expect(output.last).not.toContain('%');
    expect(track(output)).toContain('─');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('does not accumulate timers or listeners when start is called twice', () => {
    const { output, indicator } = setup();
    indicator.start('Первая');
    indicator.start('Вторая');
    expect(vi.getTimerCount()).toBe(1);
    expect(output.listenerCount('resize')).toBe(1);
    expect(output.last).toContain('Вторая');
    indicator.clear();
    expect(output.last).not.toContain('Готово');
    expectClean(output);
  });

  it('clears the whole previous frame after shrink, including rows reflowed by the terminal', () => {
    const { output, indicator } = setup();
    indicator.start('Длинная строка '.repeat(20));
    indicator.update(1, 2);
    output.columns = 20;
    output.emit('resize');
    const resized = output.chunks.at(-1) ?? '';
    expect(resized.split('\x1b[2K')).toHaveLength(9);
    expect(resized.split('\x1b[1A')).toHaveLength(8);
    expect(track(output)).toHaveLength(16);
    output.columns = 120;
    output.emit('resize');
    expect(output.chunks.at(-1)?.split('\x1b[2K')).toHaveLength(3);
    expect(track(output)).toHaveLength(116);
  });

  it.each([1, 2, 4, 5])('stays inside very narrow terminals of %i columns', (columns) => {
    const { output, indicator } = setup();
    output.columns = columns;
    indicator.start('界 👩‍💻');
    indicator.update(1, 2);
    for (const line of output.last.split('\n')) expect(displayWidth(line)).toBeLessThan(columns);
  });

  it('uses a static gradient without a timer in reduced motion and still redraws measurements', () => {
    const { output, indicator } = setup(new Terminal(), { LCT_REDUCED_MOTION: '1' });
    indicator.start();
    const initial = output.text;
    expect(initial).toContain('\x1b[38;2;');
    vi.advanceTimersByTime(10000);
    expect(output.text).toBe(initial);
    expect(vi.getTimerCount()).toBe(0);
    indicator.update(1, 4);
    expect(output.last).toContain('25%');
    expect(track(output)).toBe('━'.repeat(19) + '─'.repeat(57));
    output.columns = 40;
    output.emit('resize');
    expect(track(output)).toHaveLength(36);
    indicator.stop();
    expectClean(output);
  });

  it.each(['pipe', 'dumb', 'no-color'])(
    'logs only start and finish with no control sequences for %s',
    (mode) => {
      const output = new Terminal();
      output.isTTY = mode !== 'pipe';
      const { indicator } = setup(
        output,
        mode === 'dumb' ? { TERM: 'dumb' } : mode === 'no-color' ? { NO_COLOR: '' } : {},
      );
      indicator.start('\x1b[31mЗагрузка\x1b[0m');
      indicator.message('Проверка');
      indicator.update(1, 2);
      vi.advanceTimersByTime(12000);
      expect(output.chunks).toEqual(['Загрузка\n']);
      indicator.stop('Установлено');
      expect(output.chunks).toHaveLength(2);
      expect(output.text).not.toContain('\x1b');
      expect(output.text).not.toContain('\r');
      expectClean(output);
    },
  );

  it('strips terminal controls and newlines from labels', () => {
    const { output, indicator } = setup();
    indicator.start('Модель\n\t\x07\x1b[2Jзагрузка');
    expect(output.last.split('\n')).toHaveLength(2);
    expect(output.text).not.toContain('\x07');
    expect(output.text).not.toContain('\x1b[2J');
  });

  it('bounds frames during backpressure and draws only the latest state on drain', () => {
    const output = new Terminal();
    const originalWrite = output.write.bind(output);
    vi.spyOn(output, 'write').mockImplementationOnce((chunk) => {
      originalWrite(chunk);
      return false;
    });
    const { indicator } = setup(output);
    indicator.start();
    indicator.update(1, 100);
    indicator.update(40, 100);
    vi.advanceTimersByTime(12000);
    expect(output.chunks).toHaveLength(1);
    expect(output.listenerCount('drain')).toBe(1);
    output.emit('drain');
    expect(output.chunks).toHaveLength(2);
    expect(output.last).toContain('40/100 · 40%');
    expect(output.listenerCount('drain')).toBe(0);
    indicator.stop();
    expectClean(output);
  });

  it('restores the cursor and removes drain listeners even when finished under backpressure', () => {
    const output = new Terminal();
    const originalWrite = output.write.bind(output);
    vi.spyOn(output, 'write').mockImplementation((chunk) => {
      originalWrite(chunk);
      return false;
    });
    const { indicator } = setup(output);
    indicator.start();
    indicator.update(40, 100);
    indicator.error('Сеть недоступна');
    expect(output.chunks).toHaveLength(2);
    expect(output.last).toContain('Ошибка');
    expect(output.text.endsWith('\x1b[?25h')).toBe(true);
    expectClean(output);
    const stopped = output.text;
    output.emit('drain');
    vi.advanceTimersByTime(10000);
    expect(output.text).toBe(stopped);
  });

  it('queues only a bounded final frame on a genuinely slow Writable and preserves write order', () => {
    const output = new SlowTerminal();
    const { indicator } = setup(output);
    indicator.start('Загрузка');
    expect(output.writableNeedDrain).toBe(true);
    for (let value = 1; value <= 100; value++) indicator.update(value, 100);
    vi.advanceTimersByTime(12000);
    expect(output.chunks).toHaveLength(1);
    indicator.stop('Загружено');
    expectClean(output);
    output.flush();
    expect(output.chunks).toHaveLength(2);
    expect(output.last).toContain('100/100 · 100%');
    expect(output.text.endsWith('\x1b[?25h')).toBe(true);
    expect(output.writableLength).toBe(0);
    expectClean(output);
  });

  it('cancels via AbortSignal and removes its listener and every animation resource', () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const output = new Terminal();
    const indicator = progress({ output, env, signal: controller.signal });
    indicators.push(indicator);
    indicator.start('Загрузка');
    controller.abort();
    expect(indicator.isCancelled).toBe(true);
    expect(output.last).toContain('Отменено');
    expect(output.text.endsWith('\x1b[?25h')).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    expectClean(output);
    const stopped = output.text;
    indicator.update(100, 100);
    indicator.message('Позднее сообщение');
    indicator.stop();
    vi.advanceTimersByTime(10000);
    expect(output.text).toBe(stopped);
  });

  it('does not allocate resources or hide the cursor for an already aborted signal', () => {
    const output = new Terminal();
    const controller = new AbortController();
    controller.abort();
    const indicator = progress({ output, env, signal: controller.signal });
    indicator.start();
    expect(indicator.isCancelled).toBe(true);
    expect(output.text).toBe('');
    expectClean(output);
  });

  it('restores the cursor on process exit without installing signal handlers', () => {
    const previousExit = process.listeners('exit');
    const previousInt = process.listeners('SIGINT');
    const previousTerm = process.listeners('SIGTERM');
    const { output, indicator } = setup();
    indicator.start();
    const exit = process.listeners('exit').find((listener) => !previousExit.includes(listener));
    expect(exit).toBeDefined();
    expect(process.listeners('SIGINT')).toEqual(previousInt);
    expect(process.listeners('SIGTERM')).toEqual(previousTerm);
    exit?.(0);
    expect(output.text.endsWith('\x1b[?25h')).toBe(true);
    expect(process.listeners('exit')).toEqual(previousExit);
    expectClean(output);
  });

  it('cleans up a synchronous write failure and attempts to restore the cursor', () => {
    const { output, indicator } = setup();
    vi.spyOn(output, 'write').mockImplementationOnce(() => {
      throw new Error('Write failed');
    });
    expect(() => indicator.start()).not.toThrow();
    expect(output.text).toBe('\x1b[?25h');
    expectClean(output);
  });

  it('restores the cursor and cleans up on output failure', () => {
    const { output, indicator } = setup();
    indicator.start();
    output.emit('error', new Error('Disconnected'));
    expect(output.text.endsWith('\x1b[?25h')).toBe(true);
    expectClean(output);
  });

  it('cleans up when the output closes', () => {
    const { output, indicator } = setup();
    indicator.start();
    output.emit('close');
    expectClean(output);
  });

  it('ignores invalid measurements and supports explicitly returning to unknown total', () => {
    const { output, indicator } = setup();
    indicator.start();
    indicator.update(1, 2);
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY]) indicator.update(invalid, 2);
    expect(output.last).toContain('1/2 · 50%');
    indicator.update(3, 0);
    expect(output.last).toContain(' · 3 · ');
    expect(output.last).not.toContain('%');
    indicator.update(4, Number.POSITIVE_INFINITY);
    expect(output.last).not.toContain('Infinity');
    expect(output.last).not.toContain('%');
  });
});
