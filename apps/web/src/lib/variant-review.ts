import type { LayoutVariant } from '@lct/contracts';
import { auditDeck } from '@lct/slide-audit';
import type { GeneratedVariant } from './deck-generator';
import type { Deck } from './deck-source';

/** Итог аудита одного варианта: сколько ошибок и замечаний нашла проверка слайдов. */
export interface VariantReview {
  readonly errors: number;
  readonly warnings: number;
}

/** Итог сборки: три варианта вёрстки одного плана, аудит каждого и совет агента. */
export interface DeckResult {
  readonly runId: string;
  /** В порядке `LAYOUT_VARIANTS`. */
  readonly variants: readonly GeneratedVariant[];
  /** Аудит по `deckId` варианта; null — проверить не удалось, и агент выбрал без него. */
  readonly reviews: Readonly<Record<string, VariantReview>> | null;
  /** Вариант, который агент советует: меньше всего ошибок, при равенстве — сбалансированный. */
  readonly recommended: LayoutVariant;
  /** Колоды собраны не на выбранном шаблоне — так честно отвечает демо-генератор. */
  readonly templateSubstituted: boolean;
  /** От запуска прогона до готовности; null — неизвестно. */
  readonly elapsedMs: number | null;
}

/**
 * Аудит готового варианта: те же проверки над SlideIR, что живой аудит редактора, но без замеров
 * браузера. Переполнение берётся из записи вёрстки, а шрифты не проверяются: их наличие зависит
 * от компьютера, где колоду покажут, а не от колоды. Так числа в итоге совпадают с редактором.
 */
export function reviewDeck(deck: Deck): VariantReview {
  const byPattern = new Map(deck.layouts.map((layout) => [layout.slide.patternId, layout.slide]));
  const issues = auditDeck(deck.slides, {
    designSystem: deck.designSystem,
    layoutFor: (patternId) => byPattern.get(patternId),
  });
  return {
    errors: issues.filter((issue) => issue.level === 'error').length,
    warnings: issues.filter((issue) => issue.level === 'warning').length,
  };
}

/** Порядок, в котором агент советует варианты при равном аудите. */
const PREFERENCE: readonly LayoutVariant[] = ['balanced', 'dense', 'airy'];

/**
 * Какой вариант советовать: меньше ошибок, затем меньше замечаний, затем сбалансированный.
 * Без аудита — сбалансированный, если он есть.
 */
export function recommendVariant(
  variants: readonly Pick<GeneratedVariant, 'variant' | 'deckId'>[],
  reviews: Readonly<Record<string, VariantReview>> | null,
): LayoutVariant {
  const rank = (variant: LayoutVariant) => {
    const at = PREFERENCE.indexOf(variant);
    return at < 0 ? PREFERENCE.length : at;
  };
  const sorted = [...variants].sort((a, b) => {
    const ra = reviews?.[a.deckId];
    const rb = reviews?.[b.deckId];
    if (ra && rb) {
      if (ra.errors !== rb.errors) return ra.errors - rb.errors;
      if (ra.warnings !== rb.warnings) return ra.warnings - rb.warnings;
    }
    return rank(a.variant) - rank(b.variant);
  });
  const best = sorted[0];
  if (!best) throw new Error('No variants to recommend');
  return best.variant;
}
