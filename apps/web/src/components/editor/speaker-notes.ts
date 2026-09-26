/**
 * Заметки докладчика под холстом (F-60): чистая часть — как область помнит себя и какой высоты
 * она бывает. Сами заметки живут в `SlideIR.notes` и идут через журнал правок.
 */

/** Где область помнит, открыта ли она и какой высоты. Это привычка человека, не данные колоды. */
export const NOTES_PREFS_KEY = 'lct.editor.notes';

/** Высота открытой области в CSS-пикселях: ниже не видно строки, выше — холст пропадает. */
export const NOTES_HEIGHT = { min: 72, default: 128, maxShare: 0.5 } as const;

/** Пауза в наборе, после которой заметки уходят в журнал: одна запись на фразу, не на букву. */
export const NOTES_COMMIT_DELAY_MS = 700;

export interface NotesPrefs {
  readonly open: boolean;
  readonly height: number;
}

export const NOTES_PREFS_DEFAULT: NotesPrefs = { open: false, height: NOTES_HEIGHT.default };

/** Высота в допустимых границах: не ниже минимума и не выше доли окна. */
export function clampNotesHeight(height: number, viewport: number): number {
  const max = Math.max(NOTES_HEIGHT.min, Math.round(viewport * NOTES_HEIGHT.maxShare));
  if (!Number.isFinite(height)) return Math.min(NOTES_HEIGHT.default, max);
  return Math.round(Math.min(Math.max(height, NOTES_HEIGHT.min), max));
}

/** Разбор сохранённого. Испорченное значение возвращает поле к умолчанию, а не ломает редактор. */
export function parseNotesPrefs(raw: string | null): NotesPrefs {
  if (!raw) return NOTES_PREFS_DEFAULT;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return NOTES_PREFS_DEFAULT;
    const record = value as Record<string, unknown>;
    return {
      open: record.open === true,
      height:
        typeof record.height === 'number' && Number.isFinite(record.height)
          ? Math.max(NOTES_HEIGHT.min, Math.round(record.height))
          : NOTES_HEIGHT.default,
    };
  } catch {
    return NOTES_PREFS_DEFAULT;
  }
}

/** Первая непустая строка заметок: её видно в свёрнутой области. */
export function notesPreview(notes: string | undefined): string {
  return (
    (notes ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? ''
  );
}
