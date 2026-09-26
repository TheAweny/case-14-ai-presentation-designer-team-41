import type { CSSProperties } from 'react';
import type { SlideElement } from '@lct/contracts';
import { boxStyle, round, type SlideSize } from '../geometry.js';

/**
 * Attributes the editor finds a mark by: its kind, role and element id, plus the lock.
 *
 * A thumbnail carries none of them. A miniature of a slide is a picture, not a second set of
 * targets, and a query for `[data-element-id]` must never land on a thumbnail strip.
 */
export function markHooks(
  element: Pick<SlideElement, 'kind' | 'role' | 'elementId' | 'locked'>,
  thumbnail: boolean,
): Record<string, string> {
  if (thumbnail) return {};
  return {
    'data-kind': element.kind,
    'data-role': element.role,
    'data-element-id': element.elementId,
    ...(element.locked ? { 'data-locked': 'true' } : null),
  };
}

/**
 * Placement of an element plus what every kind shares: rotation about the centre of the box,
 * which is the default origin of a CSS transform, and opacity.
 */
export function markStyle(
  element: Pick<SlideElement, 'box' | 'rotation' | 'opacity'>,
  size: SlideSize,
): CSSProperties {
  const rotation = element.rotation ?? 0;
  const opacity = element.opacity ?? 1;
  return {
    ...boxStyle(element.box, size),
    ...(rotation !== 0 ? { transform: `rotate(${round(rotation)}deg)` } : null),
    ...(opacity < 1 ? { opacity: round(Math.max(opacity, 0)) } : null),
  };
}
