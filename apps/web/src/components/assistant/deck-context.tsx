'use client';

import { createContext, useContext } from 'react';
import type { Paragraph, SlideIr } from '@lct/contracts';
import type { SlideRef } from '@/lib/slide-context';

/** Какие объекты подсветить или открыть: слайд и объекты на нём, пусто — слайд целиком. */
export type DeckTarget = Pick<SlideRef, 'slideId' | 'elementIds'>;

/**
 * Мост между ассистентом и редактором колоды. Панель «Ассистент» — узел, который редактор
 * получает готовым, а объекты, выделение и холст живут в редакторе: через мост поле ассистента
 * берёт контекст (закреплённые чипы и призрак выделения), а чипы подсвечивают и открывают
 * объекты на холсте. Вне редактора моста нет — чипы там только показывают.
 */
export interface AssistantDeckBridge {
  /** Слайды колоды сейчас, с живым видом правки: по ним чипы узнают, что устарели. */
  readonly slides: readonly SlideIr[];
  /** Закреплённые ссылки в поле. */
  readonly refs: readonly SlideRef[];
  /** Текущее выделение как предложение контекста; null — нечего предлагать. */
  readonly ghost: SlideRef | null;
  pin(ref: SlideRef): void;
  unpin(key: string): void;
  /** Убрать призрак: вернётся с новым выделением. */
  dismissGhost(): void;
  /** Сообщение ушло: закреплённое ушло с ним, призрак этого выделения больше не предлагается. */
  sent(): void;
  /** Подсветить объекты на холсте (или слайд в списке), не меняя выделения; null — снять. */
  highlight(target: DeckTarget | null): void;
  /** Открыть слайд и выделить объекты. */
  reveal(target: DeckTarget): void;
  /**
   * Счётчик просьб поставить фокус в поле: «Спросить ассистента» и Ctrl+L. Поле может
   * смонтироваться уже после просьбы (вкладка только открылась), поэтому просьбу забирают:
   * `takeFocus()` отвечает `true` один раз.
   */
  readonly focusRequest: number;
  takeFocus(): boolean;
  /**
   * Записать текст объекта правкой журнала: так пишет агент (`edit_slide`), и человек отменяет
   * её, как свою, через Ctrl+Z.
   */
  writeText(slideId: string, elementId: string, paragraphs: readonly Paragraph[]): void;
  /** Explicitly insert an image on the current slide, only at a readable size. */
  insertImage?(input: {
    file: File;
    minimumSizeEmu: number;
  }): 'inserted' | 'cannot-fit' | 'no-slide';
}

const BridgeContext = createContext<AssistantDeckBridge | null>(null);

export const AssistantDeckProvider = BridgeContext.Provider;

export function useAssistantDeck(): AssistantDeckBridge | null {
  return useContext(BridgeContext);
}
