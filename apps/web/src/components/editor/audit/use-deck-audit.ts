'use client';

import { useMemo } from 'react';
import type { DesignSystem, SlideIr } from '@lct/contracts';
import { auditDeckWide, auditSlide, type AuditContext, type AuditIssue } from '@lct/slide-audit';
import type { SlideLayout } from '@/lib/deck-source';
import { isFontMissing } from '@/lib/font-availability';
import { useFontAvailability } from '@/components/editor/font-availability-context';
import type { TextHeights } from '@/components/editor/audit/text-measurer';
import { sortIssues } from '@/components/editor/audit/deck-audit';

/**
 * Живой аудит колоды — как проверка кода в редакторе: пересчитывается после каждой правки,
 * локально и без модели. Высоту и ширину набранного текста берёт из замера в браузере; пока
 * слайд не измерен, переполнение — то, что записала вёрстка.
 */
export function useDeckAudit({
  slides,
  designSystem,
  layouts,
  heights,
}: {
  slides: readonly SlideIr[];
  designSystem: DesignSystem;
  layouts: readonly SlideLayout[];
  heights: TextHeights;
}): readonly AuditIssue[] {
  const fonts = useFontAvailability();

  const context = useMemo<AuditContext>(() => {
    const byPattern = new Map(layouts.map((layout) => [layout.slide.patternId, layout.slide]));
    return {
      designSystem,
      textHeight: (slideId, elementId) => heights.get(slideId)?.get(elementId)?.height,
      textExtent: (slideId, elementId) => heights.get(slideId)?.get(elementId),
      isFontMissing: (family) => isFontMissing(fonts, family),
      layoutFor: (patternId) => byPattern.get(patternId),
    };
  }, [designSystem, layouts, heights, fonts]);

  return useMemo(
    () =>
      sortIssues(
        [
          ...slides.flatMap((slide) => auditSlide(slide, context)),
          ...auditDeckWide(slides, context),
        ],
        slides,
      ),
    [slides, context],
  );
}
