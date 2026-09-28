import { describe, expect, it } from 'vitest';
import type { TemplateIr } from '@lct/contracts';
import { templateLayoutsFromIr, templateSlideFromIr } from './template-profile';

const ir = {
  schemaVersion: 1 as const,
  sourceName: 'Шаблон.pptx',
  slideCx: 1000,
  slideCy: 600,
  aspect: '5:3',
  hash: 'a'.repeat(64),
  themeColors: [],
  themeFonts: { majorLatin: 'Play', minorLatin: 'Play' },
  masters: [],
  layouts: [
    {
      part: '/ppt/slideLayouts/slideLayout1.xml',
      name: 'Титульный',
      follows: '',
      shapes: [
        {
          shapeId: 1,
          name: 'Title',
          kind: 'text-box',
          box: { x: 10, y: 20, cx: 500, cy: 100 },
          rotation: 0,
          flipH: false,
          flipV: false,
          z: 0,
          path: [],
          placeholder: { type: 'title', idx: 0 },
          paragraphs: [
            {
              level: 0,
              align: 'left',
              lineSpacing: null,
              runs: [
                {
                  text: 'Заголовок',
                  font: 'Play',
                  sizePt: 30,
                  bold: true,
                  italic: false,
                  color: '111111',
                },
              ],
            },
          ],
          mediaPart: '',
          tableSize: null,
          chartPart: '',
          chartType: '',
          fill: null,
          stroke: null,
          geometry: 'rect',
          cornerRadiusEmu: null,
          hasShadow: false,
        },
      ],
      background: null,
      theme: '',
      colorMap: [],
    },
  ],
  slides: [],
  media: [],
  warnings: [],
} as TemplateIr;

describe('templateLayoutsFromIr', () => {
  it('preserves every parsed layout and the text of its non-placeholder shapes', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const caption = { ...layout.shapes[0], placeholder: null };
    const layouts = templateLayoutsFromIr({ ...ir, layouts: [{ ...layout, shapes: [caption] }] });
    expect(layouts).toHaveLength(1);
    expect(layouts[0]?.name).toBe('Титульный');
    expect(layouts[0]?.slide.elements[0]).toMatchObject({
      kind: 'text',
      sourceShapeId: 1,
      paragraphs: [{ runs: [{ text: 'Заголовок', font: 'Play' }] }],
    });
  });

  it('does not silently discard shapes without text', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const shape = {
      ...layout.shapes[0],
      shapeId: 2,
      placeholder: null,
      paragraphs: [],
      mediaPart: '',
    };
    const layouts = templateLayoutsFromIr({ ...ir, layouts: [{ ...layout, shapes: [shape] }] });
    expect(layouts[0]?.slide.elements).toHaveLength(1);
    expect(layouts[0]?.slide.elements[0]).toMatchObject({ kind: 'decor', sourceShapeId: 2 });
  });

  it('merges inherited master decorations before layout elements', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const master = {
      ...layout,
      part: '/ppt/slideMasters/slideMaster1.xml',
      name: 'Master',
      shapes: [
        { ...layout.shapes[0], shapeId: 9, placeholder: null, paragraphs: [], mediaPart: '' },
      ],
    };
    const layouts = templateLayoutsFromIr({
      ...ir,
      masters: [master],
      layouts: [{ ...layout, follows: master.part }],
    });
    expect(layouts[0]?.slide.elements.map((element) => element.sourceShapeId)).toEqual([9, 1]);
  });

  it('uses the first real slide when building the template cover', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const slide = {
      ...layout,
      part: '/ppt/slides/slide1.xml',
      name: 'slide1',
      follows: layout.part,
    };
    const cover = templateSlideFromIr({ ...ir, slides: [slide] });
    expect(cover?.patternId).toBe(layout.part);
    expect(cover?.elements[0]).toMatchObject({ sourceShapeId: 1 });
  });

  it('does not render inherited placeholders over real slide content', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const slide = {
      ...layout,
      part: '/ppt/slides/slide1.xml',
      name: 'slide1',
      follows: layout.part,
      shapes: [
        {
          ...layout.shapes[0],
          shapeId: 2,
          paragraphs: [
            {
              level: 0,
              align: 'left' as const,
              lineSpacing: null,
              runs: [
                {
                  text: 'Готовый заголовок',
                  font: 'Play',
                  sizePt: 30,
                  bold: true,
                  italic: false,
                  color: '111111',
                },
              ],
            },
          ],
        },
      ],
    };

    const rendered = templateSlideFromIr({ ...ir, slides: [slide] });
    expect(rendered?.elements.filter((element) => element.kind === 'text')).toMatchObject([
      { sourceShapeId: 2, paragraphs: [{ runs: [{ text: 'Готовый заголовок' }] }] },
    ]);
  });

  it('keeps inherited non-placeholder decorations on a real slide', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const decoration = {
      ...layout.shapes[0],
      shapeId: 3,
      placeholder: null,
      paragraphs: [],
      mediaPart: '',
    };
    const slide = {
      ...layout,
      part: '/ppt/slides/slide1.xml',
      name: 'slide1',
      follows: layout.part,
      shapes: [],
    };

    const rendered = templateSlideFromIr({
      ...ir,
      layouts: [{ ...layout, shapes: [decoration] }],
      slides: [slide],
    });
    expect(rendered?.elements).toMatchObject([{ kind: 'decor', sourceShapeId: 3 }]);
  });

  it('preserves real slide backgrounds ahead of inherited backgrounds', () => {
    const layout = ir.layouts[0];
    if (!layout) throw new Error('fixture layout is missing');
    const slide = {
      ...layout,
      part: '/ppt/slides/slide1.xml',
      name: 'slide1',
      follows: layout.part,
      shapes: [],
      background: {
        kind: 'solid' as const,
        color: { hex: '123456', scheme: '', transforms: [] as [string, number][] },
        stops: [],
      },
    };

    const rendered = templateSlideFromIr({
      ...ir,
      layouts: [
        {
          ...layout,
          background: {
            kind: 'solid' as const,
            color: { hex: 'abcdef', scheme: '', transforms: [] as [string, number][] },
            stops: [],
          },
        },
      ],
      slides: [slide],
    });
    expect(rendered?.background).toBe('123456');
  });

  it('keeps a layout placeholder as an empty frame with its formatting', () => {
    const layouts = templateLayoutsFromIr(ir);
    expect(layouts[0]?.slide.elements).toMatchObject([
      {
        kind: 'text',
        role: 'title',
        sourceShapeId: 1,
        box: { x: 10, y: 20, cx: 500, cy: 100 },
        paragraphs: [{ runs: [{ text: '', font: 'Play', sizePt: 30, bold: true }] }],
      },
    ]);
  });

  it('resolves a layout background from its master theme and colour map', () => {
    const layout = ir.layouts[0];
    if (!layout) throw new Error('fixture layout is missing');
    const master = {
      ...layout,
      part: '/ppt/slideMasters/slideMaster1.xml',
      theme: '/ppt/theme/theme1.xml',
      colorMap: [['bg1', 'accent1']] as [string, string][],
    };
    const rendered = templateSlideFromIr({
      ...ir,
      themeColors: [{ part: master.theme, name: 'Fixture', slots: [['accent1', '0077FF']] }],
      masters: [master],
      layouts: [
        {
          ...layout,
          follows: master.part,
          background: {
            kind: 'solid',
            color: { hex: '', scheme: 'bg1', transforms: [] },
            stops: [],
          },
        },
      ],
      slides: [
        {
          ...layout,
          part: '/ppt/slides/slide1.xml',
          follows: '/ppt/slideLayouts/slideLayout1.xml',
          shapes: [],
          background: null,
        },
      ],
    });
    expect(rendered?.background).toBe('0077FF');
  });

  it('leaves the colour of inherited text to the renderer on a dark slide', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const master = {
      ...layout,
      part: '/ppt/slideMasters/slideMaster1.xml',
      theme: '/ppt/theme/theme1.xml',
    };
    const slide = {
      ...layout,
      part: '/ppt/slides/slide1.xml',
      follows: layout.part,
      background: {
        kind: 'solid' as const,
        color: { hex: '0077FF', scheme: '', transforms: [] },
        stops: [],
      },
      shapes: [
        {
          ...layout.shapes[0],
          shapeId: 2,
          paragraphs: [
            {
              level: 0,
              align: 'left' as const,
              lineSpacing: null,
              runs: [
                {
                  text: 'Контрастный заголовок',
                  font: '',
                  sizePt: 30,
                  bold: false,
                  italic: false,
                  color: '',
                },
              ],
            },
          ],
        },
      ],
    };
    const rendered = templateSlideFromIr({
      ...ir,
      masters: [master],
      layouts: [{ ...layout, follows: master.part }],
      slides: [slide],
    });
    // A card on a dark slide keeps dark text: painting every run white would lose it on the card.
    expect(rendered?.elements).toMatchObject([
      { kind: 'text', sourceShapeId: 2, paragraphs: [{ runs: [{ color: '' }] }] },
    ]);
  });

  it('draws group children once the parser has resolved their slide coordinates', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const groupChild = {
      ...layout.shapes[0],
      shapeId: 3,
      placeholder: null,
      paragraphs: [],
      path: [2],
      geometry: 'ellipse',
      fill: {
        kind: 'solid' as const,
        color: { hex: '0077FF', scheme: '', transforms: [] },
        stops: [],
      },
    };
    const rendered = templateSlideFromIr({
      ...ir,
      slides: [
        { ...layout, part: '/ppt/slides/slide1.xml', follows: layout.part, shapes: [groupChild] },
      ],
    });
    expect(rendered?.elements).toMatchObject([
      { kind: 'decor', sourceShapeId: 3, shape: 'ellipse', fill: '0077FF' },
    ]);
  });

  it('keeps an empty decorative auto-shape out of the text placeholder flow', () => {
    const layout = ir.layouts[0];
    if (!layout?.shapes[0]) throw new Error('fixture layout is missing');
    const shape = {
      ...layout.shapes[0],
      shapeId: 4,
      placeholder: null,
      paragraphs: [
        {
          level: 0,
          align: null,
          lineSpacing: null,
          runs: [{ text: '', font: '', sizePt: null, bold: null, italic: null, color: '' }],
        },
      ],
      geometry: 'ellipse',
      fill: {
        kind: 'solid' as const,
        color: { hex: 'FF3885', scheme: '', transforms: [] },
        stops: [],
      },
    };
    const rendered = templateSlideFromIr({
      ...ir,
      slides: [
        { ...layout, part: '/ppt/slides/slide1.xml', follows: layout.part, shapes: [shape] },
      ],
    });
    expect(rendered?.elements).toMatchObject([
      { kind: 'decor', sourceShapeId: 4, shape: 'ellipse', fill: 'FF3885' },
    ]);
  });
});

describe('templateLayoutsFromIr on a template with prompt texts', () => {
  const base = ir.layouts[0]?.shapes[0];
  if (!base) throw new Error('fixture layout is missing');
  type FixtureShape = typeof base;

  const run = (text: string, stated: Partial<FixtureShape['paragraphs'][0]['runs'][0]> = {}) => ({
    text,
    font: '',
    sizePt: null,
    bold: null,
    italic: null,
    color: '',
    ...stated,
  });
  const placeholder = (
    shapeId: number,
    type: string,
    idx: number | null,
    box: FixtureShape['box'],
    lines: readonly string[],
    stated: Partial<FixtureShape['paragraphs'][0]['runs'][0]> = {},
  ): FixtureShape => ({
    ...base,
    shapeId,
    name: `${type} ${shapeId}`,
    z: shapeId,
    box,
    placeholder: { type, idx },
    paragraphs: lines.map((line, level) => ({
      level,
      align: null,
      lineSpacing: null,
      runs: line ? [run(line, stated)] : [],
    })),
  });

  // Shaped after what the parser reads out of a real template: the master and its layouts carry
  // the prompts of the authoring tool, the layout title states no position of its own.
  const masterBox = { x: 100, y: 50, cx: 800, cy: 90 };
  const master = {
    ...ir.layouts[0],
    part: '/ppt/slideMasters/slideMaster1.xml',
    name: 'Master',
    follows: '',
    shapes: [
      { ...base, shapeId: 20, z: 0, placeholder: null, paragraphs: [], geometry: 'ellipse' },
      placeholder(2, 'title', 0, masterBox, ['ОБРАЗЕЦ ЗАГОЛОВКА'], {
        font: 'Unbounded',
        sizePt: 40,
      }),
      placeholder(3, 'body', 1, { x: 100, y: 160, cx: 800, cy: 380 }, [
        'Образец текста',
        'Второй уровень',
        'Третий уровень',
        'Четвертый уровень',
        'Пятый уровень',
      ]),
      placeholder(4, 'date', 2, { x: 100, y: 560, cx: 200, cy: 30 }, ['']),
      placeholder(5, 'footer', 3, { x: 350, y: 560, cx: 300, cy: 30 }, ['']),
      placeholder(6, 'slide-number', 4, { x: 700, y: 560, cx: 200, cy: 30 }, ['']),
    ],
  };
  const layout = {
    ...ir.layouts[0],
    part: '/ppt/slideLayouts/slideLayout2.xml',
    name: 'Две колонки',
    follows: master.part,
    shapes: [
      placeholder(2, 'title', 0, null, ['Образец заголовка'], { sizePt: 36 }),
      placeholder(7, 'title', 0, { x: 100, y: 50, cx: 800, cy: 90 }, ['Образец заголовка']),
      placeholder(3, 'body', 1, { x: 100, y: 160, cx: 380, cy: 380 }, ['Образец текста']),
      placeholder(8, 'body', 2, { x: 520, y: 160, cx: 380, cy: 380 }, ['Образец текста']),
      placeholder(4, 'date', 10, { x: 100, y: 560, cx: 200, cy: 30 }, ['']),
      placeholder(5, 'footer', 11, { x: 350, y: 560, cx: 300, cy: 30 }, ['']),
      placeholder(6, 'slide-number', 12, { x: 700, y: 560, cx: 200, cy: 30 }, ['']),
    ],
  };
  const template = { ...ir, masters: [master], layouts: [layout] } as TemplateIr;
  const slide = templateLayoutsFromIr(template)[0]?.slide;
  const texts = slide?.elements.filter((element) => element.kind === 'text') ?? [];

  it('shows no prompt text of the master or the layout', () => {
    const words = texts.flatMap((element) =>
      element.paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.text)),
    );
    expect(words.every((text) => text === '')).toBe(true);
  });

  it('draws one frame per layout slot and none for master placeholders', () => {
    expect(texts.filter((element) => element.role === 'title')).toHaveLength(1);
    expect(texts.map((element) => element.sourceShapeId)).toEqual([2, 3, 8]);
  });

  it('leaves out the header and footer placeholders', () => {
    expect(slide?.elements.some((element) => [4, 5, 6].includes(element.sourceShapeId ?? 0))).toBe(
      false,
    );
  });

  it('keeps master graphics under the layout frames', () => {
    expect(slide?.elements[0]).toMatchObject({ kind: 'decor', sourceShapeId: 20 });
  });

  it('takes position and unstated formatting of a frame from the master placeholder', () => {
    expect(texts[0]).toMatchObject({
      role: 'title',
      box: masterBox,
      paragraphs: [{ runs: [{ text: '', font: 'Unbounded', sizePt: 36 }] }],
    });
  });
});
