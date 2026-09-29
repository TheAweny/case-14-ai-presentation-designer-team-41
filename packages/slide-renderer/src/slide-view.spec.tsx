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

  it('prints every value on its mark and names each pie slice with its share', () => {
    const html = render(CONTENT);
    for (const chartType of ['bar', 'column', 'line']) {
      const chart = markup(html, `content-chart-${chartType}`);
      for (const value of [20, 40, 30, 10, 25, 35]) expect(chart).toContain(`>${value}<`);
    }
    const pie = markup(html, 'content-chart-pie');
    expect(pie).toContain('>А<');
    expect(pie).toContain('20 · 22%');
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

  it('lays the patch under a background picture, which hides it inside the slide', () => {
    const html = renderToStaticMarkup(
      <SlideView
        slide={{ ...outside, backgroundImage: '/ppt/media/image1.png' }}
        profile={PROFILE}
        resolveMedia={() => '/media/1.png'}
        showOutside
      />,
    );
    expect(html.indexOf('data-outside-backdrop')).toBeLessThan(
      html.indexOf('data-slide-background'),
    );
  });

  it('keeps a thumbnail cut even when asked to show the outside', () => {
    const html = renderToStaticMarkup(
      <SlideView slide={outside} profile={PROFILE} thumbnail showOutside />,
    );
    expect(frameTag(html)).toMatch(/overflow:\s*hidden/);
  });
});

describe('prompt in an empty text box', () => {
  const empty = text('slot', 'body', box(40, 40, 400, 80), [
    { level: 0, runs: [], lineSpacing: null },
  ]);
  const blank = text('blank', 'body', box(40, 160, 400, 80), [paragraph('  ', { sizePt: 28 })]);
  const written = text('written', 'body', box(40, 280, 400, 80), [paragraph('Выручка')]);
  const slide = only(CONTENT, empty, blank, written);
  const prompts = (html: string) => html.match(/data-empty-prompt/g)?.length ?? 0;

  it('shows the prompt the host gives, faded and outlined, in the style of the box', () => {
    const html = renderToStaticMarkup(
      <SlideView slide={slide} profile={PROFILE} emptyText={() => 'Текст'} />,
    );
    expect(prompts(html)).toBe(2);
    expect(markup(html, 'slot')).toContain('Текст');
    expect(openTag(html, 'slot')).toMatch(/outline:\s*1px dashed/);
    expect(markup(html, 'slot')).toMatch(/opacity:\s*0\.45/);
    expect(markup(html, 'blank')).toContain('Текст');
    expect(markup(html, 'written')).not.toContain('data-empty-prompt');
    expect(markup(html, 'written')).toContain('Выручка');
  });

  it('draws no prompt where the host gives none, or when nobody asks for one', () => {
    const none = renderToStaticMarkup(
      <SlideView
        slide={slide}
        profile={PROFILE}
        emptyText={(element) => (element.elementId === 'slot' ? 'Текст' : null)}
      />,
    );
    expect(prompts(none)).toBe(1);
    expect(markup(none, 'blank')).not.toContain('Текст');
    expect(prompts(render(slide))).toBe(0);
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
    // Multiples of single spacing, which PowerPoint sets at 1.2 of the size: 2 and the role's 1.3.
    expect(html.match(/line-height:2.4[;"]/g)).toHaveLength(1);
    expect(html.match(/line-height:1.56[;"]/g)).toHaveLength(1);
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

describe('a slide read back from its .pptx', () => {
  const card = box(80, 80, 320, 180);
  /** A chevron in the space of its own box, 1000 by 500, as the engine answers a preset. */
  const chevron = {
    width: 1000,
    height: 500,
    paths: [{ d: 'M0 0 L700 0 L1000 250 L700 500 L0 500 L300 250 Z', filled: true, stroked: true }],
  };

  it('paints the slide with its picture over the colour and under every element', () => {
    const painted = only(COVER, text('t', 'title', card, [paragraph('Заголовок')]));
    const withPicture: SlideIr = {
      ...painted,
      background: 'accent',
      backgroundImage: '/ppt/media/image5.png',
    };
    const html = render(withPicture, (part) =>
      part.endsWith('image5.png') ? '/media/5.png' : null,
    );
    expect(html).toContain('background:#3355E0');
    const picture = /<img\b[^>]*data-slide-background[^>]*>/.exec(html)?.[0] ?? '';
    expect(picture).toContain('src="/media/5.png"');
    expect(picture).toContain('object-fit:fill');
    expect(picture).toContain('inset:0');
    expect(picture).toContain('pointer-events:none');
    expect(html.indexOf('data-slide-background')).toBeLessThan(html.indexOf('data-element-id'));

    // The same picture in a miniature, without the hook; and no picture without an address.
    const thumbnail = render(withPicture, () => '/media/5.png', true);
    expect(thumbnail).toMatch(/<img\b[^>]*src="\/media\/5.png"/);
    expect(thumbnail).not.toContain('data-slide-background');
    expect(render(withPicture, () => null)).not.toContain('<img');
    expect(render(painted, () => '/media/5.png')).not.toContain('<img');
  });

  it('draws an outline no shape names, stretched over the box with a true line width', () => {
    const html = render(
      only(
        COVER,
        shape('arrow', card, {
          geometry: chevron,
          fill: null,
          stroke: { ...STROKE, dash: 'dash' },
        }),
        shape('panel', card, { geometry: chevron, fill: 'accent', stroke: null, flipH: true }),
      ),
    );
    const arrow = markup(html, 'arrow');
    expect(openTag(html, 'arrow')).toContain('data-shape="custom"');
    expect(arrow).toContain('viewBox="0 0 1000 500"');
    expect(arrow).toContain('preserveAspectRatio="none"');
    expect(arrow).toContain('d="M0 0 L700 0 L1000 250 L700 500 L0 500 L300 250 Z"');
    expect(arrow).toContain('fill="none"');
    expect(arrow).toContain('stroke:#3355E0');
    // 2 pt of a 960 pt slide, whatever the stretch of the drawing; dashed 4:3 of that width.
    expect(arrow).toContain('stroke-width:0.2083cqw');
    expect(arrow).toContain('vector-effect:non-scaling-stroke');
    expect(arrow).toContain('stroke-dasharray:0.8333cqw 0.625cqw');
    expect(arrow).not.toContain('<rect');

    const panel = markup(html, 'panel');
    expect(panel).toContain('fill="#3355E0"');
    expect(panel).not.toContain('stroke:');
    expect(panel).toContain('transform="translate(1000 0) scale(-1 1)"');
  });

  it('keeps a path OOXML draws without its fill or without its outline that way', () => {
    const html = render(
      only(
        COVER,
        shape('open', card, {
          geometry: {
            width: 10,
            height: 10,
            paths: [
              { d: 'M0 0 L10 0 L10 10 Z', filled: true, stroked: false },
              { d: 'M0 10 L10 0', filled: false, stroked: true },
            ],
          },
          fill: 'surface',
          stroke: STROKE,
        }),
      ),
    );
    const paths = markup(html, 'open').match(/<path\b[^>]*>/g) ?? [];
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('fill="#EEEEEE"');
    expect(paths[0]).not.toContain('stroke');
    expect(paths[1]).toContain('fill="none"');
    expect(paths[1]).toContain('stroke:#3355E0');
  });

  it('writes the words of an outline in what their runs state over the profile', () => {
    const html = render(
      only(
        COVER,
        shape('label', card, {
          geometry: chevron,
          fill: 'accent',
          paragraphs: [
            {
              level: 0,
              align: 'left',
              lineSpacing: null,
              runs: [
                {
                  text: 'Факты',
                  font: 'Open Sans',
                  sizePt: 24,
                  bold: true,
                  italic: null,
                  underline: true,
                  color: 'E6007E',
                },
              ],
            },
          ],
        }),
      ),
    );
    const label = markup(html, 'label');
    expect(label).toContain('data-shape-text');
    expect(label).toContain('text-align:left');
    expect(label).toMatch(/<span style="[^"]*font-family:&quot;Open Sans&quot;/);
    expect(label).toContain('font-size:2.5cqw');
    expect(label).toContain('font-weight:700');
    expect(label).toContain('text-decoration:underline');
    // The run's own pink, not the white that reads on the accent.
    expect(label).toContain('color:#E6007E');
  });

  it('pads a text box by its insets and leaves one that states none alone', () => {
    const html = render(
      only(
        COVER,
        {
          ...text('inset', 'body', card, [paragraph('С отступом')]),
          textInsets: { l: 91_440, t: 45_720, r: 91_440, b: 0 },
        },
        text('flush', 'body', box(80, 300, 320, 100), [paragraph('Без отступа')]),
      ),
    );
    const inset = openTag(html, 'inset');
    expect(inset).toContain('box-sizing:border-box');
    expect(inset).toContain('padding-left:0.75cqw');
    expect(inset).toContain('padding-top:0.375cqw');
    expect(inset).toContain('padding-right:0.75cqw');
    expect(inset).toContain('padding-bottom:0cqw');
    expect(openTag(html, 'flush')).not.toContain('padding');
  });

  it('hangs a stated bullet in the indent and spaces paragraphs as they say', () => {
    const bulleted = {
      ...paragraph('Оставляем только ключевые факты'),
      bullet: '•',
      marginEmu: 228_600,
      indentEmu: -228_600,
      spaceBeforePt: 6,
      spaceAfterPt: 12,
    };
    const pink = paragraph('И выводы').runs.map((run) => ({ ...run, color: 'E6007E' }));
    const html = render(
      only(
        COVER,
        text('list', 'body', card, [
          bulleted,
          { ...bulleted, runs: pink },
          { ...paragraph('Без маркера'), indentEmu: 127_000 },
        ]),
      ),
    );
    const list = markup(html, 'list');
    const bullets = list.match(/<span[^>]*data-bullet=""[^>]*>[^<]*<\/span>/g) ?? [];
    expect(bullets).toHaveLength(2);
    // The bullet starts 18 pt left of the margin and takes that space; the text starts at it.
    expect(bullets[0]).toContain('margin-left:-1.875cqw');
    expect(bullets[0]).toContain('width:1.875cqw');
    expect(bullets[0]).toContain('>•<');
    expect(bullets[1]).toContain('color:#E6007E');
    expect(list.match(/padding-left:1.875cqw/g)).toHaveLength(2);
    // No space before the first paragraph, as PowerPoint draws it; 6 pt before the second.
    expect(list).toContain('margin-top:0;margin-bottom:1.25cqw');
    expect(list).toContain('margin-top:0.625cqw;margin-bottom:1.25cqw');
    // A paragraph without a bullet indents its first line, with no bullet and no gap of its own.
    expect(list).toContain('text-indent:1.0417cqw');
    expect(list).toContain('margin-top:0;margin-bottom:0');
  });

  it('keeps its own gaps and dots for text that states no paragraph layout', () => {
    const html = render(
      only(
        COVER,
        text('plain', 'bullet-list', card, [paragraph('Один'), paragraph('Два', { level: 1 })]),
      ),
    );
    const plain = markup(html, 'plain');
    expect(plain).not.toContain('data-bullet');
    expect(plain).toContain('border-radius:50%');
    expect(plain).toContain('margin-top:0.35em');
    expect(plain).toContain('padding-left:1.5em');
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
