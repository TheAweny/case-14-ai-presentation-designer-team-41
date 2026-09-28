import type { DesignSystem, SlideIr } from '@lct/contracts';
import { SlideView } from '@lct/slide-renderer';

/** The engine-rendered first slide, with the IR renderer kept for demo and legacy data. */
export function SlidePreview({
  slide,
  profile,
  previewUrl,
}: {
  slide: SlideIr;
  profile: DesignSystem;
  previewUrl?: string;
}) {
  return previewUrl ? (
    <img src={previewUrl} alt="" aria-hidden className="size-full object-cover" />
  ) : (
    <SlideView slide={slide} profile={profile} thumbnail />
  );
}
