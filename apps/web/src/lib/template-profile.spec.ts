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
});
