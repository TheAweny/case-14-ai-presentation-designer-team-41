import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as clack from '@clack/prompts';
import * as ui from './ui.js';

vi.mock('@clack/prompts', () => ({
  select: vi.fn(),
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), step: vi.fn() },
}));
const stream = () =>
  Object.assign(
    new Writable({
      write(_chunk, _encoding, next) {
        next();
      },
    }),
    { isTTY: true, columns: 80, getColorDepth: () => 24 },
  );
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('prompt gradient animation', () => {
  it('refreshes an active prompt while preserving options and clearing its timer after selection', async () => {
    vi.stubEnv('NO_COLOR', undefined);
    vi.stubEnv('TERM', 'xterm');
    vi.stubEnv('LCT_REDUCED_MOTION', undefined);
    vi.useFakeTimers();
    const output = stream();
    const refresh = vi.fn();
    output.on('resize', refresh);
    let finish: (value: string) => void = () => undefined;
    vi.mocked(clack.select).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const choices = [{ value: 'one', label: 'Первый' }];
    const pending = ui.select({ message: 'Управление', options: choices, output });
    const options = vi.mocked(clack.select).mock.calls.at(-1)?.[0];
    const first = options?.message;
    vi.advanceTimersByTime(500);
    expect(options?.message).not.toBe(first);
    expect(options?.options).toBe(choices);
    expect(refresh).toHaveBeenCalledTimes(4);
    finish('one');
    expect(await pending).toBe('one');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans up on prompt errors', async () => {
    vi.stubEnv('NO_COLOR', undefined);
    vi.stubEnv('TERM', 'xterm');
    vi.useFakeTimers();
    vi.mocked(clack.select).mockRejectedValueOnce(new Error('input closed'));
    await expect(
      ui.select({ message: 'Настройка', options: [], output: stream() }),
    ).rejects.toThrow('input closed');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never animates or adds escape sequences when NO_COLOR is set', async () => {
    vi.stubEnv('NO_COLOR', '');
    vi.useFakeTimers();
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = stream();
    const write = vi.spyOn(output, 'write');
    const pending = ui.select({ message: 'Настройка', options: [{ value: 'one' }], input, output });
    input.write('1\n');
    expect(await pending).toBe('one');
    expect(write.mock.calls.map(([text]) => String(text)).join('')).not.toContain('\x1b');
    expect(vi.getTimerCount()).toBe(0);
    await new Promise<void>((resolve) => output.end(resolve));
    input.destroy();
  });
});
