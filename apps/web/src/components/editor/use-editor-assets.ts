'use client';

import { useEffect, useState } from 'react';
import { ASSETS_TIMEOUT_MS, decodeImages, loadFonts, settleWithin } from '@/lib/asset-readiness';

export interface EditorAssets {
  readonly fonts: boolean;
  readonly images: boolean;
}

/**
 * Готовы ли шрифты шаблона и картинки открытого слайда. Каждое становится true один раз и
 * больше не сбрасывается: после первого кадра ждать нечего. Потолок — `ASSETS_TIMEOUT_MS`.
 */
export function useEditorAssets(fonts: readonly string[], images: readonly string[]): EditorAssets {
  const [ready, setReady] = useState<EditorAssets>({ fonts: false, images: false });

  useEffect(() => {
    let cancelled = false;
    const mark = (key: keyof EditorAssets) => () => {
      if (!cancelled) setReady((current) => (current[key] ? current : { ...current, [key]: true }));
    };
    void settleWithin(loadFonts(fonts, document.fonts), ASSETS_TIMEOUT_MS).then(mark('fonts'));
    void settleWithin(
      decodeImages(images, () => new Image()),
      ASSETS_TIMEOUT_MS,
    ).then(mark('images'));
    return () => {
      cancelled = true;
    };
  }, [fonts, images]);

  return ready;
}
