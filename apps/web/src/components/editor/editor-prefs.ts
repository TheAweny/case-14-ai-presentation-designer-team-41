/**
 * Поведение редактора, которое человек настраивает под себя в окне настроек: что стоит на рейке,
 * где полоса у объекта, как ведут себя холст и оформление шаблона.
 *
 * Живёт в cookie, как и раскладка (`editor-layout.ts`): сервер читает её вместе с запросом, и
 * рейка с полосой с первого кадра такие, как человек настроил, а не прыгают после гидратации.
 *
 * Модуль без React и без `window` на верхнем уровне — его импортирует и корневой макет.
 */

export const EDITOR_PREFS_COOKIE = 'lct.editor.prefs';

/** Год: настройки — привычка, а не сессия. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Кнопки рейки, которые можно убрать. Инструменты выбора, текста, картинки и фигур — нельзя. */
export const RAIL_OPTIONAL = ['data', 'ai', 'shortcuts', 'present'] as const;
export type RailOptional = (typeof RAIL_OPTIONAL)[number];

/** `object` — полоса у выделенного объекта, `off` — свойства только в панели «Дизайн». */
export const SELECTION_BAR_MODES = ['object', 'off'] as const;
export type SelectionBarMode = (typeof SELECTION_BAR_MODES)[number];

/** `pan` — колесо двигает лист, Ctrl+колесо масштабирует (Figma); `zoom` — наоборот. */
export const WHEEL_MODES = ['pan', 'zoom'] as const;
export type WheelMode = (typeof WHEEL_MODES)[number];

/** Сколько шагов сетки проходит Shift+стрелка. */
export const LARGE_NUDGE_STEPS = [2, 4, 8] as const;
export type LargeNudgeSteps = (typeof LARGE_NUDGE_STEPS)[number];

export type EditorPrefs = {
  /** Необязательные кнопки рейки, которые человек спрятал. Их клавиши работают по-прежнему. */
  railHidden: readonly RailOptional[];
  /** После вставки объекта остаться в инструменте, а не вернуться к указателю. */
  keepTool: boolean;
  selectionBar: SelectionBarMode;
  /** Кнопка «Спросить ассистента» в полосе у объекта. */
  barAssistant: boolean;
  /** Прилипание к соседним объектам и краям слайда при перетаскивании. */
  snap: boolean;
  wheel: WheelMode;
  largeNudge: LargeNudgeSteps;
  /** Оформление шаблона заблокировано при открытии колоды. */
  lockTemplate: boolean;
};

export const EDITOR_PREFS_DEFAULT: EditorPrefs = {
  railHidden: [],
  keepTool: false,
  selectionBar: 'object',
  barAssistant: true,
  snap: true,
  wheel: 'pan',
  largeNudge: 4,
  lockTemplate: true,
};

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Порядок — как на рейке, без повторов и незнакомых кнопок. */
function railHidden(value: unknown): readonly RailOptional[] {
  if (!Array.isArray(value)) return EDITOR_PREFS_DEFAULT.railHidden;
  return RAIL_OPTIONAL.filter((id) => value.includes(id));
}

/**
 * Разбор cookie. Каждое поле проверяется отдельно: испорченное или устаревшее значение
 * возвращает своё поле к умолчанию и не тянет за собой остальные.
 */
export function parseEditorPrefs(raw: string | null | undefined): EditorPrefs {
  if (!raw) return EDITOR_PREFS_DEFAULT;
  let value: unknown;
  try {
    value = JSON.parse(safeDecode(raw));
  } catch {
    return EDITOR_PREFS_DEFAULT;
  }
  if (typeof value !== 'object' || value === null) return EDITOR_PREFS_DEFAULT;
  const prefs = value as Record<string, unknown>;
  const fallback = EDITOR_PREFS_DEFAULT;
  return {
    railHidden: railHidden(prefs.railHidden),
    keepTool: flag(prefs.keepTool, fallback.keepTool),
    selectionBar: oneOf(prefs.selectionBar, SELECTION_BAR_MODES, fallback.selectionBar),
    barAssistant: flag(prefs.barAssistant, fallback.barAssistant),
    snap: flag(prefs.snap, fallback.snap),
    wheel: oneOf(prefs.wheel, WHEEL_MODES, fallback.wheel),
    largeNudge: oneOf(prefs.largeNudge, LARGE_NUDGE_STEPS, fallback.largeNudge),
    lockTemplate: flag(prefs.lockTemplate, fallback.lockTemplate),
  };
}

/** Значение cookie: JSON, закодированный под допустимые в cookie символы. */
export function serializeEditorPrefs(prefs: EditorPrefs): string {
  return encodeURIComponent(JSON.stringify(prefs));
}

/** Сервер может отдать значение уже раскодированным, а может и нет. */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Только в браузере. Не запомнились настройки — не повод ломать редактор. */
export function writeEditorPrefs(prefs: EditorPrefs): void {
  try {
    document.cookie = `${EDITOR_PREFS_COOKIE}=${serializeEditorPrefs(prefs)}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
  } catch {
    // Cookie запрещены: настройки действуют до перезагрузки.
  }
}
