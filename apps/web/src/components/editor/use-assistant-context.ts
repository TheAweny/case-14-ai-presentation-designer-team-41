'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SlideIr } from '@lct/contracts';
import type { DeckSelection } from '@lct/deck-ops';
import type { AssistantDeckBridge, DeckTarget } from '@/components/assistant/deck-context';
import {
  addRef,
  createSlideRef,
  ghostRef,
  refKey,
  removeRef,
  resolveRef,
  type SlideRef,
} from '@/lib/slide-context';

/**
 * Контекст ассистента в редакторе: закреплённые чипы поля, призрак выделения и подсветка
 * объектов под чипом. Живёт в оболочке редактора, а не в поле: вкладка «Ассистент»
 * размонтируется, когда открыта другая, а закреплённое должно её пережить.
 */
export function useAssistantContext({
  slides,
  slideId,
  selectedIds,
  active,
  reveal,
  writeText,
}: {
  slides: readonly SlideIr[];
  /** Открытый слайд. */
  slideId: string | undefined;
  selectedIds: readonly string[];
  /** Вкладка «Ассистент» на виду: только тогда выделение предлагается призраком. */
  active: boolean;
  reveal: (target: DeckSelection) => void;
  /** Правка текста журналом редактора: ею агент пишет в черновик. */
  writeText: AssistantDeckBridge['writeText'];
}) {
  const [refs, setRefs] = useState<readonly SlideRef[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [hovered, setHovered] = useState<DeckTarget | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const pendingFocus = useRef(false);

  // Убранный призрак возвращается с новым выделением: отказ — только от этого набора.
  const selectionKey =
    slideId && selectedIds.length > 0 ? refKey({ slideId, elementIds: selectedIds }) : null;
  useEffect(() => {
    setDismissed((current) => (current === selectionKey ? current : null));
  }, [selectionKey]);

  const ghost = useMemo(
    () => (active ? ghostRef(slides, slideId, selectedIds, refs, dismissed) : null),
    [active, dismissed, refs, selectedIds, slideId, slides],
  );

  const requestFocus = useCallback(() => {
    pendingFocus.current = true;
    setFocusRequest((count) => count + 1);
  }, []);

  /**
   * Положить в поле объекты слайда (пусто — слайд целиком) и позвать туда фокус. Отдаёт,
   * получилось ли: объектов могло уже не быть.
   */
  const add = useCallback(
    (targets: readonly DeckTarget[]) => {
      const made = targets
        .map((target) => createSlideRef(slides, target.slideId, target.elementIds))
        .filter((ref): ref is SlideRef => ref !== null);
      if (made.length === 0) return false;
      setRefs((current) => made.reduce((list, ref) => addRef(list, ref), current));
      requestFocus();
      return true;
    },
    [requestFocus, slides],
  );

  const bridge = useMemo<AssistantDeckBridge>(
    () => ({
      slides,
      refs,
      ghost,
      pin: (ref) => setRefs((current) => addRef(current, ref)),
      unpin: (key) => setRefs((current) => removeRef(current, key)),
      dismissGhost: () => {
        if (ghost) setDismissed(refKey(ghost));
      },
      sent: () => {
        setRefs([]);
        // Выделение уже ушло с сообщением — призраком или закреплённым чипом (тогда призрака
        // не было). Второй раз его не предлагаем, пока не выделят другое.
        const current =
          slideId && selectedIds.length > 0 ? createSlideRef(slides, slideId, selectedIds) : null;
        if (current) setDismissed(refKey(current));
      },
      highlight: setHovered,
      reveal: (target) => {
        const resolved = resolveRef(slides, target);
        if (resolved.status === 'stale') return;
        reveal({ slideId: target.slideId, elementIds: resolved.elementIds });
      },
      focusRequest,
      takeFocus: () => {
        const pending = pendingFocus.current;
        pendingFocus.current = false;
        return pending;
      },
      writeText,
    }),
    [focusRequest, ghost, refs, reveal, selectedIds, slideId, slides, writeText],
  );

  /**
   * Что подсвечивает чип под курсором. Объекты открытого слайда — рамкой на холсте; слайд
   * целиком или объекты другого слайда — миниатюрой в списке.
   */
  const highlight = useMemo(() => {
    if (!hovered) return { elementIds: null, slideId: null };
    const resolved = resolveRef(slides, hovered);
    if (resolved.status === 'stale') return { elementIds: null, slideId: null };
    const here = hovered.slideId === slideId && resolved.elementIds.length > 0;
    return {
      elementIds: here ? resolved.elementIds : null,
      slideId: here ? null : hovered.slideId,
    };
  }, [hovered, slideId, slides]);

  return { bridge, add, highlight };
}
