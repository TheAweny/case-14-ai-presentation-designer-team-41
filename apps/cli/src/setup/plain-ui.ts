import * as clack from '@clack/prompts';
import { createInterface, type Interface } from 'node:readline';
import { Writable, type Readable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';

export const PLAIN_CANCEL = Symbol('plain-ui:cancel');

/** Does not own or end the destination. Intended for static Clack output only. */
export function plainOutput(output: Writable): Writable {
  return Object.assign(
    new Writable({
      write(chunk, _encoding, done) {
        if (!output.destroyed && !output.writableEnded)
          output.write(stripVTControlCharacters(chunk.toString('utf8')));
        done();
      },
    }),
    { isTTY: false },
  );
}

type CommonOptions = Parameters<typeof clack.text>[0];
type TtyInput = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (raw: boolean) => void;
};
type Lines = {
  reader: Interface;
  queue: string[];
  closed: boolean;
  wake?: () => void;
};
const readers = new WeakMap<Readable, Lines>();

function streams(options: Pick<CommonOptions, 'input' | 'output' | 'signal'>) {
  const input = (options.input ?? process.stdin) as TtyInput;
  const output = options.output ?? process.stdout;
  if (!input.isTTY || !(output as Writable & { isTTY?: boolean }).isTTY)
    throw new Error('Нет терминала для вопросов. Передайте настройки флагами и укажите --yes.');
  return { input, output: plainOutput(output) };
}

function write(output: Writable, text: string): void {
  output.write(`${stripVTControlCharacters(text)}\n`);
}

function detach(input: Readable): void {
  const lines = readers.get(input);
  if (lines) {
    lines.reader.close();
    readers.delete(input);
  }
}

/** Keep readline's read-ahead queue across consecutive questions on the same input. */
async function readLine(input: TtyInput, signal?: AbortSignal): Promise<string | symbol> {
  if (signal?.aborted || input.destroyed) return PLAIN_CANCEL;
  let lines = readers.get(input);
  if (!lines) {
    if (input.readableEnded) return PLAIN_CANCEL;
    const reader = createInterface({ input, terminal: false, crlfDelay: Infinity });
    lines = { reader, queue: [], closed: false };
    const state = lines;
    reader.on('line', (line: string) => {
      state.queue.push(line);
      reader.pause();
      state.wake?.();
    });
    reader.once('close', () => {
      state.closed = true;
      state.wake?.();
    });
    readers.set(input, lines);
  }
  const state = lines;
  if (state.queue.length) return state.queue.shift() ?? PLAIN_CANCEL;
  if (state.closed) return PLAIN_CANCEL;
  return new Promise((resolve) => {
    const cleanup = () => {
      state.wake = undefined;
      signal?.removeEventListener('abort', cancel);
      process.off('SIGINT', cancel);
      input.off('error', cancel);
      input.off('close', cancel);
    };
    const cancel = () => {
      cleanup();
      detach(input);
      resolve(PLAIN_CANCEL);
    };
    state.wake = () => {
      cleanup();
      resolve(state.queue.shift() ?? PLAIN_CANCEL);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    process.once('SIGINT', cancel);
    input.once('error', cancel);
    input.once('close', cancel);
    state.reader.resume();
  });
}

function validate(validator: CommonOptions['validate'], value: string | undefined) {
  if (!validator) return undefined;
  if (typeof validator === 'function') {
    const error = validator(value);
    return error instanceof Error ? error.message : error;
  }
  const result = validator['~standard'].validate(value);
  if (result instanceof Promise) throw new TypeError('Проверка ввода должна быть синхронной.');
  return result.issues?.[0]?.message;
}

export const plainText: typeof clack.text = async (options) => {
  const { input, output } = streams(options);
  if (options.signal?.aborted) return PLAIN_CANCEL;
  const initial = options.initialValue;
  for (;;) {
    write(
      output,
      `${options.message}${initial ? ` [${initial}]` : options.placeholder ? ` (${options.placeholder})` : ''}:`,
    );
    const line = await readLine(input, options.signal);
    if (typeof line === 'symbol') return line;
    const value = line || initial;
    const error = validate(options.validate, value);
    if (!error) return value || options.defaultValue || '';
    write(output, error);
  }
};

export const plainSelect: typeof clack.select = async (options) => {
  const { input, output } = streams(options);
  if (options.signal?.aborted) return PLAIN_CANCEL;
  const initial = options.options.findIndex(
    (option) => !option.disabled && option.value === options.initialValue,
  );
  const fallback = initial < 0 ? options.options.findIndex((option) => !option.disabled) : initial;
  if (fallback < 0) throw new Error('Нет доступных вариантов для выбора.');
  write(output, options.message);
  options.options.forEach((option, index) =>
    write(
      output,
      `${index + 1}. ${option.label ?? String(option.value)}${option.disabled ? ' (недоступно)' : ''}${option.hint ? ` — ${option.hint}` : ''}`,
    ),
  );
  for (;;) {
    write(output, `Номер варианта [${fallback + 1}]:`);
    const line = await readLine(input, options.signal);
    if (typeof line === 'symbol') return line;
    const answer = line.trim();
    const index = !answer ? fallback : /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
    const option = options.options[index];
    if (option && !option.disabled) return option.value;
    write(output, 'Укажите номер доступного варианта.');
  }
};

export const plainConfirm: typeof clack.confirm = async (options) => {
  const { input, output } = streams(options);
  if (options.signal?.aborted) return PLAIN_CANCEL;
  const active = options.active ?? 'Да';
  const inactive = options.inactive ?? 'Нет';
  const initial = options.initialValue ?? true;
  for (;;) {
    write(output, `${options.message} (1: ${active}; 2: ${inactive}) [${initial ? 1 : 2}]:`);
    const line = await readLine(input, options.signal);
    if (typeof line === 'symbol') return line;
    const answer = line.trim().toLowerCase();
    if (!answer) return initial;
    if (['1', 'y', 'yes', 'д', 'да', active.toLowerCase()].includes(answer)) return true;
    if (['2', 'n', 'no', 'н', 'нет', inactive.toLowerCase()].includes(answer)) return false;
    write(output, 'Введите 1 или 2.');
  }
};

/** Clack owns raw input and masking; none of its frames reach the user's output. */
export const plainPassword: typeof clack.password = async (options) => {
  const { input, output } = streams(options);
  if (options.signal?.aborted || input.destroyed || input.readableEnded) return PLAIN_CANCEL;
  detach(input);
  for (;;) {
    if (options.signal?.aborted || input.destroyed || input.readableEnded) return PLAIN_CANCEL;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const wasRaw = input.isRaw === true;
    const silent = Object.assign(
      new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
      { isTTY: false },
    );
    let error: string | undefined;
    let validationFailure = false;
    options.signal?.addEventListener('abort', abort, { once: true });
    input.once('end', abort);
    input.once('close', abort);
    input.once('error', abort);
    process.once('SIGINT', abort);
    write(output, `${options.message}:`);
    try {
      const result = await clack.password({
        ...options,
        input,
        output: silent,
        signal: controller.signal,
        validate(value) {
          try {
            error = validate(options.validate, value);
          } catch {
            validationFailure = true;
          }
          // Close this prompt even on invalid input: a fresh instance resets its
          // private readline buffer before the next password attempt.
          return undefined;
        },
      });
      if (validationFailure) throw new Error('Не удалось проверить пароль.');
      if (clack.isCancel(result) || typeof result === 'symbol') return PLAIN_CANCEL;
      if (error) {
        write(output, result ? error.replaceAll(result, '[скрыто]') : error);
        continue;
      }
      write(output, '[введен]');
      return result;
    } finally {
      options.signal?.removeEventListener('abort', abort);
      input.off('end', abort);
      input.off('close', abort);
      input.off('error', abort);
      process.off('SIGINT', abort);
      if (wasRaw) input.setRawMode?.(true);
      silent.destroy();
    }
  }
};
