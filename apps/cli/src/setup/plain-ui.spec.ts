import * as clack from '@clack/prompts';
import { PassThrough, Writable } from 'node:stream';
import { setImmediate } from 'node:timers/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PLAIN_CANCEL,
  plainConfirm,
  plainOutput,
  plainPassword,
  plainSelect,
  plainText,
} from './plain-ui.js';

const inputs: PassThrough[] = [];
function terminal() {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    setRawMode: vi.fn(function (raw: boolean) {
      input.isRaw = raw;
    }),
  });
  inputs.push(input);
  let text = '';
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        text += chunk.toString();
        done();
      },
    }),
    { isTTY: true, columns: 80 },
  );
  return { input, output, text: () => text };
}

afterEach(() => {
  for (const input of inputs.splice(0)) input.destroy();
  vi.unstubAllEnvs();
});

describe('plain terminal UI', () => {
  it('strips real Clack styling despite FORCE_COLOR without ending the destination', async () => {
    vi.stubEnv('FORCE_COLOR', '3');
    vi.stubEnv('NO_COLOR', '1');
    const io = terminal();
    io.output.isTTY = false;
    const output = plainOutput(io.output);
    clack.intro('Установка', { output });
    clack.log.info('Сервисы готовы', { output });
    output.end('\x1b[31mГотово\x1b[0m');
    await setImmediate();
    expect(io.text()).toContain('Установка');
    expect(io.text()).toContain('Сервисы готовы');
    expect(io.text()).toContain('Готово');
    expect(io.text()).not.toContain('\x1b');
    expect(io.output.writableEnded).toBe(false);
  });

  it('selects numbered values, rejecting partial numbers and disabled choices', async () => {
    const io = terminal();
    const pending = plainSelect({
      ...io,
      message: 'Выбор',
      options: [
        { value: 'blocked', disabled: true },
        { value: 'chosen', label: 'Доступный' },
      ],
    });
    io.input.write('2x\n1\n2\n');
    expect(await pending).toBe('chosen');
    expect(io.text().match(/Доступный/g)).toHaveLength(1);
    expect(io.text()).not.toContain('\x1b');
  });

  it('retains pasted lines between consecutive prompts on one input', async () => {
    const io = terminal();
    const first = plainText({ ...io, message: 'Имя' });
    io.input.write('Аня\r\n2\r\nнет\r\n');
    expect(await first).toBe('Аня');
    expect(
      await plainSelect({ ...io, message: 'Роль', options: [{ value: 'one' }, { value: 'two' }] }),
    ).toBe('two');
    expect(await plainConfirm({ ...io, message: 'Продолжить?' })).toBe(false);
    expect(io.text().match(/Имя/g)).toHaveLength(1);
  });

  it('supports defaults, initial values and validation with replacement input', async () => {
    const io = terminal();
    const pending = plainText({
      ...io,
      message: 'Имя',
      initialValue: 'Анна',
      validate: (value) => (value === 'Анна' ? undefined : new Error('Нужно полное имя')),
    });
    io.input.write('А\n\n\n\n');
    expect(await pending).toBe('Анна');
    expect(io.text()).toContain('Нужно полное имя');
    expect(await plainText({ ...io, message: 'Модель', defaultValue: 'local' })).toBe('local');
    expect(await plainText({ ...io, message: 'Ключ', placeholder: 'не является значением' })).toBe(
      '',
    );
  });

  it('supports Standard Schema validation without a runtime dependency', async () => {
    const io = terminal();
    const pending = plainText({
      ...io,
      message: 'Текст',
      validate: {
        '~standard': {
          version: 1,
          vendor: 'test',
          validate: (value) => (value === 'ok' ? { value } : { issues: [{ message: 'Нужно ok' }] }),
        },
      },
    });
    io.input.write('bad\nok\n');
    expect(await pending).toBe('ok');
    expect(io.text()).toContain('Нужно ok');
  });

  it('supports confirm defaults, numbered choices and localized labels', async () => {
    const io = terminal();
    const pending = plainConfirm({ ...io, message: 'Запуск?', initialValue: false });
    io.input.write('\n1\nНазад\n');
    expect(await pending).toBe(false);
    expect(await plainConfirm({ ...io, message: 'Запуск?' })).toBe(true);
    expect(await plainConfirm({ ...io, message: 'Запуск?', inactive: 'Назад' })).toBe(false);
  });

  it('rejects prompts without a TTY before reading or writing', async () => {
    const io = terminal();
    for (const side of ['input', 'output'] as const) {
      io[side].isTTY = false;
      await expect(plainText({ ...io, message: 'Ввод' })).rejects.toThrow('--yes');
      await expect(plainConfirm({ ...io, message: 'Ввод' })).rejects.toThrow('--yes');
      await expect(
        plainSelect({ ...io, message: 'Ввод', options: [{ value: 1 }] }),
      ).rejects.toThrow('--yes');
      await expect(plainPassword({ ...io, message: 'Пароль' })).rejects.toThrow('--yes');
      io[side].isTTY = true;
    }
    expect(io.text()).toBe('');
  });

  it('cancels a pending line on abort and removes input and signal listeners', async () => {
    const io = terminal();
    const controller = new AbortController();
    const signals = process.listenerCount('SIGINT');
    const pending = plainText({ ...io, message: 'Ввод', signal: controller.signal });
    controller.abort();
    expect(await pending).toBe(PLAIN_CANCEL);
    expect(io.input.listenerCount('data')).toBe(0);
    expect(io.input.listenerCount('error')).toBe(0);
    expect(process.listenerCount('SIGINT')).toBe(signals);
  });

  it('cancels on EOF, including EOF after invalid input', async () => {
    const io = terminal();
    const pending = plainText({ ...io, message: 'Ввод', validate: () => 'Ошибка' });
    io.input.end('invalid\n');
    expect(await pending).toBe(PLAIN_CANCEL);
    expect(await plainConfirm({ ...io, message: 'Закрытый поток' })).toBe(PLAIN_CANCEL);
  });

  it('uses the initial enabled select option when Enter is pressed', async () => {
    const io = terminal();
    const pending = plainSelect({
      ...io,
      message: 'Выбор',
      initialValue: 'two',
      options: [{ value: 'one' }, { value: 'two' }],
    });
    io.input.write('\n');
    expect(await pending).toBe('two');
  });

  it('hides real Clack password frames and redacts values from validation errors', async () => {
    vi.stubEnv('FORCE_COLOR', '3');
    vi.stubEnv('NO_COLOR', '1');
    const io = terminal();
    const validator = vi.fn((value: string | undefined) =>
      value === 'secret-ok' ? undefined : `Не подходит: ${value}`,
    );
    const controller = new AbortController();
    const pending = plainPassword({
      ...io,
      message: 'Пароль',
      signal: controller.signal,
      validate: validator,
    });
    io.input.write('secret-bad\r');
    await setImmediate();
    io.input.write('secret-ok\r');
    await setImmediate();
    if (validator.mock.calls.at(-1)?.[0] !== 'secret-ok') controller.abort();
    expect(validator).toHaveBeenLastCalledWith('secret-ok');
    expect(await pending).toBe('secret-ok');
    expect(io.text()).toBe('Пароль:\nНе подходит: [скрыто]\nПароль:\n[введен]\n');
    expect(io.input.setRawMode).toHaveBeenCalledWith(true);
    expect(io.input.isRaw).toBe(false);
    expect(io.input.listenerCount('keypress')).toBe(0);
  });

  it('releases the line reader before password input on the same stream', async () => {
    const io = terminal();
    const first = plainText({ ...io, message: 'Почта' });
    io.input.write('a@example.com\n');
    await first;
    const pending = plainPassword({ ...io, message: 'Пароль' });
    io.input.write('hidden\r');
    expect(await pending).toBe('hidden');
    expect(io.text()).not.toContain('hidden');
  });

  it('cancels passwords on abort and EOF, restoring raw mode and listeners', async () => {
    for (const reason of ['abort', 'eof']) {
      const io = terminal();
      const controller = new AbortController();
      const signals = process.listenerCount('SIGINT');
      const pending = plainPassword({ ...io, message: 'Пароль', signal: controller.signal });
      io.input.write('unfinished-secret');
      if (reason === 'abort') controller.abort();
      else io.input.end();
      expect(await pending).toBe(PLAIN_CANCEL);
      expect(io.input.isRaw).toBe(false);
      expect(io.input.listenerCount('keypress')).toBe(0);
      expect(io.input.listenerCount('error')).toBe(0);
      expect(process.listenerCount('SIGINT')).toBe(signals);
      expect(io.text()).toBe('Пароль:\n');
    }
  });

  it('does not start input for an already aborted prompt', async () => {
    const io = terminal();
    const signal = AbortSignal.abort();
    expect(await plainText({ ...io, message: 'Ввод', signal })).toBe(PLAIN_CANCEL);
    expect(await plainPassword({ ...io, message: 'Пароль', signal })).toBe(PLAIN_CANCEL);
    expect(io.text()).toBe('');
    expect(io.input.setRawMode).not.toHaveBeenCalled();
  });
});
