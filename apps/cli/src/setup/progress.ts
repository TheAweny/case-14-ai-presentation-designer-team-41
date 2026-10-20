import type { SpinnerResult } from '@clack/prompts';
import type { Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { brandPhase, displayWidth, fit, gradient, terminalStyle } from './theme.js';
import type { TerminalOutput, TerminalStyle } from './theme.js';

export interface ProgressOptions {
  output?: Writable & { isTTY?: boolean; columns?: number };
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface ProgressResult extends SpinnerResult {
  update(completed: number, total?: number): void;
}

const hideCursor = '\x1b[?25l';
const showCursor = '\x1b[?25h';
const eraseLine = '\r\x1b[2K';
type Outcome = 'done' | 'error' | 'cancelled';
const statuses: Record<Outcome, string> = {
  done: 'Готово',
  error: 'Ошибка',
  cancelled: 'Отменено',
};

function plain(text: string): string {
  return Array.from(stripVTControlCharacters(text).replace(/[\r\n\t]/g, ' '))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && (code < 127 || code > 159);
    })
    .join('');
}

/** Owns two terminal lines; slow streams retain only the latest requested frame. */
export function progress(options: ProgressOptions = {}): ProgressResult {
  const output: TerminalOutput = options.output ?? process.stdout;
  const env = options.env ?? process.env;
  const style: TerminalStyle = terminalStyle(output, env);
  const interactive = style.interactive;
  const animated = interactive && style.animate;
  let running = false;
  let cancelled = false;
  let label = 'Выполняется';
  let started = 0;
  let completed: number | undefined;
  let total: number | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let frameWidths: number[] = [];
  let hidden = false;
  let blocked = false;
  let dirty = false;

  const columns = () => Math.max(1, Math.floor(output.columns || 80));
  const phase = () => (animated ? brandPhase() : 0);

  function cleanup(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    output.off('drain', onDrain);
    output.off('resize', redraw);
    output.off('error', onOutputError);
    output.off('close', onOutputClose);
    options.signal?.removeEventListener('abort', onAbort);
    process.off('exit', onExit);
    blocked = false;
    dirty = false;
  }

  function erase(): string {
    if (!frameWidths.length) return '';
    // Terminals reflow the old frame when resized, including wrapped wide labels.
    const rows = frameWidths.reduce(
      (sum, width) => sum + Math.max(1, Math.ceil(width / columns())),
      0,
    );
    frameWidths = [];
    return eraseLine + ('\x1b[1A' + eraseLine).repeat(rows - 1);
  }

  function restore(): void {
    if (!hidden) return;
    hidden = false;
    try {
      output.write(showCursor);
    } catch {
      // A closed stream cannot accept a cursor restoration sequence.
    }
  }

  function onExit(): void {
    running = false;
    cleanup();
    restore();
  }

  function onOutputError(): void {
    running = false;
    cleanup();
    restore();
  }

  function onOutputClose(): void {
    running = false;
    cleanup();
    hidden = false;
  }

  function write(text: string): void {
    try {
      blocked = !output.write(text);
      if (blocked && running) output.once('drain', onDrain);
    } catch {
      onOutputError();
    }
  }

  function onDrain(): void {
    blocked = false;
    if (dirty && running) redraw();
  }

  function measurements(includePercent = true): string {
    if (completed === undefined) return '';
    if (total === undefined) return ` · ${completed}`;
    // Rounding must never claim completion before the actual measurement does.
    const percent = Math.floor((Math.min(completed, total) / total) * 100);
    return ` · ${completed}/${total}${includePercent ? ` · ${percent}%` : ''}`;
  }

  function frame(outcome?: Outcome): string {
    const width = Math.max(0, columns() - 4);
    const indent = ' '.repeat(Math.min(2, Math.max(0, columns() - 1)));
    const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const failed = outcome === 'error' || outcome === 'cancelled';
    const suffix = `${measurements(!failed)} · ${elapsed}с`;
    const heading = outcome ? `${statuses[outcome]} · ${label}` : label;
    const headingWidth = Math.max(0, width - displayWidth(suffix));
    const header = fit(fit(heading, headingWidth) + suffix, width);
    const filled = style.unicode ? '━' : '=';
    const empty = style.unicode ? '─' : '-';
    const shimmer = outcome ? 0 : phase();
    let track = '';
    if (failed || (total !== undefined && completed !== undefined) || outcome === 'done') {
      const count = failed
        ? 0
        : total !== undefined && completed !== undefined
          ? Math.floor((Math.min(completed, total) / total) * width)
          : width;
      track = gradient(filled.repeat(count), shimmer, style);
      const rest = empty.repeat(width - count);
      track += style.colorDepth ? `\x1b[2m${rest}\x1b[22m` : rest;
    } else {
      // A cyclic travelling wave crosses the entire track; it implies no percentage.
      const head = shimmer * width;
      const waveWidth = Math.max(1, width * 0.24);
      for (let index = 0; index < width; index++) {
        const distance = (index - head + width) % width;
        const cell = distance < waveWidth ? filled : empty;
        const colored = gradient(cell, shimmer + index / Math.max(1, width), style);
        track += distance < waveWidth || !style.colorDepth ? colored : `\x1b[2m${colored}\x1b[22m`;
      }
    }
    frameWidths = [displayWidth(indent + header), displayWidth(indent) + width];
    return `${indent}${gradient(header, shimmer, style)}\n${indent}${track}\r`;
  }

  function redraw(): void {
    if (!running || !interactive) return;
    if (blocked) {
      dirty = true;
      return;
    }
    dirty = false;
    const clearing = erase();
    const hiding = hidden ? '' : hideCursor;
    hidden = true;
    write(hiding + clearing + frame());
  }

  function finish(outcome: Outcome, message?: string, clear = false): void {
    if (!running) return;
    if (message !== undefined) label = plain(message);
    running = false;
    cleanup();
    if (interactive) {
      const clearing = erase();
      const finalFrame = clear ? '' : frame(outcome) + '\n';
      frameWidths = [];
      // One final write is bounded even while backpressured; Writable preserves order.
      const showing = hidden ? showCursor : '';
      hidden = false;
      try {
        output.write(clearing + finalFrame + showing);
      } catch {
        hidden = Boolean(showing);
        restore();
      }
    } else if (!clear) {
      write(`${statuses[outcome]} · ${label}${measurements(outcome === 'done')}\n`);
    }
  }

  function onAbort(): void {
    cancelled = true;
    finish('cancelled');
  }

  return {
    start(message) {
      if (running) {
        if (message !== undefined) label = plain(message);
        redraw();
        return;
      }
      if (options.signal?.aborted) {
        cancelled = true;
        return;
      }
      cancelled = false;
      if (message !== undefined) label = plain(message);
      completed = undefined;
      total = undefined;
      started = Date.now();
      running = true;
      output.on('error', onOutputError);
      output.on('close', onOutputClose);
      options.signal?.addEventListener('abort', onAbort, { once: true });
      if (interactive) {
        output.on('resize', redraw);
        process.once('exit', onExit);
        redraw();
        if (running && animated) {
          timer = setInterval(redraw, 120);
          timer.unref();
        }
      } else {
        write(`${label}\n`);
      }
    },
    stop: (message) => finish('done', message),
    error: (message) => finish('error', message),
    cancel(message) {
      cancelled = true;
      finish('cancelled', message);
    },
    message(message) {
      if (message !== undefined) label = plain(message);
      redraw();
    },
    clear: () => finish('done', undefined, true),
    get isCancelled() {
      return cancelled;
    },
    update(value, maximum) {
      if (!Number.isFinite(value) || value < 0) return;
      completed = value;
      if (maximum !== undefined) {
        total = Number.isFinite(maximum) && maximum > 0 ? maximum : undefined;
      }
      redraw();
    },
  };
}
