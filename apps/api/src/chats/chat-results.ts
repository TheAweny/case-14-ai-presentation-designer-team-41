import type { ChatMessage, ChatPart, LayoutVariant } from '@lct/contracts';
import { recommend } from './chat-tools.js';

/**
 * The result of a build as the chat keeps it, changed when a variant that failed is built again.
 * Pure functions: the chat service reads and writes, these decide what the result becomes.
 */

export type ResultPart = Extract<ChatPart, { type: 'result' }>;
export type FailedVariant = NonNullable<ResultPart['failed']>[number];

/** The order variants are shown in, as the build starts them. */
const VARIANT_ORDER: readonly LayoutVariant[] = ['dense', 'balanced', 'airy'];
const byOrder = (a: { variant: LayoutVariant }, b: { variant: LayoutVariant }) =>
  VARIANT_ORDER.indexOf(a.variant) - VARIANT_ORDER.indexOf(b.variant);

/** The result of a build in the chat. */
export function resultOf(messages: readonly ChatMessage[], buildId: string): ResultPart | null {
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const part of message.parts) {
      if (part.type === 'result' && part.buildId === buildId) return part;
    }
  }
  return null;
}

/** The result with one failed variant replaced, or added. */
export function withFailed(part: ResultPart, entry: FailedVariant): ResultPart {
  const failed = (part.failed ?? []).filter((item) => item.variant !== entry.variant);
  return { ...part, failed: [...failed, entry].sort(byOrder) };
}

/** The result with a rebuilt variant in place: its deck, its audit and the advice made again. */
export function withVariant(
  part: ResultPart,
  variant: LayoutVariant,
  deckId: string,
  review: { errors: number; warnings: number } | null,
): ResultPart {
  const variants = [
    ...part.variants.filter((item) => item.variant !== variant),
    { variant, deckId },
  ].sort(byOrder);
  // One variant without an audit leaves the build without a comparable one, as a build does.
  const reviews = part.reviews && review ? { ...part.reviews, [deckId]: review } : null;
  const failed = (part.failed ?? []).filter((item) => item.variant !== variant);
  const { failed: _previous, ...rest } = part;
  return {
    ...rest,
    variants,
    reviews,
    recommended: recommend(
      variants.map((item) => ({
        ...item,
        errors: reviews?.[item.deckId]?.errors ?? null,
        warnings: reviews?.[item.deckId]?.warnings ?? null,
      })),
    ),
    ...(failed.length ? { failed } : {}),
  };
}
