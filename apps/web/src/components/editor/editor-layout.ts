import { DOCK_DEFAULT, toDockState, type DockState } from './dock';

/**
 * Раскладка редактора, которую человек настроил под себя: ширина колонки слайдов, ширина
 * правой панели и место панели инструментов.
 *
 * Живёт в cookie, а не в localStorage: сервер читает её вместе с запросом и сразу рисует
 * колонки нужной ширины. Иначе первый кадр показывал бы ширину по умолчанию, а после
 * гидратации колонка прыгала бы на сохранённую.
 *
 * Модуль без React и без `window` на верхнем уровне — его импортирует и серверная страница.
 */

export const EDITOR_LAYOUT_COOKIE = 'lct.editor.layout';

/** Год: раскладка — привычка, а не сессия. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Границы ширины колонок в CSS-пикселях. Шире — колонка съедает холст, уже — не читается. */
export const SLIDES_WIDTH = { min: 180, max: 360, default: 240 } as const;
export const INSPECTOR_WIDTH = { min: 240, max: 420, default: 280 } as const;

export type EditorLayout = {
  /** Ширина колонки слайдов. */
  slides: number;
  /** Ширина правой панели, когда она открыта. */
  inspector: number;
  dock: DockState;
};

export const EDITOR_LAYOUT_DEFAULT: EditorLayout = {
  slides: SLIDES_WIDTH.default,
  inspector: INSPECTOR_WIDTH.default,
  dock: DOCK_DEFAULT,
};

function width(value: unknown, bounds: { min: number; max: number; default: number }): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return bounds.default;
  return Math.round(Math.min(Math.max(value, bounds.min), bounds.max));
}

/**
 * Разбор cookie. Каждое поле проверяется отдельно: испорченное или устаревшее значение
 * возвращает своё поле к умолчанию и не тянет за собой остальные.
 */
export function parseEditorLayout(raw: string | null | undefined): EditorLayout {
  if (!raw) return EDITOR_LAYOUT_DEFAULT;
  let value: unknown;
  try {
    value = JSON.parse(safeDecode(raw));
  } catch {
    return EDITOR_LAYOUT_DEFAULT;
  }
  if (typeof value !== 'object' || value === null) return EDITOR_LAYOUT_DEFAULT;
  const layout = value as Record<string, unknown>;
  return {
    slides: width(layout.slides, SLIDES_WIDTH),
    inspector: width(layout.inspector, INSPECTOR_WIDTH),
    dock: toDockState(layout.dock) ?? DOCK_DEFAULT,
  };
}

/** Значение cookie: JSON, закодированный под допустимые в cookie символы. */
export function serializeEditorLayout(layout: EditorLayout): string {
  return encodeURIComponent(
    JSON.stringify({
      slides: width(layout.slides, SLIDES_WIDTH),
      inspector: width(layout.inspector, INSPECTOR_WIDTH),
      dock: layout.dock,
    }),
  );
}

/** Сервер может отдать значение уже раскодированным, а может и нет. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Только в браузере. Раскладка — не та потеря, из-за которой стоит ломать редактор. */
export function writeEditorLayout(layout: EditorLayout): void {
  try {
    document.cookie = `${EDITOR_LAYOUT_COOKIE}=${serializeEditorLayout(layout)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
  } catch {
    // Cookie запрещены: раскладка просто не запомнится.
  }
}
