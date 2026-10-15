import type { ChatPart, LayoutVariant } from '@lct/contracts';
import { auditDeck } from '@lct/slide-audit';
import type { GeneratedVariant } from './deck-generator';
import type { Deck } from './deck-source';

/** Итог аудита одного варианта: сколько ошибок и замечаний нашла проверка слайдов. */
export interface VariantReview {
  readonly errors: number;
  readonly warnings: number;
  readonly status?: 'complete' | 'requires-review' | 'unknown';
  readonly contentRevision?: number;
  readonly contentHash?: string;
}

/** Итог сборки: три варианта вёрстки одного плана, аудит каждого и совет агента. */
export interface DeckResult {
  readonly runId: string;
  /** В порядке `LAYOUT_VARIANTS`. */
  readonly variants: readonly GeneratedVariant[];
  /** Аудит сборки по `deckId` варианта; null — проверить не удалось. */
  readonly reviews: Readonly<Record<string, VariantReview>> | null;
  /** Вариант, который агент советует: меньше всего ошибок, при равенстве — сбалансированный. */
  readonly recommended: LayoutVariant;
  /** Колоды собраны не на выбранном шаблоне — так честно отвечает демо-генератор. */
  readonly templateSubstituted: boolean;
  /** От запуска прогона до готовности; null — неизвестно. */
  readonly elapsedMs: number | null;
}

/** Карточка и агент сравнивают один сохранённый аудит сборки, а не аудит импортированных слайдов. */
export function resultOfBuild(
  part: Extract<ChatPart, { type: 'result' }>,
  decks: readonly Deck[],
): DeckResult {
  const byId = new Map(decks.map((deck) => [deck.deckId, deck]));
  const variants: GeneratedVariant[] = part.variants.flatMap(({ variant, deckId }) => {
    const deck = byId.get(deckId);
    const cover = deck?.slides[0];
    return deck && cover
      ? [
          {
            variant,
            deckId,
            title: deck.title,
            slideCount: deck.slides.length,
            cover,
            coverPreviewUrl: deck.coverPreviewUrl,
            designSystem: deck.designSystem,
          },
        ]
      : [];
  });
  const reviews = variants.every(({ deckId }) => {
    const review = part.reviews?.[deckId];
    return (
      review &&
      review.status !== undefined &&
      review.status !== 'unknown' &&
      review.contentRevision !== undefined &&
      review.contentHash?.length === 64
    );
  })
    ? part.reviews
    : null;
  return {
    runId: part.buildId,
    variants,
    reviews,
    // Проверяем и старые сохранённые советы по тем же числам, которые показывает карточка.
    recommended: variants.length ? recommendVariant(variants, reviews) : part.recommended,
    templateSubstituted: false,
    elapsedMs: part.elapsedMs,
  };
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
 * Без полного аудита — сбалансированный, если он есть: неизвестные числа не равны нулю.
 */
export function recommendVariant(
  variants: readonly Pick<GeneratedVariant, 'variant' | 'deckId'>[],
  reviews: Readonly<Record<string, VariantReview>> | null,
): LayoutVariant {
  const rank = (variant: LayoutVariant) => {
    const at = PREFERENCE.indexOf(variant);
    return at < 0 ? PREFERENCE.length : at;
  };
  const audited = variants.every((item) => reviews?.[item.deckId] !== undefined);
  const sorted = [...variants].sort((a, b) => {
    const ra = reviews?.[a.deckId];
    const rb = reviews?.[b.deckId];
    if (audited && ra && rb) {
      if (ra.errors !== rb.errors) return ra.errors - rb.errors;
      if (ra.warnings !== rb.warnings) return ra.warnings - rb.warnings;
    }
    return rank(a.variant) - rank(b.variant);
  });
  const best = sorted[0];
  if (!best) throw new Error('No variants to recommend');
  return best.variant;
}
