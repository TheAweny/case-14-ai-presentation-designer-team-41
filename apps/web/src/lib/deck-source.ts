import type { DesignSystem, LayoutVariantName, SlideIr } from '@lct/contracts';

/**
 * Откуда редактор берёт колоду. Компоненты знают только этот интерфейс: сейчас за ним демо-данные,
 * потом HTTP-клиент API (в разработке — поверх моков MSW), и компоненты этого не заметят.
 */

/** Размер слайда в EMU. Берётся из шаблона: пропорции у разных шаблонов разные. */
export interface SlideSize {
  readonly cx: number;
  readonly cy: number;
}

/**
 * Макет загруженного шаблона, с которого можно начать новый слайд.
 *
 * Заготовку собирает движок из макета шаблона и его паттерна: оформление макета и пустые текстовые
 * рамки на местах его плейсхолдеров, с `sourceShapeId` плейсхолдера. Редактор заготовку только
 * копирует: придумывать раскладку на стороне интерфейса значило бы хардкодить под шаблон.
 */
export interface SlideLayout {
  /** Имя макета из файла шаблона, как его видит автор шаблона. */
  readonly name: string;
  /** Заготовка слайда. `patternId` — паттерн макета, он же отличает один макет от другого. */
  readonly slide: SlideIr;
}

/**
 * Колода так, как её видит редактор: один вариант вёрстки со слайдами и дизайн-системой шаблона.
 *
 * Тип собран здесь из контрактных, потому что в `@lct/contracts` колоды целиком нет: есть
 * отдельные SlideIR и DesignSystem, но нет того, что связывает их в одну колоду.
 */
export interface Deck {
  readonly deckId: string;
  readonly renderedPdfUrl?: string;
  readonly title: string;
  readonly variant: LayoutVariantName;
  readonly slideSize: SlideSize;
  readonly designSystem: DesignSystem;
  /** По порядку показа: `slides[i].index === i`. */
  readonly slides: readonly SlideIr[];
  /** Макеты шаблона для нового слайда, в порядке файла. Пустой слайд редактор добавляет сам. */
  readonly layouts: readonly SlideLayout[];
}

/** Колоды с таким id нет. Отличаем от прочих сбоев, чтобы интерфейс показал понятный ответ. */
export class DeckNotFoundError extends Error {
  override readonly name = 'DeckNotFoundError';
  readonly deckId: string;

  constructor(deckId: string) {
    super(`Deck not found: ${deckId}`);
    this.deckId = deckId;
  }
}

/**
 * Адреса картинок колоды и её макетов, которые источник смог отдать. Остальные части на слайде —
 * рамка.
 */
export function mediaUrls(source: DeckSource, deck: Deck): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const slide of [...deck.slides, ...deck.layouts.map((layout) => layout.slide)]) {
    for (const element of slide.elements) {
      if (element.kind !== 'image' || urls[element.mediaPart]) continue;
      const url = source.mediaUrl(deck.deckId, element.mediaPart);
      if (url) urls[element.mediaPart] = url;
    }
  }
  return urls;
}

export interface DeckSource {
  /** Колода по id. Колоды нет — промис отклоняется с `DeckNotFoundError`. */
  getDeck(deckId: string): Promise<Deck>;
  /**
   * Адрес картинки по `mediaPart` из SlideIR или null, если отдать её браузеру нечем: тогда
   * на слайде рисуется только рамка. Синхронный, чтобы адрес можно было поставить прямо в разметку.
   */
  mediaUrl(deckId: string, mediaPart: string): string | null;
}
