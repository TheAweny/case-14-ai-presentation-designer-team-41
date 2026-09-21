import { describe, expect, it } from 'vitest';
import { DeckNotFoundError, mediaUrls } from '../lib/deck-source';
import { DEMO_DECK, DEMO_DECK_ID } from './demo-deck';
import { createDemoDeckSource } from './demo-deck-source';

describe('createDemoDeckSource', () => {
  it('находит демо-колоду по id', async () => {
    await expect(createDemoDeckSource().getDeck(DEMO_DECK_ID)).resolves.toEqual(DEMO_DECK);
  });

  it('отдаёт копию: правка ответа не меняет следующий', async () => {
    const source = createDemoDeckSource();
    const first = await source.getDeck(DEMO_DECK_ID);
    first.slides[0]?.elements.splice(0);
    const second = await source.getDeck(DEMO_DECK_ID);
    expect(second.slides[0]?.elements.length).toBeGreaterThan(0);
  });

  it('на неизвестный id отвечает DeckNotFoundError', async () => {
    const error: unknown = await createDemoDeckSource()
      .getDeck('missing')
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeckNotFoundError);
    expect(error).toMatchObject({ name: 'DeckNotFoundError', deckId: 'missing' });
  });

  it('адреса картинок не знает: слайд нарисует рамку', () => {
    const source = createDemoDeckSource();
    const parts = DEMO_DECK.slides
      .flatMap((slide) => slide.elements)
      .flatMap((element) => (element.kind === 'image' ? [element.mediaPart] : []));
    expect(parts.length).toBeGreaterThan(0);
    for (const part of parts) expect(source.mediaUrl(DEMO_DECK_ID, part)).toBeNull();
    expect(mediaUrls(source, DEMO_DECK)).toEqual({});
  });

  it('собирает только те адреса, которые источник отдал', () => {
    const urls = mediaUrls(
      {
        async getDeck() {
          return DEMO_DECK;
        },
        mediaUrl(_deckId, part) {
          return part.endsWith('.png') ? `https://cdn.test/${part}` : null;
        },
      },
      DEMO_DECK,
    );
    expect(urls['ppt/media/image1.png']).toBe('https://cdn.test/ppt/media/image1.png');
    expect(urls['media/editor-preview.png']).toBe('https://cdn.test/media/editor-preview.png');
  });
});
