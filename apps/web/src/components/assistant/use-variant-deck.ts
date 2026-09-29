'use client';

import { useEffect, useState } from 'react';
import { mediaUrls, type Deck } from '@/lib/deck-source';
import { deckSource } from '@/mocks/sources';
import { createHttpDeckSource } from '@/lib/http-generation';

/** Колода варианта с адресами её картинок: этого хватает для просмотра, показа и экспорта. */
export interface VariantDeck {
  readonly deck: Deck;
  readonly media: Readonly<Record<string, string>>;
}

/**
 * Колоды вариантов, уже запрошенные во вкладке. Итог сборки открывают по нескольку раз — просмотр,
 * показ, экспорт, — и каждый раз ходить к источнику незачем. Сбой из кеша уходит: следующая
 * попытка спросит снова.
 */
const loaded = new Map<string, Promise<VariantDeck>>();

// Summary data belongs to its own cache: the editor and export still need a full imported deck.
const previewSource = createHttpDeckSource({ summary: true });
const previews = new Map<string, Promise<Deck>>();

export function loadVariantPreview(deckId: string): Promise<Deck> {
  let pending = previews.get(deckId);
  if (!pending) {
    pending = previewSource.getDeck(deckId);
    previews.set(deckId, pending);
    pending.catch(() => previews.delete(deckId));
  }
  return pending;
}

export function loadVariantDeck(deckId: string): Promise<VariantDeck> {
  let pending = loaded.get(deckId);
  if (!pending) {
    pending = deckSource
      .getDeck(deckId)
      .then((deck) => ({ deck, media: mediaUrls(deckSource, deck) }));
    pending.catch(() => loaded.delete(deckId));
    loaded.set(deckId, pending);
  }
  return pending;
}

export type VariantDeckState =
  | { readonly status: 'idle' | 'loading' | 'failed'; readonly value: null }
  | { readonly status: 'ready'; readonly value: VariantDeck };

/** Колода варианта по id; null — ничего не грузить. */
export function useVariantDeck(deckId: string | null): VariantDeckState {
  const [state, setState] = useState<{ deckId: string | null; value: VariantDeckState }>({
    deckId: null,
    value: { status: 'idle', value: null },
  });

  useEffect(() => {
    if (!deckId) return;
    let live = true;
    loadVariantDeck(deckId).then(
      (value) => {
        if (live) setState({ deckId, value: { status: 'ready', value } });
      },
      () => {
        if (live) setState({ deckId, value: { status: 'failed', value: null } });
      },
    );
    return () => {
      live = false;
    };
  }, [deckId]);

  if (!deckId) return { status: 'idle', value: null };
  // Ответ пришёл для прежнего id — для нынешнего колода ещё грузится.
  return state.deckId === deckId ? state.value : { status: 'loading', value: null };
}

/** Картинка по имени части файла: то, что ждут `SlideView` и показ. */
export function mediaResolver(media: Readonly<Record<string, string>>) {
  return (part: string) => media[part] ?? null;
}
