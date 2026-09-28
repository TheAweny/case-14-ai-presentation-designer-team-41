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
  it('preserves every parsed layout and its text elements', () => {
    const layouts = templateLayoutsFromIr(ir);
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
    const shape = { ...layout.shapes[0], shapeId: 2, paragraphs: [], mediaPart: '' };
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
      shapes: [{ ...layout.shapes[0], shapeId: 9, paragraphs: [], mediaPart: '' }],
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

  it('retains layout placeholders for the new-slide gallery', () => {
    const layouts = templateLayoutsFromIr(ir);
    expect(layouts[0]?.slide.elements).toMatchObject([
      { kind: 'text', sourceShapeId: 1, paragraphs: [{ runs: [{ text: 'Заголовок' }] }] },
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

  it('uses white inherited text on a dark themed slide', () => {
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
    expect(rendered?.elements).toMatchObject([
      { kind: 'text', sourceShapeId: 2, paragraphs: [{ runs: [{ color: 'FFFFFF' }] }] },
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
