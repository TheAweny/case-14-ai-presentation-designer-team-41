/**
 * Поведение редактора, которое человек настраивает под себя в окне настроек: что стоит на рейке,
 * где полоса у объекта и что в ней, как ведут себя холст и оформление шаблона, свои сочетания
 * клавиш, а ещё значения по умолчанию для генерации и экспорта.
 *
 * Живёт в cookie, как и раскладка (`editor-layout.ts`): сервер читает её вместе с запросом, и
 * рейка с полосой с первого кадра такие, как человек настроил, а не прыгают после гидратации.
 *
 * Модуль без React и без `window` на верхнем уровне — его импортирует и корневой макет.
 */

import { EXPORT_FORMATS, type ExportFormat } from '../../lib/deck-export';
import { SLIDE_COUNT_RANGE } from '../../lib/deck-generator';
import {
  decodeChord,
  isRemappableId,
  type Chord,
  type ShortcutId,
  type ShortcutOverrides,
} from './editor-shortcuts';

export const EDITOR_PREFS_COOKIE = 'lct.editor.prefs';

/** Год: настройки — привычка, а не сессия. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/** Кнопки рейки, которые можно убрать. Инструменты выбора, текста, картинки и фигур — нельзя. */
export const RAIL_OPTIONAL = ['data', 'ai', 'shortcuts', 'present'] as const;
export type RailOptional = (typeof RAIL_OPTIONAL)[number];

/**
 * `object` — полоса у выделенного объекта, `pinned` — закреплена над холстом и не закрывает
 * соседние объекты, `off` — свойства только в панели «Дизайн».
 */
export const SELECTION_BAR_MODES = ['object', 'pinned', 'off'] as const;
export type SelectionBarMode = (typeof SELECTION_BAR_MODES)[number];

/** Кнопки полосы, которые можно убрать в меню «⋯». */
export const BAR_OPTIONAL = ['duplicate', 'layers', 'lock', 'remove'] as const;
export type BarOptional = (typeof BAR_OPTIONAL)[number];

/** `pan` — колесо двигает лист, Ctrl+колесо масштабирует (Figma); `zoom` — наоборот. */
export const WHEEL_MODES = ['pan', 'zoom'] as const;
export type WheelMode = (typeof WHEEL_MODES)[number];

/** Сколько шагов сетки проходит Shift+стрелка. */
export const LARGE_NUDGE_STEPS = [2, 4, 8] as const;
export type LargeNudgeSteps = (typeof LARGE_NUDGE_STEPS)[number];

/** Имя файла экспорта: название колоды или название с датой. */
export const EXPORT_NAMES = ['title', 'title-date'] as const;
export type ExportName = (typeof EXPORT_NAMES)[number];

export type EditorPrefs = {
  /** Необязательные кнопки рейки, которые человек спрятал. Их клавиши работают по-прежнему. */
  railHidden: readonly RailOptional[];
  /** После вставки объекта остаться в инструменте, а не вернуться к указателю. */
  keepTool: boolean;
  selectionBar: SelectionBarMode;
  /** Кнопка «Спросить ассистента» в полосе у объекта. */
  barAssistant: boolean;
  /** Кнопки полосы, убранные в меню «⋯». */
  barHidden: readonly BarOptional[];
  /** Прилипание к соседним объектам и краям слайда при перетаскивании. */
  snap: boolean;
  wheel: WheelMode;
  largeNudge: LargeNudgeSteps;
  /** Оформление шаблона заблокировано при открытии колоды. */
  lockTemplate: boolean;
  /** Свои сочетания: команда → `Mod+Shift+KeyL` или null («не назначено»). */
  shortcuts: Readonly<Partial<Record<ShortcutId, string | null>>>;
  /** Сколько слайдов просить в новом поле генерации; null — «Авто». */
  slideCount: number | null;
  exportFormat: ExportFormat;
  exportName: ExportName;
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
  barHidden: [],
  shortcuts: {},
  slideCount: null,
  exportFormat: 'pptx',
  exportName: 'title',
};

function oneOf<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Порядок — как на рейке или в полосе, без повторов и незнакомых кнопок. */
function subset<T>(value: unknown, allowed: readonly T[]): readonly T[] {
  if (!Array.isArray(value)) return [];
  return allowed.filter((id) => value.includes(id));
}

/** Только команды, которые можно переназначить, и только сочетания, которые можно назначить. */
function shortcuts(value: unknown): EditorPrefs['shortcuts'] {
  if (typeof value !== 'object' || value === null) return {};
  const result: Partial<Record<ShortcutId, string | null>> = {};
  for (const [id, chord] of Object.entries(value)) {
    if (!isRemappableId(id)) continue;
    if (chord === null) result[id] = null;
    else if (typeof chord === 'string' && decodeChord(chord)) result[id] = chord;
  }
  return result;
}

function slideCount(value: unknown): number | null {
  if (value === null || typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= SLIDE_COUNT_RANGE.min && value <= SLIDE_COUNT_RANGE.max ? value : null;
}

/** Свои сочетания в виде, который понимает реестр клавиш. */
export function shortcutOverrides(shortcuts: EditorPrefs['shortcuts']): ShortcutOverrides {
  const result: Partial<Record<ShortcutId, Chord | null>> = {};
  for (const [id, chord] of Object.entries(shortcuts)) {
    if (!isRemappableId(id) || chord === undefined) continue;
    result[id] = chord === null ? null : decodeChord(chord);
  }
  return result;
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
    railHidden: subset(prefs.railHidden, RAIL_OPTIONAL),
    keepTool: flag(prefs.keepTool, fallback.keepTool),
    selectionBar: oneOf(prefs.selectionBar, SELECTION_BAR_MODES, fallback.selectionBar),
    barAssistant: flag(prefs.barAssistant, fallback.barAssistant),
    snap: flag(prefs.snap, fallback.snap),
    wheel: oneOf(prefs.wheel, WHEEL_MODES, fallback.wheel),
    largeNudge: oneOf(prefs.largeNudge, LARGE_NUDGE_STEPS, fallback.largeNudge),
    lockTemplate: flag(prefs.lockTemplate, fallback.lockTemplate),
    barHidden: subset(prefs.barHidden, BAR_OPTIONAL),
    shortcuts: shortcuts(prefs.shortcuts),
    slideCount: slideCount(prefs.slideCount),
    exportFormat: oneOf(prefs.exportFormat, EXPORT_FORMATS, fallback.exportFormat),
    exportName: oneOf(prefs.exportName, EXPORT_NAMES, fallback.exportName),
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
