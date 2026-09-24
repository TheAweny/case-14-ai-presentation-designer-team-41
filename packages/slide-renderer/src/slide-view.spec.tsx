import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DesignSystem, ImageCrop, SlideElement, SlideIr, TextRun } from '@lct/contracts';
import { SlideView } from './slide-view.js';
import { CONTENT, COVER, WIDE, box, measured, paragraph, text } from './testing/deck.js';
import {
  fontFamily,
  genericFamily,
  isHexColor,
  resolveColor,
  seriesPaint,
  seriesRoles,
} from './view/color.js';

const PROFILE = {
  schemaVersion: 1,
  templateHash: 'a'.repeat(64),
  aspect: '16:9',
  palette: [
    { role: 'background', hex: 'FFFFFF', meta: measured('observed', 1) },
    { role: 'surface', hex: 'EEEEEE', meta: measured('observed', 0) },
    { role: 'text', hex: '111111', meta: measured('observed', 0) },
    { role: 'text-muted', hex: '666666', meta: measured('observed', 0) },
    { role: 'text-on-accent', hex: 'FFFFFF', meta: measured('observed', 0) },
    { role: 'accent', hex: '3355E0', meta: measured('observed', 0) },
    { role: 'line', hex: 'CCCCCC', meta: measured('observed', 0) },
    { role: 'negative', hex: 'CC3333', meta: measured('observed', 0) },
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
      meta: measured('observed'),
    },
    {
      role: 'caption',
      font: 'Deck Face',
      sizePt: 12,
      bold: false,
      italic: false,
      lineSpacing: 1.2,
      colorRole: 'text-muted',
      meta: measured('observed'),
    },
    {
      role: 'bullet',
      font: 'Deck Face',
      sizePt: 16,
      bold: false,
      italic: false,
      lineSpacing: 1.3,
      colorRole: 'text',
      meta: measured('observed'),
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
    meta: measured('fallback'),
  },
  surfaces: [
    { tone: 'light', background: 'FFFFFF', text: '111111', accent: '3355E0', meta: measured() },
  ],
  typeFamilies: [{ role: 'primary', font: 'Deck Face', declared: 'Deck Face', meta: measured() }],
  strokes: [],
  radii: [],
  shadows: { present: false, meta: measured() },
  protectedZones: [],
  warnings: [],
} satisfies DesignSystem;

function render(
  slide: SlideIr,
  resolveMedia?: (mediaPart: string) => string | null,
  thumbnail?: boolean,
): string {
  return renderToStaticMarkup(
    <SlideView
      slide={slide}
      profile={PROFILE}
      label="Слайд"
      resolveMedia={resolveMedia}
      thumbnail={thumbnail}
    />,
  );
}

function only(slide: SlideIr, ...elements: SlideElement[]): SlideIr {
  return { ...slide, elements };
}

function openTag(html: string, id: string): string {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<div\\b(?=[^>]*data-element-id="${escaped}")[^>]*>`).exec(html)?.[0] ?? '';
}

/** The markup of one element: from its opening tag up to the next element. */
function markup(html: string, id: string): string {
  const start = html.indexOf(`data-element-id="${id}"`);
  if (start < 0) return '';
  const next = html.indexOf('data-element-id="', start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}

type Decor = Extract<SlideElement, { kind: 'decor' }>;

function shape(elementId: string, frame: ReturnType<typeof box>, look: Partial<Decor>): Decor {
  return {
    kind: 'decor',
    elementId,
    role: 'decoration',
    box: frame,
    sourceShapeId: null,
    ...look,
  };
}

const STROKE = {
  color: 'accent',
  widthEmu: 25_400,
  dash: 'solid',
  head: 'none',
  tail: 'none',
} as const;

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
    // Series take the accent first, then the next mark colour; never the colour of body text.
    const columns = markup(html, 'content-chart-column');
    expect(columns).toContain('fill="#3355E0"');
    expect(columns).toContain('fill="#CC3333"');
    expect(columns).not.toContain('fill="#111111"');
    expect(html).toContain('fill="#666666"');
    const used = [...html.matchAll(/#([0-9a-fA-F]{6})/g)].map((match) => match[1]?.toUpperCase());
    const allowed = new Set(PROFILE.palette.map((entry) => entry.hex.toUpperCase()));
    for (const hex of used) expect(allowed.has(hex ?? '')).toBe(true);
  });
});

describe('thumbnail', () => {
  const slide: SlideIr = {
    ...CONTENT,
    elements: [
      ...CONTENT.elements,
      {
        ...text('late', 'body', box(48, 40, 200, 24), [paragraph('Не влезает')]),
        overflow: { lines: 2, emu: 20_000 },
      },
      shape('arrow', box(80, 80, 200, 100), {
        shape: 'line',
        fill: null,
        stroke: { ...STROKE, tail: 'arrow' },
      }),
    ],
  };

  it('draws the same slide without hooks, overflow marks or pointer', () => {
    const html = render(slide, undefined, true);
    expect(html).toContain('Все виды элементов на одном слайде');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/pointer-events:\s*none/);
    for (const hook of [
      'data-element-id',
      'data-slide-root',
      'data-slide-id',
      'data-kind',
      'data-role',
      'data-overflow',
      'data-chart-type',
      'data-shape',
      'aria-label',
      'pointer-events="stroke"',
    ]) {
      expect(html).not.toContain(hook);
    }
  });

  it('keeps the hooks the canvas looks elements up by when it is not a thumbnail', () => {
    const html = render(slide);
    expect(html).toContain('data-slide-root="true"');
    expect(html).toContain(`data-slide-id="${CONTENT.slideId}"`);
    expect(html).toContain('aria-label="Слайд"');
    expect(html).toContain('data-element-id="content-title"');
    expect(html).toContain('data-kind="text"');
    expect(html).toContain('data-overflow="true"');
    expect(html).not.toMatch(/pointer-events:\s*none/);
  });
});

describe('past the slide edge', () => {
  const outside = only(CONTENT, shape('bleed', box(-100, 400, 300, 200), { shape: 'rect' }));
  const frameTag = (html: string) => /<div\b[^>]*>/.exec(html)?.[0] ?? '';

  it('cuts off what lies outside the slide by default, as the export does', () => {
    expect(frameTag(render(outside))).toMatch(/overflow:\s*hidden/);
  });

  it('shows it on an editor canvas that asks for the pasteboard', () => {
    const html = renderToStaticMarkup(
      <SlideView slide={outside} profile={PROFILE} label="Слайд" showOutside />,
    );
    expect(frameTag(html)).toMatch(/overflow:\s*visible/);
    expect(html).toContain('data-element-id="bleed"');
  });

  it('keeps the slide background behind an element that reaches past the edge', () => {
    const inside = shape('inside', box(100, 100, 50, 50), { shape: 'rect' });
    const html = renderToStaticMarkup(
      <SlideView
        slide={{ ...outside, elements: [...outside.elements, inside] }}
        profile={PROFILE}
        showOutside
      />,
    );
    expect(html.match(/data-outside-backdrop/g)).toHaveLength(1);
    expect(render(outside)).not.toContain('data-outside-backdrop');
  });

  it('keeps a thumbnail cut even when asked to show the outside', () => {
    const html = renderToStaticMarkup(
      <SlideView slide={outside} profile={PROFILE} thumbnail showOutside />,
    );
    expect(frameTag(html)).toMatch(/overflow:\s*hidden/);
  });
});

describe('shapes', () => {
  const card = box(80, 80, 320, 180);
  const small = box(80, 80, 40, 20);

  it('fills a shape with its own role at any size, where template decor guesses', () => {
    const smallHtml = render(only(COVER, shape('mark', small, { shape: 'rect', fill: 'accent' })));
    const largeHtml = render(only(COVER, shape('mark', card, { shape: 'rect', fill: 'accent' })));
    expect(markup(smallHtml, 'mark')).toContain('fill="#3355E0"');
    expect(markup(largeHtml, 'mark')).toContain('fill="#3355E0"');
    expect(openTag(largeHtml, 'mark')).toContain('data-shape="rect"');

    // The same boxes without a look of their own flip between accent and surface by area.
    const guessedSmall = render(only(COVER, shape('mark', small, { sourceShapeId: 7 })));
    const guessedLarge = render(only(COVER, shape('mark', card, { sourceShapeId: 7 })));
    expect(openTag(guessedSmall, 'mark')).toContain('background:#3355E0');
    expect(openTag(guessedLarge, 'mark')).toContain('background:#EEEEEE');
    expect(openTag(guessedLarge, 'mark')).not.toContain('data-shape');
    expect(guessedLarge).not.toContain('<svg');
  });

  it('draws each geometry, outline and corner from its fields', () => {
    const html = render(
      only(
        COVER,
        shape('round', card, {
          shape: 'round-rect',
          fill: 'surface',
          stroke: { ...STROKE, dash: 'dash' },
          cornerRadius: 0.25,
        }),
        shape('oval', card, { shape: 'ellipse', fill: null, stroke: STROKE }),
        shape('tri', card, { shape: 'triangle', fill: 'negative', stroke: null }),
        shape('gem', card, { shape: 'diamond', fill: 'accent' }),
      ),
    );
    const round = markup(html, 'round');
    // A quarter of the shorter side, 180 pt; a 2 pt line dashed at 4:3 of its width.
    expect(round).toContain('rx="45"');
    expect(round).toContain('fill="#EEEEEE"');
    expect(round).toContain('stroke="#3355E0"');
    expect(round).toContain('stroke-width="2"');
    expect(round).toContain('stroke-dasharray="8 6"');
    expect(round).toContain('viewBox="0 0 320 180"');
    expect(round).toContain('preserveAspectRatio="none"');

    const oval = markup(html, 'oval');
    expect(oval).toContain('<ellipse');
    expect(oval).toContain('fill="none"');
    expect(oval).not.toContain('stroke-dasharray');

    const tri = markup(html, 'tri');
    expect(tri).toContain('points="160,0 320,180 0,180"');
    expect(tri).toContain('fill="#CC3333"');
    expect(tri).not.toContain('stroke=');
    expect(markup(html, 'gem')).toContain('points="160,0 320,90 160,180 0,90"');

    const used = [...html.matchAll(/#([0-9a-fA-F]{6})/g)].map((match) => match[1]);
    for (const hex of used) {
      expect(PROFILE.palette.some((entry) => entry.hex === hex)).toBe(true);
    }
  });

  it('paints a hex a user chose in the fill and the outline, next to roles', () => {
    const html = render(
      only(
        COVER,
        shape('own', card, {
          shape: 'rect',
          fill: '12ab9F',
          stroke: { ...STROKE, color: '0A0B0C' },
        }),
        shape('mixed', card, {
          shape: 'ellipse',
          fill: 'accent',
          stroke: { ...STROKE, color: 'FF8800' },
        }),
        shape('wire', card, { shape: 'line', fill: null, stroke: { ...STROKE, color: 'abcdef' } }),
      ),
    );
    const own = markup(html, 'own');
    expect(own).toContain('fill="#12ab9F"');
    expect(own).toContain('stroke="#0A0B0C"');
    const mixed = markup(html, 'mixed');
    expect(mixed).toContain('fill="#3355E0"');
    expect(mixed).toContain('stroke="#FF8800"');
    expect(markup(html, 'wire')).toMatch(/<line [^>]*stroke="#abcdef"/);
  });

  it('flips a triangle upside down about its box', () => {
    const html = render(
      only(COVER, shape('down', card, { shape: 'triangle', fill: 'accent', flipV: true })),
    );
    expect(markup(html, 'down')).toContain('transform="translate(0 180) scale(1 -1)"');
  });

  it('runs a line corner to corner, flips it and puts the arrow on the tail', () => {
    const html = render(
      only(
        COVER,
        shape('down', card, { shape: 'line', fill: null, stroke: STROKE }),
        shape('back', card, {
          shape: 'line',
          fill: null,
          stroke: { ...STROKE, tail: 'arrow' },
          flipH: true,
        }),
        shape('rule', box(80, 80, 320, 0), { shape: 'line', stroke: { ...STROKE, dash: 'dot' } }),
      ),
    );
    const down = markup(html, 'down');
    expect(down).toMatch(/<line x1="0" y1="0" x2="320" y2="180" stroke="#3355E0"/);
    expect(down).not.toContain('<polygon');

    // Drawn from right to left: it starts at the top right and the head points at the bottom left.
    const back = markup(html, 'back');
    expect(back).toMatch(/<line x1="320" y1="0" x2="\d/);
    expect(back).toContain('<polygon points="0,180 ');
    expect(back).toContain('pointer-events="stroke"');

    const rule = markup(html, 'rule');
    expect(rule).toContain('stroke-dasharray="2 2"');
    expect(openTag(html, 'rule')).toContain('height:0.12cqw');
  });
});

describe('words in a shape', () => {
  const card = box(80, 80, 320, 180);
  const words = [paragraph('Шаг 1', { sizePt: null })];

  it('centres the words both ways, in body type, in the colour that reads on the fill', () => {
    const html = render(
      only(
        COVER,
        shape('badge', card, { shape: 'rect', fill: 'accent', stroke: null, paragraphs: words }),
        shape('card', card, { shape: 'rect', fill: 'surface', stroke: null, paragraphs: words }),
      ),
    );
    const badge = markup(html, 'badge');
    expect(badge).toContain('data-shape-text');
    expect(badge).toContain('Шаг 1');
    expect(badge).toContain('justify-content:center');
    expect(badge).toContain('text-align:center');
    // 16 pt of body type on a 960 pt slide.
    expect(badge).toContain('font-size:1.6667cqw');
    // White on the blue accent, dark body text on the light card.
    expect(badge).toContain('color:#FFFFFF');
    expect(markup(html, 'card')).toContain('color:#111111');
    // The default insets: 0.1 inch across a 960 pt slide.
    expect(badge).toContain('padding-left:0.75cqw');
  });

  it('anchors the words where the shape says and leaves a shape without words alone', () => {
    const html = render(
      only(
        COVER,
        shape('top', card, {
          shape: 'ellipse',
          fill: null,
          paragraphs: words,
          verticalAlign: 'top',
          textInsets: { l: 0, t: 0, r: 0, b: 0 },
        }),
        shape('empty', card, { shape: 'rect', fill: 'accent' }),
      ),
    );
    expect(markup(html, 'top')).toContain('justify-content:flex-start');
    expect(markup(html, 'top')).toContain('padding-left:0cqw');
    // No fill: the slide shows through, so the words are body text.
    expect(markup(html, 'top')).toContain('color:#111111');
    expect(markup(html, 'empty')).not.toContain('data-shape-text');
  });

  it('never puts words on a line', () => {
    const html = render(
      only(
        COVER,
        shape('rule', box(80, 80, 320, 0), { shape: 'line', stroke: STROKE, paragraphs: words }),
      ),
    );
    expect(markup(html, 'rule')).not.toContain('Шаг 1');
  });
});

describe('cropped pictures', () => {
  const picture = (crop?: ImageCrop) =>
    ({
      kind: 'image',
      elementId: 'photo',
      role: 'image',
      box: box(100, 100, 400, 200),
      sourceShapeId: null,
      mediaPart: 'upload/photo.png',
      fit: 'cover',
      ...(crop ? { crop } : null),
    }) satisfies SlideElement;

  it('stretches what the crop leaves over the box, the rest hanging outside', () => {
    const html = render(
      only(COVER, picture({ l: 0.2, t: 0, r: 0.3, b: 0.5 })),
      (part) => `/m/${part}`,
    );
    const photo = markup(html, 'photo');
    // Half the width is left, so the whole picture is twice the box, shifted by 0.2 / 0.5 of it.
    expect(photo).toContain('width:200%');
    expect(photo).toContain('left:-40%');
    expect(photo).toContain('height:200%');
    expect(photo).toContain('top:0%');
    expect(photo).toContain('object-fit:fill');
  });

  it('places an uncropped picture by fit, and ignores a crop that leaves nothing', () => {
    const plain = markup(
      render(only(COVER, picture()), (part) => `/m/${part}`),
      'photo',
    );
    expect(plain).toContain('object-fit:cover');
    const gone = markup(
      render(only(COVER, picture({ l: 0.6, t: 0, r: 0.4, b: 0 })), (part) => `/m/${part}`),
      'photo',
    );
    expect(gone).toContain('object-fit:cover');
  });
});

describe('look shared by every kind', () => {
  it('rotates about the centre and fades, and leaves an unrotated element alone', () => {
    const turned = {
      ...text('turned', 'body', box(48, 40, 200, 24), [paragraph('Поворот')]),
      rotation: 30,
      opacity: 0.5,
    };
    const plain = text('plain', 'body', box(48, 80, 200, 24), [paragraph('Прямо')]);
    const picture: SlideElement = {
      kind: 'image',
      elementId: 'picture',
      role: 'image',
      box: box(300, 80, 200, 100),
      sourceShapeId: null,
      mediaPart: 'upload/picture.png',
      fit: 'cover',
      rotation: 90,
    };
    const html = render(only(COVER, turned, plain, picture));
    expect(openTag(html, 'turned')).toContain('transform:rotate(30deg)');
    expect(openTag(html, 'turned')).toContain('opacity:0.5');
    expect(openTag(html, 'picture')).toContain('transform:rotate(90deg)');
    expect(openTag(html, 'plain')).not.toContain('transform');
    expect(openTag(html, 'plain')).not.toContain('opacity');
  });

  it('marks a locked element for the editor', () => {
    const html = render(
      only(COVER, shape('panel', box(0, 0, 960, 540), { sourceShapeId: 3, locked: true })),
    );
    expect(openTag(html, 'panel')).toContain('data-locked="true"');
    expect(openTag(render(COVER), 'cover-panel')).not.toContain('data-locked');
  });

  it('fills the slide with its background role, and with the template background otherwise', () => {
    const root = /<div[^>]*data-slide-root="true"[^>]*>/;
    expect(root.exec(render({ ...COVER, background: 'accent' }))?.[0]).toContain(
      'background:#3355E0',
    );
    expect(root.exec(render({ ...COVER, background: null }))?.[0]).toContain('background:#FFFFFF');
    expect(root.exec(render(COVER))?.[0]).toContain('background:#FFFFFF');
    expect(root.exec(render({ ...COVER, background: '1E2A3B' }))?.[0]).toContain(
      'background:#1E2A3B',
    );
  });
});

describe('text look', () => {
  it('aligns paragraphs, anchors the box and underlines runs', () => {
    const element: SlideElement = {
      ...text('note', 'body', box(48, 40, 400, 200), [
        { ...paragraph('По центру'), align: 'center' },
        { ...paragraph('Как у шаблона'), align: null },
        {
          level: 0,
          align: 'justify',
          lineSpacing: null,
          runs: [
            {
              text: 'Подчёркнуто',
              font: '',
              sizePt: 16,
              bold: null,
              italic: null,
              underline: true,
              color: '',
            },
          ],
        },
      ]),
      verticalAlign: 'bottom',
    };
    const html = render(only(COVER, element));
    expect(openTag(html, 'note')).toContain('justify-content:flex-end');
    expect(html).toContain('text-align:center');
    expect(html).toContain('text-align:justify');
    expect(html.match(/text-align:/g)).toHaveLength(2);
    expect(html.match(/text-decoration:underline/g)).toHaveLength(1);
  });
});

describe('text spacing and face', () => {
  function run(text: string, look: Partial<TextRun>): TextRun {
    return { text, font: '', sizePt: 16, bold: null, italic: null, color: '', ...look };
  }

  it('sets a stated line spacing over the type role and inherits it otherwise', () => {
    const element = text('spaced', 'body', box(48, 40, 400, 200), [
      { ...paragraph('Разреженно'), lineSpacing: 2 },
      paragraph('Как у роли'),
    ]);
    const html = render(only(COVER, element));
    expect(html.match(/line-height:2[;"]/g)).toHaveLength(1);
    expect(html.match(/line-height:1.3[;"]/g)).toHaveLength(1);
  });

  it('tracks a run in cqw of the slide width, as its size, and leaves the rest alone', () => {
    const element = text('tracked', 'body', box(48, 40, 400, 200), [
      {
        level: 0,
        lineSpacing: null,
        runs: [
          run('Вразрядку', { letterSpacingPt: 9.6 }),
          run('Плотно', { letterSpacingPt: -4.8 }),
          run('Обычно', { letterSpacingPt: null }),
          run('Ноль', { letterSpacingPt: 0 }),
        ],
      },
    ]);
    const html = render(only(COVER, element));
    // 9.6 pt of a 960 pt slide is 1 % of its width.
    expect(html).toContain('letter-spacing:1cqw');
    expect(html).toContain('letter-spacing:-0.5cqw');
    expect(html.match(/letter-spacing:/g)).toHaveLength(2);
  });

  it('draws a run in the face it names and the type role face otherwise', () => {
    const element = text('faces', 'body', box(48, 40, 400, 200), [
      {
        level: 0,
        lineSpacing: null,
        runs: [run('Своим', { font: 'PT Serif' }), run('Шаблонным', { font: '' })],
      },
    ]);
    const html = render(only(COVER, element));
    expect(html).toContain('font-family:&quot;PT Serif&quot;, serif');
    expect(html).toContain('font-family:&quot;Deck Face&quot;, sans-serif');
  });
});

describe('resolveColor', () => {
  it('passes a hex through and looks a role up in the palette', () => {
    expect(resolveColor(PROFILE.palette, '0a0B0c')).toBe('#0a0B0c');
    expect(resolveColor(PROFILE.palette, 'accent')).toBe('#3355E0');
    // A role the palette lacks takes the fallback, then the first entry.
    expect(resolveColor(PROFILE.palette, 'positive', 'negative')).toBe('#CC3333');
    expect(resolveColor(PROFILE.palette, 'accent-alt')).toBe('#FFFFFF');
  });

  it('tells a hex from a role and from anything else', () => {
    expect(isHexColor('A1b2C3')).toBe(true);
    expect(isHexColor('accent')).toBe(false);
    expect(isHexColor('#A1B2C3')).toBe(false);
    expect(isHexColor('ABC')).toBe(false);
    expect(isHexColor('A1B2C3D4')).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(0xa1b2c3)).toBe(false);
  });
});

describe('palette order for series', () => {
  it('starts with the accent whatever order the palette is listed in', () => {
    const reversed = [...PROFILE.palette].reverse();
    expect(seriesRoles(reversed)).toEqual(['accent', 'negative', 'text', 'text-muted']);
    expect(seriesPaint(reversed, 0)).toBe('#3355E0');
    expect(seriesPaint(reversed, 1)).toBe('#CC3333');
    expect(seriesPaint(reversed, 4)).toBe('#3355E0');
  });

  it('ranks the alternate accent and the signal colours ahead of type colours', () => {
    const full = [
      ...PROFILE.palette,
      { role: 'accent-alt', hex: '14A085', meta: measured('theme', 0) },
      { role: 'positive', hex: '2E9E5B', meta: measured('theme', 0) },
    ] satisfies DesignSystem['palette'];
    expect(seriesRoles(full)).toEqual([
      'accent',
      'accent-alt',
      'positive',
      'negative',
      'text',
      'text-muted',
    ]);
  });
});

describe('fontFamily', () => {
  it('adds the generic family, so a missing face does not fall back to a serif', () => {
    expect(fontFamily('Inter')).toBe('"Inter", sans-serif');
    expect(fontFamily(' PT Serif ')).toBe('"PT Serif", serif');
    expect(fontFamily('Noto Sans')).toBe('"Noto Sans", sans-serif');
    expect(fontFamily('Times New Roman')).toBe('"Times New Roman", serif');
    expect(fontFamily('JetBrains Mono')).toBe('"JetBrains Mono", monospace');
    expect(fontFamily('Say "hi"')).toBe('"Say hi", sans-serif');
    expect(fontFamily('')).toBeUndefined();
    expect(genericFamily('Georgia')).toBe('serif');
    expect(render(CONTENT)).toContain('font-family:&quot;Deck Face&quot;, sans-serif');
  });
});
