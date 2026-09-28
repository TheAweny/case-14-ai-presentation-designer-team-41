import { describe, expect, it } from 'vitest';
import {
  type MeasureText,
  type TextMeasuringContext,
  canvasMeasurer,
  checkFonts,
  isFontAvailable,
  isFontMissing,
} from './font-availability';

const BASE_WIDTHS: Record<string, number> = { monospace: 600, serif: 500, 'sans-serif': 480 };

/**
 * Поддельный холст: базовые семейства имеют свою ширину, а семейство из `installed` в каждой
 * паре даёт ширину из таблицы. Отсутствующее рисуется своим запасным.
 */
function fakeMeasure(installed: Record<string, Partial<Record<string, number>>>): MeasureText {
  return (_text, font) => {
    const stack = font.replace(/^\S+\s+/, '');
    const [first, fallback] = stack.split(',').map((part) => part.trim());
    const base = fallback ?? first ?? '';
    const named = fallback ? (first ?? '').replaceAll('"', '') : null;
    const widths = named ? installed[named] : undefined;
    return widths?.[base] ?? BASE_WIDTHS[base] ?? 0;
  };
}

describe('isFontAvailable', () => {
  it('шрифт есть: ширины отличаются от запасных', () => {
    const measure = fakeMeasure({ Inter: { monospace: 530, serif: 530, 'sans-serif': 530 } });
    expect(isFontAvailable('Inter', measure)).toBe(true);
  });

  it('шрифта нет: во всех трёх парах ширины совпали', () => {
    expect(isFontAvailable('Nowhere Grotesk', fakeMeasure({}))).toBe(false);
  });

  it('частичное совпадение: одна пара разошлась — шрифт есть', () => {
    // Шрифт с метриками как у sans-serif и serif, но не как у monospace.
    const measure = fakeMeasure({ Arimo: { monospace: 480 } });
    expect(isFontAvailable('Arimo', measure)).toBe(true);
  });

  it('пустое имя — нет', () => {
    expect(isFontAvailable('  ', fakeMeasure({}))).toBe(false);
  });

  it('кавычки в имени не ломают стек', () => {
    const fonts: string[] = [];
    isFontAvailable('Bad "Name"', (_text, font) => {
      fonts.push(font);
      return 0;
    });
    expect(fonts).toContain('72px "Bad Name", serif');
  });
});

describe('checkFonts', () => {
  it('карта по каждому семейству без повторов и пустых имён', () => {
    const measure = fakeMeasure({ Inter: { serif: 470 } });
    const availability = checkFonts(['Inter', 'Missing', 'Inter', ''], measure);
    expect([...availability]).toEqual([
      ['Inter', true],
      ['Missing', false],
    ]);
  });
});

describe('isFontMissing', () => {
  const availability = new Map([
    ['Inter', true],
    ['Missing', false],
  ]);

  it('true, только если семейство проверено и недоступно', () => {
    expect(isFontMissing(availability, 'Missing')).toBe(true);
    expect(isFontMissing(availability, 'Inter')).toBe(false);
  });

  it('непроверенное семейство не считается отсутствующим', () => {
    expect(isFontMissing(availability, 'Unknown')).toBe(false);
    expect(isFontMissing(new Map(), 'Missing')).toBe(false);
  });
});

describe('canvasMeasurer', () => {
  it('ставит шрифт холсту и возвращает ширину строки', () => {
    const context = {
      font: '',
      measureText(text: string) {
        return { width: text.length * (this.font.includes('serif') ? 2 : 1) } as TextMetrics;
      },
    } satisfies TextMeasuringContext;
    const measure = canvasMeasurer(context);
    expect(measure('abc', '72px serif')).toBe(6);
    expect(context.font).toBe('72px serif');
  });
});
