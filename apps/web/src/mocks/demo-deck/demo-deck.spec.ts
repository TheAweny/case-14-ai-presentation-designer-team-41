import { describe, expect, it } from 'vitest';
import {
  designSystemSchema,
  elementRoleSchema,
  slideElementSchema,
  slideIrSchema,
  type Box,
} from '@lct/contracts';
import { CONTENT_TITLE_BOX, cell, columns } from './grid';
import { DEMO_DECK } from './index';

const { slides, designSystem, slideSize } = DEMO_DECK;
const { grid } = designSystem;
const elements = slides.flatMap((slide) =>
  slide.elements.map((element) => ({
    slide,
    element,
    where: `${slide.slideId}/${element.elementId}`,
  })),
);

/** Слайды со своей композицией. У остальных заголовок стоит в общей рамке сетки. */
const OWN_COMPOSITION = new Set(['title-slide', 'section-header', 'closing']);

/** Строки, которые аудит считает забытыми заглушками. */
const FORBIDDEN = [/\bTODO\b/, /\bXXX\b/, /lorem\s+ipsum/i, /вставьте\s+текст/i];

function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(stringsIn);
  return [];
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.cx && b.x < a.x + a.cx && a.y < b.y + b.cy && b.y < a.y + a.cy;
}

describe('контракты', () => {
  it.each(slides.map((slide) => [slide.slideId, slide] as const))(
    'слайд %s проходит схему SlideIR',
    (_, slide) => {
      expect(slideIrSchema.safeParse(slide).error?.issues ?? []).toEqual([]);
    },
  );

  it('дизайн-система проходит свою схему', () => {
    expect(designSystemSchema.safeParse(designSystem).error?.issues ?? []).toEqual([]);
  });
});

describe('колода', () => {
  it('слайды идут по порядку, одного варианта и одного размера с сеткой', () => {
    expect({ cx: grid.slideCx, cy: grid.slideCy }).toEqual(slideSize);
    slides.forEach((slide, i) => {
      expect(slide.index).toBe(i);
      expect(slide.variant).toBe(DEMO_DECK.variant);
      expect({ cx: slide.slideCx, cy: slide.slideCy }).toEqual(slideSize);
    });
  });

  it('slideId уникальны в колоде', () => {
    const ids = slides.map((slide) => slide.slideId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('elementId уникальны в пределах слайда', () => {
    for (const slide of slides) {
      const ids = slide.elements.map((element) => element.elementId);
      expect(
        ids.filter((id, i) => ids.indexOf(id) !== i),
        slide.slideId,
      ).toEqual([]);
    }
  });

  it('номер страницы совпадает с местом слайда', () => {
    for (const { slide, element } of elements) {
      if (element.kind !== 'text' || element.role !== 'page-number') continue;
      const shown = element.paragraphs.flatMap((p) => p.runs.map((r) => r.text)).join('');
      expect(shown, slide.slideId).toBe(String(slide.index + 1));
    }
  });

  it('ряды таблиц и серии графиков той же длины, что заголовки и категории', () => {
    for (const { element, where } of elements) {
      if (element.kind === 'table') {
        for (const row of element.rows) expect(row.length, where).toBe(element.headers.length);
      }
      if (element.kind === 'chart') {
        for (const s of element.series)
          expect(s.values.length, where).toBe(element.categories.length);
      }
    }
  });
});

describe('геометрия', () => {
  it('рамки ненулевые и не выходят за слайд', () => {
    const outside = elements
      .filter(({ slide, element: { box } }) => {
        const inside =
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.cx <= slide.slideCx &&
          box.y + box.cy <= slide.slideCy;
        return box.cx <= 0 || box.cy <= 0 || !inside;
      })
      .map(({ where }) => where);
    expect(outside).toEqual([]);
  });

  it('содержимое не заходит на поля; за поля выходит только оформление', () => {
    const onMargins = elements
      .filter(({ slide, element: { kind, box } }) => {
        if (kind === 'decor') return false;
        return (
          box.x < grid.marginLeft ||
          box.y < grid.marginTop ||
          box.x + box.cx > slide.slideCx - grid.marginRight ||
          box.y + box.cy > slide.slideCy - grid.marginBottom
        );
      })
      .map(({ where }) => where);
    expect(onMargins).toEqual([]);
  });

  it('содержимое не наезжает друг на друга; под ним может лежать только оформление', () => {
    const collisions: string[] = [];
    for (const slide of slides) {
      const content = slide.elements.filter((element) => element.kind !== 'decor');
      content.forEach((a, i) => {
        for (const b of content.slice(i + 1)) {
          if (overlaps(a.box, b.box)) {
            collisions.push(`${slide.slideId}: ${a.elementId} × ${b.elementId}`);
          }
        }
      });
    }
    expect(collisions).toEqual([]);
  });

  it('заголовки контентных слайдов стоят в одной рамке', () => {
    const titles = elements.filter(
      ({ slide, element }) => element.role === 'title' && !OWN_COMPOSITION.has(slide.patternId),
    );
    expect(titles.length).toBeGreaterThan(slides.length / 2);
    for (const { element, where } of titles) expect(element.box, where).toEqual(CONTENT_TITLE_BOX);
  });

  it('колонки и ячейки ровно заполняют область контента', () => {
    const right = grid.slideCx - grid.marginRight;
    const full = columns(0, grid.columns);
    expect(full.x).toBe(grid.marginLeft);
    expect(full.x + full.cx).toBe(right);
    const last = cell(4, 5);
    expect(last.x + last.cx).toBeLessThanOrEqual(right);
    expect(right - (last.x + last.cx)).toBeLessThan(5);
    expect(() => columns(8, 5)).toThrow(RangeError);
  });
});

describe('покрытие', () => {
  it('встречается каждый вид элемента SlideIR', () => {
    const kinds = slideElementSchema.options.map((option) => option.shape.kind.value);
    const used = new Set(elements.map(({ element }) => element.kind));
    expect(kinds.filter((kind) => !used.has(kind))).toEqual([]);
  });

  it('встречается каждая роль элемента', () => {
    const used = new Set(elements.map(({ element }) => element.role));
    expect(elementRoleSchema.options.filter((role) => !used.has(role))).toEqual([]);
  });
});

describe('тексты', () => {
  it('нет забытых заглушек', () => {
    const found = stringsIn(DEMO_DECK).filter((s) => FORBIDDEN.some((re) => re.test(s)));
    expect(found).toEqual([]);
  });

  it('нет пустых абзацев', () => {
    const empty = elements
      .filter(
        ({ element }) =>
          element.kind === 'text' &&
          element.paragraphs.some((p) => p.runs.every((r) => r.text.trim() === '')),
      )
      .map(({ where }) => where);
    expect(empty).toEqual([]);
  });
});
