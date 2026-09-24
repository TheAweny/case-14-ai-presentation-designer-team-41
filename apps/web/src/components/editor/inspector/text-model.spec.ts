import { describe, expect, it } from 'vitest';
import type { DesignSystem, TextRun } from '@lct/contracts';
import { textLook, typeSteps, type TextElement } from './text-model';
import { tokenMeta } from '../../../mocks/demo-deck/token-meta';

const designSystem = {
  palette: [
    { role: 'text', hex: '16181D', meta: tokenMeta('theme') },
    { role: 'accent', hex: '3355DD', meta: tokenMeta('theme') },
  ],
  typeScale: [
    {
      role: 'title',
      font: 'Inter',
      sizePt: 40,
      bold: true,
      italic: false,
      lineSpacing: 1,
      colorRole: 'text',
      meta: tokenMeta('theme'),
    },
    {
      role: 'body',
      font: 'Inter',
      sizePt: 18,
      bold: false,
      italic: false,
      lineSpacing: 1.2,
      colorRole: 'text',
      meta: tokenMeta('theme'),
    },
    {
      role: 'body',
      font: 'Inter',
      sizePt: 18,
      bold: false,
      italic: false,
      lineSpacing: 1.2,
      colorRole: 'text',
      meta: tokenMeta('observed'),
    },
  ],
} as unknown as DesignSystem;

function run(text: string, extra: Partial<TextRun> = {}): TextRun {
  return { text, font: '', sizePt: null, bold: null, italic: null, color: '', ...extra };
}

function text(role: TextElement['role'], runs: TextRun[], extra: object = {}): TextElement {
  return {
    kind: 'text',
    elementId: `${role}-${runs.length}`,
    role,
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    paragraphs: [{ level: 0, runs }],
    overflow: null,
    ...extra,
  } as TextElement;
}

describe('textLook', () => {
  it('takes size, weight and colour from the type role when runs inherit them', () => {
    const look = textLook([text('title', [run('Заголовок')])], designSystem);
    expect(look).toMatchObject({ sizePt: 40, bold: true, italic: false, color: 'text' });
  });

  it('reads a run colour back as its palette role', () => {
    const look = textLook([text('body', [run('a', { color: '3355dd' })])], designSystem);
    expect(look.color).toBe('accent');
  });

  it('reports mixed values as null and bold only when every run is bold', () => {
    const look = textLook(
      [text('body', [run('a', { sizePt: 18, bold: true }), run('b', { sizePt: 24 })])],
      designSystem,
    );
    expect(look.sizePt).toBeNull();
    expect(look.bold).toBe(false);
  });

  it('defaults alignment to left and top', () => {
    const look = textLook([text('body', [run('a')])], designSystem);
    expect(look.align).toBe('left');
    expect(look.verticalAlign).toBe('top');
  });
});

describe('typeSteps', () => {
  it('lists each type role once', () => {
    expect(typeSteps(designSystem).map((step) => step.role)).toEqual(['title', 'body']);
  });
});
