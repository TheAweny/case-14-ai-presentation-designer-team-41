import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  brandPhase,
  displayWidth,
  fit,
  gradient,
  terminalStyle,
  type TerminalOutput,
  type TerminalStyle,
} from './theme.js';

const rgb: TerminalStyle = { colorDepth: 24, interactive: true, animate: true, unicode: true };
const output = (tty = true, depth = 24): TerminalOutput =>
  Object.assign(
    new Writable({
      write(_chunk, _encoding, next) {
        next();
      },
    }),
    { isTTY: tty, columns: 80, getColorDepth: () => depth },
  );

describe('terminal appearance', () => {
  it('preserves visible text and width while the gradient moves', () => {
    const first = gradient('LCT · Презентации', 0, rgb);
    const second = gradient('LCT · Презентации', 0.3, rgb);
    expect(first).not.toBe(second);
    expect(displayWidth(first)).toBe(displayWidth('LCT · Презентации'));
    expect(first).toContain('\x1b[38;2;160;160;160m');
    for (const frame of [first, second]) {
      for (const [, red, green, blue] of frame.matchAll(/\[38;2;(\d+);(\d+);(\d+)m/g)) {
        expect(red).toBe(green);
        expect(green).toBe(blue);
      }
    }
  });
  it('does not split emoji families, accents and wide characters', () => {
    for (const value of ['👨‍👩‍👧‍👦 account', '界面 settings', 'Cafe\u0301']) {
      for (let width = 0; width <= 8; width++)
        expect(displayWidth(fit(value, width))).toBeLessThanOrEqual(width);
    }
    expect(fit('👨‍👩‍👧‍👦 account', 3)).toBe('👨‍👩‍👧‍👦…');
    expect(displayWidth(gradient('👨‍👩‍👧‍👦', 0, rgb))).toBe(2);
  });
  it('uses truecolor when advertised and degrades to 256/basic colors', () => {
    expect(terminalStyle(output(), { TERM: 'xterm', COLORTERM: 'truecolor' }).colorDepth).toBe(24);
    const indexed = terminalStyle(output(), { TERM: 'xterm-256color' });
    expect(indexed.colorDepth).toBe(8);
    expect(gradient('LCT', 0, indexed)).toContain('\x1b[38;5;247m');
    const basic = terminalStyle(output(true, 4), { TERM: 'xterm' });
    expect(basic.colorDepth).toBe(4);
    expect(gradient('LCT', 0, basic)).not.toContain('38;2;');
    expect(gradient('LCT', 0, basic)).toContain('\x1b[37m');
  });
  it.each([{ TERM: 'dumb' }, { TERM: 'xterm', NO_COLOR: '' }, { TERM: 'xterm', NO_COLOR: '1' }])(
    'keeps plain output stable: %j',
    (env) => {
      const style = terminalStyle(output(), env);
      expect(style.interactive).toBe(false);
      expect(style.animate).toBe(false);
      expect(gradient('Настройка', 0.5, style)).toBe('Настройка');
    },
  );
  it('never adds ANSI codes to redirected output despite FORCE_COLOR', () => {
    const style = terminalStyle(output(false), { TERM: 'xterm', FORCE_COLOR: '3' });
    expect(gradient('LCT', 0.2, style)).toBe('LCT');
  });
  it('keeps colors but stops motion when reduced motion is requested', () => {
    const style = terminalStyle(output(), { TERM: 'xterm', LCT_REDUCED_MOTION: '1' });
    expect(style.animate).toBe(false);
    expect(style.colorDepth).toBe(24);
  });
  it('uses a smooth repeating phase with no negative clock edge', () => {
    expect(brandPhase(0)).toBe(brandPhase(6000));
    expect(brandPhase(1500)).toBe(0.25);
    expect(brandPhase(-1500)).toBe(0.75);
  });
});
