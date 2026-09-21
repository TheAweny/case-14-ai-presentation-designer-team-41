import type { Deck } from '../../lib/deck-source';
import { DEMO_DESIGN_SYSTEM } from './design-system';
import { DEMO_SLIDES } from './slides';

export const DEMO_DECK_ID = 'demo';

export const DEMO_DECK: Deck = {
  deckId: DEMO_DECK_ID,
  title: 'Цифровой дизайнер презентаций',
  variant: 'balanced',
  slideSize: { cx: DEMO_DESIGN_SYSTEM.grid.slideCx, cy: DEMO_DESIGN_SYSTEM.grid.slideCy },
  designSystem: DEMO_DESIGN_SYSTEM,
  slides: DEMO_SLIDES,
};
