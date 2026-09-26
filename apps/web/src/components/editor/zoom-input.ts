/** Ctrl/Cmd+колесо. Пустой список ключей у библиотеки значит «всегда», поэтому это функция. */
export function wheelActivatesZoom(keys: readonly string[]): boolean {
  return keys.includes('Control') || keys.includes('Meta');
}

/** Пиксель CSS при 96 dpi: в дюйме 914400 EMU. */
export const EMU_PER_CSS_PX = 9525;

/** Шаги масштаба в меню — доли размера слайда в шаблоне, как в редакторах презентаций. */
export const ZOOM_PRESETS = [0.5, 1, 2] as const;

/**
 * Масштаб холста в процентах от размера слайда в шаблоне: 100 % — слайд ровно такой, каким
 * он уйдёт в .pptx. Лист уже вписан в область вёрсткой, поэтому единица библиотеки — это
 * «вписать», и процент считается от вписанной ширины.
 *
 * Размер слайда неизвестен (ещё не измерен) — остаётся доля от вписанного листа.
 */
export function zoomPercent(scale: number, fittedWidthPx: number, slideWidthEmu: number): number {
  return Math.round(scale * fitRatio(fittedWidthPx, slideWidthEmu) * 100);
}

/** Масштаб библиотеки, при котором слайд займёт заданную долю своего размера в шаблоне. */
export function zoomScaleFor(ratio: number, fittedWidthPx: number, slideWidthEmu: number): number {
  return ratio / fitRatio(fittedWidthPx, slideWidthEmu);
}

/** Во сколько раз вписанный лист меньше слайда в шаблоне. */
function fitRatio(fittedWidthPx: number, slideWidthEmu: number): number {
  if (!(fittedWidthPx > 0) || !(slideWidthEmu > 0)) return 1;
  return fittedWidthPx / (slideWidthEmu / EMU_PER_CSS_PX);
}
