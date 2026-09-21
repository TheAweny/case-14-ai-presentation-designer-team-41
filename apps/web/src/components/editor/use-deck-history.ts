'use client';

import { useCallback, useState } from 'react';
import type { Box, SlideIr } from '@lct/contracts';
import { commitMoves, createDeckHistory, redoDeck, recordChange, undoDeck } from '@lct/deck-ops';

export interface ElementMove {
  readonly elementId: string;
  readonly box: Box;
}

/**
 * The deck the editor shows, plus one undo step per gesture. The source slides stay put:
 * a new deck id list replaces the journal.
 */
export function useDeckHistory(slides: readonly SlideIr[]) {
  const [history, setHistory] = useState(() => createDeckHistory(slides));
  const signature = slides.map((slide) => slide.slideId).join('\0');
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setHistory(createDeckHistory(slides));
  }

  const move = useCallback((slideId: string, moves: readonly ElementMove[]) => {
    setHistory((current) => recordChange(current, commitMoves(current.slides, { slideId, moves })));
  }, []);
  const undo = useCallback(() => {
    setHistory((current) => undoDeck(current));
  }, []);
  const redo = useCallback(() => {
    setHistory((current) => redoDeck(current));
  }, []);

  return { slides: history.slides, move, undo, redo };
}
