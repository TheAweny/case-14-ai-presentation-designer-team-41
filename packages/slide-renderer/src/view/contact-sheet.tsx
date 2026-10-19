import type { JSX } from 'react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '../slide-view.js';

export interface ContactSheetProps {
  /** What the sheet is comparing, for the host's language. */
  readonly title: string;
  readonly profile: DesignSystem;
  readonly slides: readonly SlideIr[];
}

/**
 * The three renderings of one visual, side by side. The sheet shows the editor's SlideIR.
 * It does not decide whether the concepts differ: that is the structural signature.
 */
export function ContactSheet({ title, profile, slides }: ContactSheetProps): JSX.Element {
  return (
    <section data-contact-sheet="true" aria-label={title}>
      {slides.map((slide) => (
        <figure key={`${slide.variant}-${slide.slideId}`} data-variant={slide.variant}>
          <SlideView slide={slide} profile={profile} thumbnail label={slide.variant} />
        </figure>
      ))}
    </section>
  );
}
