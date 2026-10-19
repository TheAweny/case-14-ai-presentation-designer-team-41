import { stripVTControlCharacters } from 'node:util';
import type { Writable } from 'node:stream';
import stringWidth from 'fast-string-width';

export type TerminalOutput = Writable & {
  isTTY?: boolean;
  columns?: number;
  getColorDepth?: (env?: NodeJS.ProcessEnv) => number;
};

export interface TerminalStyle {
  colorDepth: 0 | 4 | 8 | 24;
  interactive: boolean;
  animate: boolean;
  unicode: boolean;
}

const palette = [
  [160, 160, 160],
  [208, 208, 208],
  [240, 240, 240],
] as const;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function terminalStyle(
  output: TerminalOutput = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): TerminalStyle {
  const interactive = output.isTTY === true && env.TERM !== 'dumb' && env.NO_COLOR === undefined;
  let depth = 0;
  if (interactive) {
    if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? '') || env.WT_SESSION) depth = 24;
    else if (env.TERM?.includes('256color')) depth = 8;
    else depth = output.getColorDepth?.(env) ?? 4;
  }
  return {
    interactive,
    colorDepth: depth >= 24 ? 24 : depth >= 8 ? 8 : depth >= 4 ? 4 : 0,
    animate: interactive && depth > 0 && env.LCT_REDUCED_MOTION !== '1',
    unicode:
      process.platform !== 'win32' ||
      Boolean(env.WT_SESSION || env.TERM?.includes('xterm') || env.TERM_PROGRAM),
  };
}

export function brandPhase(now = Date.now()): number {
  return (((now % 6000) + 6000) % 6000) / 6000;
}

export function gradient(text: string, phase = 0, style = terminalStyle()): string {
  const plain = stripVTControlCharacters(text);
  if (!style.colorDepth) return plain;
  const cells = [...segmenter.segment(plain)].map(({ segment }) => segment);
  return cells
    .map((cell, index) => {
      if (!cell.trim()) return cell;
      const position =
        ((((index / Math.max(cells.length - 1, 1) + phase) % 1) + 1) % 1) * palette.length;
      const anchor = Math.floor(position);
      const left = palette[anchor % palette.length] ?? palette[0];
      const right = palette[(anchor + 1) % palette.length] ?? palette[0];
      const rgb = left.map((channel, i) =>
        Math.round(channel + ((right[i] ?? channel) - channel) * (position - anchor)),
      );
      const prefix =
        style.colorDepth === 24
          ? `\x1b[38;2;${rgb.join(';')}m`
          : style.colorDepth === 8
            ? `\x1b[38;5;${232 + Math.max(0, Math.min(23, Math.round(((rgb[0] ?? 0) - 8) / 10)))}m`
            : `\x1b[${[37, 37, 97][anchor % 3]}m`;
      return `${prefix}${cell}\x1b[39m`;
    })
    .join('');
}

export function displayWidth(text: string): number {
  return stringWidth(stripVTControlCharacters(text));
}

/** A single plain line that fits physical cells, including emoji and wide CJK text. */
export function fit(text: string, columns: number): string {
  const maximum = Math.max(0, Math.floor(columns));
  const plain = stripVTControlCharacters(text).replace(/[\r\n\t]/g, ' ');
  if (displayWidth(plain) <= maximum) return plain;
  if (maximum <= 1) return maximum ? '…' : '';
  let result = '';
  for (const { segment } of segmenter.segment(plain)) {
    if (displayWidth(result + segment) > maximum - 1) break;
    result += segment;
  }
  return `${result}…`;
}
