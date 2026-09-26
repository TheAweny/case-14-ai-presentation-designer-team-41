import type { Paragraph, SlideElement, SlideIr } from '@lct/contracts';
import { issue } from '../issue.js';
import { runLook, typeStyleOf } from '../text.js';
import type { AuditContext, AuditIssue } from '../types.js';

interface Use {
  readonly slideId: string;
  readonly elementId: string;
}

function paragraphsOf(element: SlideElement): readonly Paragraph[] {
  if (element.kind === 'text') return element.paragraphs;
  if (element.kind === 'decor') return element.paragraphs ?? [];
  return [];
}

/** Typefaces an element is set in, as the renderer resolves them. */
function fontsOf(element: SlideElement, context: AuditContext, slideCy: number): Set<string> {
  const fonts = new Set<string>();
  for (const paragraph of paragraphsOf(element)) {
    for (const run of paragraph.runs) {
      if (run.text.trim() === '') continue;
      const { font } = runLook(run, element, context.designSystem, slideCy);
      if (font) fonts.add(font);
    }
  }
  if (element.kind === 'table') {
    const font = typeStyleOf(context.designSystem, element)?.font.trim();
    if (font) fonts.add(font);
  }
  return fonts;
}

/**
 * Typefaces the deck is set in that are missing where it is shown. The file keeps them and a
 * machine that has them shows the deck as designed; this screen shows a stand-in, whose metrics
 * may break lines elsewhere. One issue per typeface, on its first use, not one per text box.
 */
export function checkFontUnavailable(
  slides: readonly SlideIr[],
  context: AuditContext,
): AuditIssue[] {
  const isMissing = context.isFontMissing;
  if (!isMissing) return [];
  const uses = new Map<string, Use[]>();
  for (const slide of slides) {
    for (const element of slide.elements) {
      for (const font of fontsOf(element, context, slide.slideCy)) {
        if (!isMissing(font)) continue;
        const list = uses.get(font) ?? [];
        list.push({ slideId: slide.slideId, elementId: element.elementId });
        uses.set(font, list);
      }
    }
  }

  return [...uses].flatMap(([font, list]) => {
    const [first] = list;
    if (!first) return [];
    const found = issue({
      checkId: 'font-unavailable',
      kind: 'missing',
      level: 'warning',
      slideId: first.slideId,
      elementId: first.elementId,
      // The typeface is missing from the whole deck, not from one box: nothing to outline.
      box: null,
      params: {
        font,
        slides: new Set(list.map((use) => use.slideId)).size,
        elements: list.length,
      },
      fixability: 'manual',
    });
    // The typeface is the problem, wherever it first appears: the id must not move with it.
    return [{ ...found, issueId: `font-unavailable:${font}` }];
  });
}
