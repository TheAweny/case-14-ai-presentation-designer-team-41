import type { JSX } from 'react';

export interface SlideViewProps {
  /** One slide of the engine IR. Typed with the IR contract once that schema lands. */
  readonly slide: unknown;
  /** Template profile: palette, type scale and grid extracted from the uploaded template. */
  readonly profile: unknown;
}

/**
 * Renders a single slide of the IR. The element tree is driven entirely by the IR and the
 * template profile, which is what keeps the renderer usable with a template nobody has seen.
 */
export function SlideView(_props: SlideViewProps): JSX.Element {
  return <section data-slide-root="true" />;
}
