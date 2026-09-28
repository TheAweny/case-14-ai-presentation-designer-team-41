/**
 * Есть ли шрифт шаблона на этом компьютере. Рендерер пишет стек `"Имя", <generic>`, и без
 * шрифта браузер молча рисует запасной — это нужно заметить и показать: в документе шрифт
 * остаётся шаблонным, а в интерфейсе он временно подменён.
 *
 * `document.fonts.check()` здесь не годится: для шрифта, которого нет нигде, он отвечает true.
 * Поэтому приём классический — ширина строки. Строка рисуется в `"Имя", monospace` и просто в
 * `monospace`, то же для `serif` и `sans-serif`. Если шрифта нет, в каждой паре рисует запасной,
 * и ширины совпадают все три раза; хоть одна пара разошлась — шрифт есть.
 *
 * Мерить нужно после загрузки веб-шрифтов: незагруженный `@font-face` тоже рисуется запасным.
 */

/** Семейство → доступно ли. Непроверенных семейств в карте нет: о них ничего не известно. */
export type FontAvailability = ReadonlyMap<string, boolean>;

/** Ширина строки `text`, нарисованной шрифтом `font` (CSS-сокращение, как у canvas). */
export type MeasureText = (text: string, font: string) => number;

/** Широкие и узкие знаки латиницы и кириллицы: у разных шрифтов их ширины расходятся заметно. */
const PROBE = 'mmmmmmmmmmlli WwQq@01 ЖжШщЮюФфЫыЁё';

/** Крупный кегль: разница ширин не тонет в округлении. */
const PROBE_SIZE = '72px';

const BASES = ['monospace', 'serif', 'sans-serif'] as const;

/** Имя семейства без кавычек и пробелов по краям — так же его пишет в стек рендерер. */
function familyName(family: string): string {
  return family.trim().replaceAll('"', '');
}

/** Нарисует ли браузер это семейство само, а не запасное. Пустое имя — нет. */
export function isFontAvailable(family: string, measure: MeasureText): boolean {
  const name = familyName(family);
  if (!name) return false;
  return BASES.some(
    (base) =>
      measure(PROBE, `${PROBE_SIZE} "${name}", ${base}`) !==
      measure(PROBE, `${PROBE_SIZE} ${base}`),
  );
}

/** Карта доступности семейств; пустые имена пропускаются. */
export function checkFonts(families: readonly string[], measure: MeasureText): FontAvailability {
  const availability = new Map<string, boolean>();
  for (const family of families) {
    if (!familyName(family) || availability.has(family)) continue;
    availability.set(family, isFontAvailable(family, measure));
  }
  return availability;
}

/** Шрифт проверен и его нет. Непроверенный — не «отсутствует»: предупреждать не о чем. */
export function isFontMissing(availability: FontAvailability, family: string): boolean {
  return availability.get(family) === false;
}

/** Часть `CanvasRenderingContext2D`, которая нужна для замера: подменяется в тестах. */
export type TextMeasuringContext = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

/** Измеритель на `measureText` холста. */
export function canvasMeasurer(context: TextMeasuringContext): MeasureText {
  return (text, font) => {
    context.font = font;
    return context.measureText(text).width;
  };
}

/** Измеритель браузера; вне браузера и без 2d-холста — null. */
export function browserMeasurer(): MeasureText | null {
  if (typeof document === 'undefined') return null;
  const context = document.createElement('canvas').getContext('2d');
  return context ? canvasMeasurer(context) : null;
}
