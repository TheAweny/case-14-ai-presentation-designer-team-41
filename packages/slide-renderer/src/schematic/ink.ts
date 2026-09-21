import type { CSSProperties } from 'react';

/**
 * The schematic is drawn in one ink at several densities, so it follows whatever colour the host
 * gives it and reads the same in a light and a dark theme.
 *
 * The ink is `currentColor` unless the host sets `--schematic-ink`; `--schematic-surface` paints
 * the slide itself and is transparent unless set, so a background class on the host shows through.
 * Densities are mixed towards transparent rather than towards a background colour, which keeps
 * overlapping marks honest: a card on a panel reads darker than either.
 */

export type InkLevel =
  /** Titles and key figures: the first thing the eye should find. */
  | 'strong'
  /** Subtitles, quotes, headings inside running text. */
  | 'emphasis'
  /**
   * The leading data series. Below `emphasis` because a bar has far more area than a line of
   * type and would otherwise outweigh the title.
   */
  | 'data'
  /** Running text. */
  | 'text'
  /** Secondary text: footers, captions, table cells, chart labels. */
  | 'muted'
  /** Hairlines: table rules, chart axes, picture frames. */
  | 'line'
  /** Thin template shapes such as rules under a title: small, so they need density to show. */
  | 'rule'
  /** Small template shapes: marks, badges. */
  | 'mark'
  /** Tinted areas: picture placeholders, table heads. */
  | 'fill'
  /** Large template shapes: panels and cards, the quietest level. */
  | 'decor';

const DENSITY: Record<InkLevel, number> = {
  strong: 72,
  emphasis: 52,
  data: 40,
  text: 32,
  muted: 22,
  line: 14,
  rule: 34,
  mark: 14,
  fill: 7,
  decor: 5,
};

const LEVELS = Object.keys(DENSITY) as InkLevel[];

export function ink(level: InkLevel): string {
  return `var(--sx-${level})`;
}

/** Custom properties the root declares; every mark refers to them through `ink()`. */
export function inkVariables(): CSSProperties {
  const variables: Record<string, string> = {
    '--sx-ink': 'var(--schematic-ink, currentColor)',
  };
  for (const level of LEVELS) {
    variables[`--sx-${level}`] =
      `color-mix(in oklab, var(--sx-ink) ${DENSITY[level]}%, transparent)`;
  }
  return variables as CSSProperties;
}

/** Densities for data series and pie sectors, strongest first, cycled when there are more. */
export const SERIES_LEVELS: readonly InkLevel[] = ['data', 'muted', 'mark', 'fill'];

/**
 * Thickness of a line that has to stay visible on a thumbnail: its share of the slide, but never
 * thinner than one CSS pixel. The only place the schematic uses `px`.
 */
export function hairline(cqwValue: string): string {
  return `max(1px, ${cqwValue})`;
}
