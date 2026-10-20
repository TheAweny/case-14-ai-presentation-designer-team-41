import { PassThrough, Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { password, select } from './ui.js';

function terminal() {
  let captured = '';
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: vi.fn() });
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString();
        callback();
      },
    }),
    { isTTY: true, columns: 40, rows: 20, getColorDepth: () => 24 },
  );
  return { input, output, text: () => captured };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('animated prompts with real terminal input', () => {
  it('accepts arrow navigation and Enter immediately while its title animates', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('NO_COLOR', undefined);
    vi.useFakeTimers();
    const { input, output } = terminal();
    const pending = select({
      message: 'Управление',
      options: [
        { value: 'first', label: 'Первый' },
        { value: 'second', label: 'Второй' },
      ],
      input,
      output,
    });
    vi.advanceTimersByTime(500);
    input.write('\x1b[B');
    input.write('\r');
    expect(await pending).toBe('second');
    expect(vi.getTimerCount()).toBe(0);
    expect(output.listenerCount('resize')).toBe(0);
    input.destroy();
    output.destroy();
  });
  it('does not reveal typed passwords when animation repaints the prompt', async () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('NO_COLOR', undefined);
    vi.useFakeTimers();
    const { input, output, text } = terminal();
    const pending = password({ message: 'Пароль администратора', input, output });
    input.write('synthetic-private-password');
    vi.advanceTimersByTime(500);
    expect(text()).not.toContain('synthetic-private-password');
    input.write('\r');
    expect(await pending).toBe('synthetic-private-password');
    expect(text()).not.toContain('synthetic-private-password');
    expect(vi.getTimerCount()).toBe(0);
    input.destroy();
    output.destroy();
  });
});
