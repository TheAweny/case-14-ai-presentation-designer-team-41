import type { StyleSource, TokenMeta } from '@lct/contracts';

/**
 * Доверие к значению по его происхождению: замер со слайдов надёжнее темы, тема — запасного
 * значения. Демо-профиль собран вручную, поэтому цифры условные, но порядок тот же, что у парсера.
 */
const CONFIDENCE: Record<StyleSource, number> = { observed: 0.9, theme: 0.6, fallback: 0.3 };

/** Свидетельство за токеном демо-профиля: откуда он и какая доля шаблона с ним согласна. */
export function tokenMeta(source: StyleSource, share = 1): TokenMeta {
  return { source, count: share > 0 ? 1 : 0, share, confidence: CONFIDENCE[source], parts: [] };
}
