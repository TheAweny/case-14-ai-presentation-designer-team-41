import * as clack from '@clack/prompts';
import type { Writable } from 'node:stream';
import { brandPhase, gradient, terminalStyle, type TerminalOutput } from './theme.js';
import { plainConfirm, plainOutput, plainPassword, plainSelect, plainText } from './plain-ui.js';
export { progress as spinner } from './progress.js';
export const isCancel = (value: unknown): value is symbol => typeof value === 'symbol';

type PromptOptions = { message: string; output?: Writable };

async function animatePrompt<T, O extends PromptOptions>(
  options: O,
  render: (options: O) => Promise<T>,
): Promise<T> {
  const output = (options.output ?? process.stdout) as TerminalOutput;
  const style = terminalStyle(output);
  if (!style.colorDepth) return render(options);
  let live = true;
  const themed = { ...options };
  Object.defineProperty(themed, 'message', {
    enumerable: true,
    get: () => gradient(options.message, live && style.animate ? brandPhase() : 0, style),
  });
  const clock = style.animate ? setInterval(() => output.emit('resize'), 125) : undefined;
  clock?.unref();
  try {
    return await render(themed);
  } finally {
    live = false;
    if (clock) clearInterval(clock);
  }
}

const colored = (options: { output?: Writable }) =>
  terminalStyle(options.output as TerminalOutput).colorDepth > 0;

export const select: typeof clack.select = (options) =>
  colored(options) ? animatePrompt(options, clack.select) : plainSelect(options);
export const text: typeof clack.text = (options) =>
  colored(options) ? animatePrompt(options, clack.text) : plainText(options);
export const password: typeof clack.password = (options) =>
  colored(options) ? animatePrompt(options, clack.password) : plainPassword(options);
export const confirm: typeof clack.confirm = (options) =>
  colored(options) ? animatePrompt(options, clack.confirm) : plainConfirm(options);

function staticOptions<T extends { output?: Writable }>(options?: T) {
  const output = (options?.output ?? process.stdout) as TerminalOutput;
  return { ...options, output: terminalStyle(output).colorDepth ? output : plainOutput(output) };
}

export const intro: typeof clack.intro = (title, options) =>
  clack.intro(
    title ? gradient(title, 0, terminalStyle(options?.output as TerminalOutput)) : title,
    staticOptions(options),
  );
export const outro: typeof clack.outro = (title, options) =>
  clack.outro(
    title ? gradient(title, 0, terminalStyle(options?.output as TerminalOutput)) : title,
    staticOptions(options),
  );
export const note: typeof clack.note = (message, title, options) =>
  clack.note(
    message,
    title ? gradient(title, 0, terminalStyle(options?.output as TerminalOutput)) : title,
    staticOptions(options),
  );
export const cancel: typeof clack.cancel = (message, options) =>
  clack.cancel(message, staticOptions(options));
export const log = {
  info: (message: string, options?: Parameters<typeof clack.log.info>[1]) =>
    clack.log.info(message, staticOptions(options)),
  success: (message: string, options?: Parameters<typeof clack.log.success>[1]) =>
    clack.log.success(message, staticOptions(options)),
  warn: (message: string, options?: Parameters<typeof clack.log.warn>[1]) =>
    clack.log.warn(message, staticOptions(options)),
  error: (message: string, options?: Parameters<typeof clack.log.error>[1]) =>
    clack.log.error(message, staticOptions(options)),
  step: (message: string, options?: Parameters<typeof clack.log.step>[1]) =>
    clack.log.step(
      gradient(message, 0, terminalStyle(options?.output as TerminalOutput)),
      staticOptions(options),
    ),
};
