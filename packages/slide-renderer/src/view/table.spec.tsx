import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DesignSystem, SlideElement } from '@lct/contracts';
import { TYPE_SCALE, WIDE, box, measured } from '../testing/deck.js';
import { TableMark, tableBordersOf, tableCellLook, trackShares } from './table.js';

type Table = Extract<SlideElement, { kind: 'table' }>;

/** Only what a table reads: the palette and the type scale. */
const PROFILE = {
  ...TYPE_SCALE,
  palette: [
    { role: 'background', hex: 'FFFFFF', meta: measured() },
    { role: 'surface', hex: 'EEEEEE', meta: measured() },
    { role: 'text', hex: '111111', meta: measured() },
    { role: 'text-on-accent', hex: 'FAFAFA', meta: measured() },
    { role: 'accent', hex: '3355E0', meta: measured() },
    { role: 'line', hex: 'CCCCCC', meta: measured() },
  ],
} as unknown as DesignSystem;

function table(look: Partial<Table> = {}): Table {
  return {
    kind: 'table',
    elementId: 'grid',
    role: 'table',
    box: box(48, 100, 480, 120),
    sourceShapeId: null,
    headers: ['Этап', 'Где'],
    rows: [
      ['Разбор', 'Python'],
      ['План', 'TypeScript'],
      ['Вёрстка', 'Python'],
    ],
    ...look,
  };
}

function render(element: Table): string {
  return renderToStaticMarkup(<TableMark element={element} size={WIDE} profile={PROFILE} />);
}

/** The inline style of the cell whose text is `text`. */
function cellStyle(html: string, text: string): string {
  const match = new RegExp(`<td style="([^"]*)">${text}</td>`).exec(html);
  if (!match) throw new Error(`no cell ${text}`);
  return match[1] ?? '';
}

describe('table look', () => {
  it('draws a table that states nothing as before: a tinted bold header and rules under rows', () => {
    const html = render(table());
    expect(html).not.toContain('<colgroup');
    expect(html).not.toMatch(/<tr style=/);
    const head = cellStyle(html, 'Этап');
    expect(head).toContain('background:#EEEEEE');
    expect(head).toContain('font-weight:700');
    expect(head).toMatch(/border-bottom:[\d.]+cqw solid #CCCCCC/);
    const body = cellStyle(html, 'Разбор');
    expect(body).not.toContain('background');
    expect(body).toContain('font-weight:400');
    expect(body).toContain('vertical-align:top');
    expect(body).not.toContain('border-right');
  });

  it('sizes columns and rows by their shares of the box', () => {
    const html = render(table({ columnWidths: [3, 1], rowHeights: [1, 1, 1, 2] }));
    expect(html).toContain('<col style="width:75%"/><col style="width:25%"/>');
    // 120 pt of box, the last row twice the others: 24, 24, 24, 48 pt of a 960 pt slide.
    expect(html).toContain('<tr style="height:2.5cqw">');
    expect(html).toContain('<tr style="height:5cqw">');
  });

  it('paints cells, their words and their alignment from the cell look', () => {
    const html = render(
      table({
        cellStyles: [
          [{ fill: 'accent', color: 'text-on-accent' }, { fill: null }],
          [
            { bold: true, italic: true, underline: true },
            { align: 'right', verticalAlign: 'middle' },
          ],
          [{ fill: 'A1B2C3' }],
        ],
      }),
    );
    const head = cellStyle(html, 'Этап');
    expect(head).toContain('background:#3355E0');
    expect(head).toContain('color:#FAFAFA');
    // An explicit no-fill wins over the header tint.
    expect(cellStyle(html, 'Где')).not.toContain('background');
    const styled = cellStyle(html, 'Разбор');
    expect(styled).toContain('font-weight:700');
    expect(styled).toContain('font-style:italic');
    expect(styled).toContain('text-decoration:underline');
    const aligned = cellStyle(html, 'Python');
    expect(aligned).toContain('text-align:right');
    expect(aligned).toContain('vertical-align:middle');
    expect(cellStyle(html, 'План')).toContain('background:#A1B2C3');
  });

  it('bands every other body row and can drop the header look', () => {
    const banded = render(table({ bandedRows: true, bandFill: 'accent' }));
    expect(cellStyle(banded, 'Разбор')).toContain('background:#3355E0');
    expect(cellStyle(banded, 'План')).not.toContain('background');
    expect(cellStyle(banded, 'Вёрстка')).toContain('background:#3355E0');

    const plain = render(table({ headerRow: false, bandedRows: true }));
    const head = cellStyle(plain, 'Этап');
    expect(head).toContain('background:#EEEEEE');
    expect(head).toContain('font-weight:400');
    expect(cellStyle(plain, 'Разбор')).not.toContain('background');
  });

  it('draws the rules the table states, or none', () => {
    const ruled = render(
      table({
        borders: {
          color: 'accent',
          widthEmu: 12_700,
          horizontal: false,
          vertical: true,
          outer: true,
        },
      }),
    );
    expect(ruled).toMatch(/<table style="[^"]*border:0\.1042cqw solid #3355E0/);
    expect(cellStyle(ruled, 'Этап')).toContain('border-right:0.1042cqw solid #3355E0');
    expect(cellStyle(ruled, 'Этап')).not.toContain('border-bottom');
    // The last column has no rule on its right: that is the frame's job.
    expect(cellStyle(ruled, 'Где')).not.toContain('border-right');

    const bare = render(table({ borders: null }));
    expect(bare).not.toMatch(/border(-bottom|-right)?:[^c]/);
  });
});

describe('table helpers', () => {
  it('settles a cell look from the cell, then its row, then the defaults', () => {
    const element = table({ bandedRows: true, cellStyles: [[null, { bold: false }]] });
    expect(tableCellLook(element, 0, 0)).toEqual({
      fill: 'surface',
      color: null,
      bold: true,
      italic: false,
      underline: false,
      align: 'left',
      verticalAlign: 'top',
    });
    expect(tableCellLook(element, 0, 1).bold).toBe(false);
    expect(tableCellLook(element, 1, 0).fill).toBe('surface');
    expect(tableCellLook(element, 2, 0).fill).toBeNull();
  });

  it('reads shares relative to their sum and rules from the slide width', () => {
    expect(trackShares([1, 3], 2)).toEqual([0.25, 0.75]);
    expect(trackShares([1], 2)).toEqual([0.5, 0.5]);
    expect(tableBordersOf(table(), WIDE)).toMatchObject({ color: 'line', horizontal: true });
    expect(tableBordersOf(table({ borders: null }), WIDE)).toBeNull();
  });
});
