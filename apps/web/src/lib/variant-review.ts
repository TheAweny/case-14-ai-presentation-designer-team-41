import { auditDeck } from '@lct/slide-audit';
import type { VariantReview } from './assistant-threads';
import type { ReviewVariants } from './deck-conversations';
import type { DeckSource } from './deck-source';

/**
 * Аудит готовых вариантов для агента: те же проверки над SlideIR, что живой аудит редактора, но
 * без замеров браузера. Переполнение берётся из записи вёрстки, а шрифты не проверяются: их
 * наличие зависит от компьютера, где колоду покажут, а не от колоды.
 */
export function createVariantReview(decks: DeckSource): ReviewVariants {
  return async (variants) => {
    const entries = await Promise.all(
      variants.map(async ({ deckId }) => {
        const deck = await decks.getDeck(deckId);
        const byPattern = new Map(
          deck.layouts.map((layout) => [layout.slide.patternId, layout.slide]),
        );
        const issues = auditDeck(deck.slides, {
          designSystem: deck.designSystem,
          layoutFor: (patternId) => byPattern.get(patternId),
        });
        const review: VariantReview = {
          errors: issues.filter((issue) => issue.level === 'error').length,
          warnings: issues.filter((issue) => issue.level === 'warning').length,
        };
        return [deckId, review] as const;
      }),
    );
    return Object.fromEntries(entries);
  };
}
