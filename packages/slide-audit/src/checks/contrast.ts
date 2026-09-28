import type { ColorRole, DesignSystem, SlideIr } from '@lct/contracts';
import { decorFill, paint, resolveColor, slideSizeOf } from '@lct/slide-renderer';
import { contrastRatio, over, parseHex, toHex, type Rgb } from '../color.js';
import { area, intersect, type Polygon } from '../geometry.js';
import { issue } from '../issue.js';
import { profileOf } from '../profile.js';
import { footprint, isBlank, runLook, typeStyleOf, type TextElement } from '../text.js';
import type { AuditContext, AuditIssue } from '../types.js';

/** WCAG: large text needs 3:1, and nothing below 3:1 reads comfortably at any size. */
const LARGE_TEXT_RATIO = 3;
/** Share of the text a surface has to lie under to count as its background. */
const UNDER = 0.5;

/** Roles tried, in order, for a colour that reads on the background. */
const TEXT_ROLES: readonly ColorRole[] = [
  'text',
  'text-on-accent',
  'text-muted',
  'background',
  'surface',
];

/** WCAG large text: 18 pt, or 14 pt in bold. */
function isLarge(sizePt: number, bold: boolean): boolean {
  return sizePt >= 18 || (bold && sizePt >= 14);
}

/**
 * The colour painted under a polygon, looking down from the element at `index`: the first filled
 * shape that lies under most of it, blended by its opacity, else the slide background. Null when
 * a picture, a table or a chart is in the way, whose colours this check cannot know.
 */
function backgroundUnder(
  slide: SlideIr,
  index: number,
  polygon: Polygon,
  context: AuditContext,
): Rgb | null {
  const { designSystem } = context;
  const size = slideSizeOf(slide);
  const whole = area(polygon);
  for (let i = index - 1; i >= 0; i -= 1) {
    const element = slide.elements[i];
    if (!element) continue;
    const shared = intersect(polygon, footprint(element, slide.slideId, context));
    if (shared.length < 3 || area(shared) < UNDER * whole) continue;
    if (element.kind !== 'decor') return null;
    const fill = decorFill(element, size, designSystem);
    const rgb = fill === null ? null : parseHex(fill);
    if (fill === null) continue;
    if (!rgb) return null;
    const opacity = element.opacity ?? 1;
    if (opacity >= 1) return rgb;
    const below = backgroundUnder(slide, i, polygon, context);
    return below ? over(rgb, below, opacity) : null;
  }
  return parseHex(
    resolveColor(designSystem.palette, slide.background ?? 'background', 'background', 'surface'),
  );
}

/** The role whose colour reads best on `background`, first among those that pass. */
function bestRole(designSystem: DesignSystem, background: Rgb, required: number): ColorRole | null {
  let best: { role: ColorRole; ratio: number } | null = null;
  for (const role of TEXT_ROLES) {
    const hex = designSystem.palette.find((entry) => entry.role === role)?.hex;
    const rgb = hex ? parseHex(hex) : null;
    if (!rgb) continue;
    const ratio = contrastRatio(rgb, background);
    if (ratio >= required) return role;
    if (!best || ratio > best.ratio) best = { role, ratio };
  }
  return best && best.ratio >= LARGE_TEXT_RATIO ? best.role : null;
}

/**
 * Text against what is painted under it, by the WCAG contrast ratio. Below 3:1 no text reads well
 * and it is an error; normal text between that and the profile threshold is a warning.
 */
export function checkContrast(slide: SlideIr, context: AuditContext): AuditIssue[] {
  const { designSystem } = context;
  const required = profileOf(context.profile).minContrastRatio;
  const issues: AuditIssue[] = [];

  slide.elements.forEach((element, index) => {
    if (element.kind !== 'text' || isBlank(element.paragraphs)) return;
    const background = backgroundUnder(
      slide,
      index,
      footprint(element, slide.slideId, context),
      context,
    );
    if (!background) return;
    const worst = worstRun(element, background, designSystem, slide.slideCy, required);
    if (!worst || worst.ratio >= worst.required) return;

    const level = worst.ratio < LARGE_TEXT_RATIO ? 'error' : 'warning';
    const role = bestRole(designSystem, background, worst.required);
    const fix = role
      ? [{ op: 'set-color' as const, elementId: element.elementId, colorRole: role }]
      : null;
    issues.push(
      issue({
        checkId: 'contrast',
        kind: 'text',
        level,
        slideId: slide.slideId,
        elementId: element.elementId,
        box: element.box,
        params: {
          ratio: Math.round(worst.ratio * 100) / 100,
          required: worst.required,
          color: toHex(worst.color),
          background: toHex(background),
        },
        fix,
        fixability: fix ? 'auto' : 'manual',
      }),
    );
  });
  return issues;
}

interface RunContrast {
  readonly ratio: number;
  readonly required: number;
  readonly color: Rgb;
}

/** The run that falls furthest short of what its size requires. */
function worstRun(
  element: TextElement,
  background: Rgb,
  designSystem: DesignSystem,
  slideCy: number,
  required: number,
): RunContrast | null {
  const style = typeStyleOf(designSystem, element);
  const inherited = paint(designSystem.palette, style?.colorRole ?? 'text', 'text');
  const opacity = element.opacity ?? 1;
  let worst: RunContrast | null = null;
  for (const paragraph of element.paragraphs) {
    for (const run of paragraph.runs) {
      if (run.text.trim() === '') continue;
      const own = parseHex(run.color) ?? parseHex(inherited);
      if (!own) continue;
      const color = opacity < 1 ? over(own, background, opacity) : own;
      const look = runLook(run, element, designSystem, slideCy);
      const needed = isLarge(look.sizePt, look.bold) ? LARGE_TEXT_RATIO : required;
      const ratio = contrastRatio(color, background);
      if (!worst || ratio / needed < worst.ratio / worst.required) {
        worst = { ratio, required: needed, color };
      }
    }
  }
  return worst;
}
