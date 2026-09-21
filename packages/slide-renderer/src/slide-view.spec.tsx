import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from './slide-view.js';
import { CONTENT, COVER, WIDE, box, paragraph, text } from './testing/deck.js';

const PROFILE = {
  schemaVersion: 1,
  templateHash: 'a'.repeat(64),
  aspect: '16:9',
  palette: [
    { role: 'background', hex: 'FFFFFF', source: 'observed', coverage: 1 },
    { role: 'surface', hex: 'EEEEEE', source: 'observed', coverage: 0 },
    { role: 'text', hex: '111111', source: 'observed', coverage: 0 },
    { role: 'text-muted', hex: '666666', source: 'observed', coverage: 0 },
    { role: 'text-on-accent', hex: 'FFFFFF', source: 'observed', coverage: 0 },
    { role: 'accent', hex: '3355E0', source: 'observed', coverage: 0 },
    { role: 'line', hex: 'CCCCCC', source: 'observed', coverage: 0 },
    { role: 'negative', hex: 'CC3333', source: 'observed', coverage: 0 },
  ],
  typeScale: [
    {
      role: 'body',
      font: 'Deck Face',
      sizePt: 16,
      bold: false,
      italic: false,
      lineSpacing: 1.3,
      colorRole: 'text',
      source: 'observed',
    },
    {
      role: 'caption',
      font: 'Deck Face',
      sizePt: 12,
      bold: false,
      italic: false,
      lineSpacing: 1.2,
      colorRole: 'text-muted',
      source: 'observed',
    },
    {
      role: 'bullet',
      font: 'Deck Face',
      sizePt: 16,
      bold: false,
      italic: false,
      lineSpacing: 1.3,
      colorRole: 'text',
      source: 'observed',
    },
  ],
  grid: {
    slideCx: WIDE.cx,
    slideCy: WIDE.cy,
    marginLeft: 0,
    marginRight: 0,
    marginTop: 0,
    marginBottom: 0,
    columns: 12,
    gutter: 0,
    baseline: 12_700,
  },
  assets: [],
  notes: [],
} satisfies DesignSystem;

function render(slide: SlideIr, resolveMedia?: (mediaPart: string) => string | null): string {
  return renderToStaticMarkup(
    <SlideView slide={slide} profile={PROFILE} label="Слайд" resolveMedia={resolveMedia} />,
  );
}

describe('SlideView', () => {
  it('draws the copy in the template face and keeps every word', () => {
    const html = render(COVER);
    expect(html).toContain('data-slide-root="true"');
    expect(html).toContain('Цифровой дизайнер презентаций');
    expect(html).toContain('#FFFFFF');
    expect(html).not.toContain('text-overflow');
    expect(html).not.toContain('line-clamp');
  });

  it('marks overflow without cutting the text', () => {
    const copy = 'Строка остаётся целиком, даже когда рамка её не вмещает';
    const slide: SlideIr = {
      ...COVER,
      elements: [
        {
          ...text('note', 'body', box(48, 40, 200, 24), [paragraph(copy)]),
          overflow: { lines: 2, emu: 20_000 },
        },
      ],
    };
    const html = render(slide);
    expect(html).toContain(copy);
    expect(html).toContain('data-overflow="true"');
    expect(html).toContain('#CC3333');
  });

  it('fits a picture when an address is known and otherwise draws a frame', () => {
    const pictures = render(CONTENT, (part) => `https://cdn.test/${part}`);
    expect(pictures).toContain('https://cdn.test/media/preview.png');
    expect(pictures).toMatch(/object-fit:\s*cover/);

    const logo = render(COVER, (part) => `https://cdn.test/${part}`);
    expect(logo).toContain('https://cdn.test/ppt/media/image1.png');
    expect(logo).toMatch(/object-fit:\s*contain/);

    const framed = render(CONTENT);
    expect(framed).not.toContain('<img');
    expect(framed).toContain('data-kind="image"');
  });

  it('draws table cells, decoration targets and five charts from the palette', () => {
    const html = render(CONTENT);
    expect(html).toContain('Разбор');
    expect(html).toContain('Python');
    expect(html).toContain('Deck Face');
    expect(html).toContain('data-kind="decor"');
    for (const chartType of ['bar', 'column', 'line', 'area', 'pie']) {
      expect(html).toContain(`data-chart-type="${chartType}"`);
    }
    expect(html).toContain('<rect');
    expect(html).toContain('<path');
    expect(html).toContain('fill="#111111"');
    expect(html).toContain('fill="#666666"');
    const used = [...html.matchAll(/#([0-9a-fA-F]{6})/g)].map((match) => match[1]?.toUpperCase());
    const allowed = new Set(PROFILE.palette.map((entry) => entry.hex.toUpperCase()));
    for (const hex of used) expect(allowed.has(hex ?? '')).toBe(true);
  });
});
