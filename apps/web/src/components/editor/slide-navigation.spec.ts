import { describe, expect, it } from 'vitest';
import type { SlideElement } from '@lct/contracts';
import {
  isTypingTarget,
  listKeyTarget,
  nearestScroll,
  pageKeyStep,
  slideIndexFromParam,
  slideTitle,
  stepSlide,
} from './slide-navigation';

const SLIDES = [{ slideId: 'cover' }, { slideId: 'problem' }, { slideId: 'closing' }];

function title(elementId: string, role: SlideElement['role'], ...lines: string[]): SlideElement {
  return {
    kind: 'text',
    elementId,
    role,
    box: { x: 0, y: 0, cx: 100, cy: 100 },
    sourceShapeId: null,
    paragraphs: lines.map((line) => ({
      level: 0,
      lineSpacing: null,
      runs: line.split('|').map((text) => ({
        text,
        font: '',
        sizePt: null,
        bold: null,
        italic: null,
        color: '',
      })),
    })),
    overflow: null,
  };
}

describe('slideIndexFromParam', () => {
  it('находит слайд по id', () => {
    expect(slideIndexFromParam(SLIDES, 'problem')).toBe(1);
    expect(slideIndexFromParam(SLIDES, 'closing')).toBe(2);
  });

  it('без параметра, с пустым или неизвестным id открывает первый слайд', () => {
    expect(slideIndexFromParam(SLIDES, null)).toBe(0);
    expect(slideIndexFromParam(SLIDES, '')).toBe(0);
    expect(slideIndexFromParam(SLIDES, 'missing')).toBe(0);
  });

  it('в пустой колоде отвечает нулём', () => {
    expect(slideIndexFromParam([], 'cover')).toBe(0);
  });
});

describe('stepSlide', () => {
  it('шагает в обе стороны', () => {
    expect(stepSlide(1, 1, 3)).toBe(2);
    expect(stepSlide(1, -1, 3)).toBe(0);
  });

  it('упирается в края колоды, а не заворачивает', () => {
    expect(stepSlide(0, -1, 3)).toBe(0);
    expect(stepSlide(2, 1, 3)).toBe(2);
    expect(stepSlide(1, 10, 3)).toBe(2);
  });

  it('в пустой колоде остаётся на нуле', () => {
    expect(stepSlide(0, 1, 0)).toBe(0);
  });
});

describe('listKeyTarget', () => {
  it('↑/↓ листают в обеих ориентациях', () => {
    for (const orientation of ['vertical', 'horizontal'] as const) {
      expect(listKeyTarget('ArrowDown', 1, 3, orientation)).toBe(2);
      expect(listKeyTarget('ArrowUp', 1, 3, orientation)).toBe(0);
    }
  });

  it('←/→ листают только горизонтальную ленту', () => {
    expect(listKeyTarget('ArrowRight', 1, 3, 'horizontal')).toBe(2);
    expect(listKeyTarget('ArrowLeft', 1, 3, 'horizontal')).toBe(0);
    expect(listKeyTarget('ArrowRight', 1, 3, 'vertical')).toBeNull();
    expect(listKeyTarget('ArrowLeft', 1, 3, 'vertical')).toBeNull();
  });

  it('Home и End ведут к первому и последнему слайду', () => {
    expect(listKeyTarget('Home', 2, 3, 'vertical')).toBe(0);
    expect(listKeyTarget('End', 0, 3, 'horizontal')).toBe(2);
  });

  it('у края остаётся на месте, но клавишу забирает', () => {
    expect(listKeyTarget('ArrowUp', 0, 3, 'vertical')).toBe(0);
    expect(listKeyTarget('ArrowDown', 2, 3, 'vertical')).toBe(2);
  });

  it('чужие клавиши и пустую колоду не трогает', () => {
    expect(listKeyTarget('Enter', 1, 3, 'vertical')).toBeNull();
    expect(listKeyTarget('PageDown', 1, 3, 'vertical')).toBeNull();
    expect(listKeyTarget('ArrowDown', 0, 0, 'vertical')).toBeNull();
  });
});

describe('nearestScroll', () => {
  /** Окно списка в 300 px, прокрученное на 200: видно содержимое от 200 до 500. */
  const VIEW = { start: 200, size: 300 };

  it('видимый целиком элемент список не двигает', () => {
    expect(nearestScroll(VIEW, { start: 260, size: 80 }, 8)).toBe(200);
  });

  it('элемент выше окна встаёт к его началу, ниже — к концу, с полем вокруг', () => {
    expect(nearestScroll(VIEW, { start: 100, size: 80 }, 8)).toBe(92);
    expect(nearestScroll(VIEW, { start: 460, size: 80 }, 8)).toBe(248);
  });

  it('элемент, задевший край поля, докручивается на поле', () => {
    expect(nearestScroll(VIEW, { start: 204, size: 80 }, 8)).toBe(196);
  });

  it('не уходит в минус у начала списка', () => {
    expect(nearestScroll(VIEW, { start: 4, size: 80 }, 8)).toBe(0);
  });

  it('элемент длиннее окна встаёт началом к началу окна', () => {
    expect(nearestScroll(VIEW, { start: 400, size: 400 }, 8)).toBe(392);
    expect(nearestScroll(VIEW, { start: 100, size: 400 }, 8)).toBe(92);
  });
});

describe('pageKeyStep', () => {
  it('PageUp — назад, PageDown — вперёд, остальное не его', () => {
    expect(pageKeyStep('PageUp')).toBe(-1);
    expect(pageKeyStep('PageDown')).toBe(1);
    expect(pageKeyStep('ArrowDown')).toBeNull();
    expect(pageKeyStep('Space')).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('узнаёт поля ввода и редактируемые элементы', () => {
    expect(isTypingTarget({ tagName: 'INPUT', isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: 'textarea' })).toBe(true);
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('остальное отдаёт колоде', () => {
    expect(isTypingTarget({ tagName: 'BUTTON', isContentEditable: false })).toBe(false);
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false);
    // Так выглядит цель события, всплывшего с самого window: ни тега, ни признака правки.
    expect(isTypingTarget({})).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('slideTitle', () => {
  it('берёт текст первого непустого заголовка, склеивая прогоны и абзацы', () => {
    expect(
      slideTitle({
        elements: [
          title('body', 'body', 'Не заголовок'),
          title('empty', 'title', '  '),
          title('title', 'title', 'Бюджет|  времени', 'на колоду'),
        ],
      }),
    ).toBe('Бюджет времени на колоду');
  });

  it('без заголовка отвечает null', () => {
    expect(slideTitle({ elements: [title('body', 'subtitle', 'Подзаголовок')] })).toBeNull();
    expect(slideTitle({ elements: [] })).toBeNull();
  });
});
