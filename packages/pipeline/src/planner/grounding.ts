import type { ContentPack, DeckPlan, PlanBlock } from '@lct/contracts';

/** Something in a plan that the content pack does not back, stated for the planner to fix. */
export interface GroundingProblem {
  readonly slideId: string | null;
  readonly message: string;
}

const NUMBER = /\d+(?:[.,]\d+)?\s?%?/g;

/**
 * Text as a quote is compared: markdown emphasis and code marks dropped, dashes, quotes and ё
 * unified, whitespace collapsed. Models quote what a passage says, not how it was typeset.
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`]+/g, '')
    .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
    .replace(/[«»"“”„]/g, '"')
    .replace(/[—–−]/g, '-')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The plan with each source pointing at the passage its quote is actually in. A model that
 * quotes a sentence word for word but names the neighbouring passage has the fact right and the
 * reference wrong; the reference is corrected here rather than reported. A quote found nowhere
 * is left alone, for the grounding check to report.
 */
export function repairSources(
  plan: DeckPlan,
  pack: ContentPack,
): { plan: DeckPlan; moved: number } {
  const items = pack.items.map((item) => ({ id: item.itemId, text: normalise(item.text) }));
  const fixed = structuredClone(plan);
  let moved = 0;
  const repair = (source: { itemId: string; quote: string }) => {
    const quote = normalise(source.quote);
    if (items.find((item) => item.id === source.itemId)?.text.includes(quote)) return;
    const home = items.find((item) => item.text.includes(quote));
    if (home !== undefined) {
      source.itemId = home.id;
      moved += 1;
    }
  };
  for (const slide of fixed.slides) {
    slide.sources.forEach(repair);
    for (const block of slide.blocks) {
      if (block.kind === 'table' || block.kind === 'chart') block.sources.forEach(repair);
      if (block.kind === 'kpi') block.items.forEach((item) => item.sources.forEach(repair));
    }
  }
  return { plan: fixed, moved };
}

function numbersIn(text: string): string[] {
  return (text.match(NUMBER) ?? []).map((n) => n.replace(/\s/g, '').replace(',', '.'));
}

function blockText(block: PlanBlock): string[] {
  switch (block.kind) {
    case 'paragraph':
      return [block.text];
    case 'bullets':
      return [...block.items];
    case 'quote':
      return [block.text];
    case 'table':
      return [...block.headers, ...block.rows.flat()];
    case 'chart':
      return [...block.categories, ...block.series.flatMap((s) => s.values.map((v) => String(v)))];
    case 'kpi':
      return block.items.map((item) => item.value);
    case 'image':
      return [];
  }
}

function blockSources(block: PlanBlock): { itemId: string; quote: string }[] {
  switch (block.kind) {
    case 'table':
    case 'chart':
      return [...block.sources];
    case 'kpi':
      return block.items.flatMap((item) => item.sources);
    default:
      return [];
  }
}

/**
 * What in a plan the pack does not support: a slide count other than the one asked for, repeated
 * slide ids, sources that name no item or misquote it, and figures that appear nowhere in the
 * pack. Figures are the check that matters most: a number on a slide that the user never gave
 * is the one mistake a deck must not make.
 */
export function checkGrounding(
  plan: DeckPlan,
  pack: ContentPack,
  slideCount?: number,
): GroundingProblem[] {
  const problems: GroundingProblem[] = [];
  if (slideCount !== undefined && plan.slides.length !== slideCount) {
    problems.push({
      slideId: null,
      message: `The deck has ${plan.slides.length} slides; ${slideCount} were asked for.`,
    });
  }
  if (plan.briefId !== pack.briefId) {
    problems.push({ slideId: null, message: `briefId must be "${pack.briefId}".` });
  }
  const seen = new Set<string>();
  const items = new Map(pack.items.map((item) => [item.itemId, normalise(item.text)]));
  const corpus = normalise([pack.goal, ...pack.items.map((item) => item.text)].join(' '));
  const known = new Set(numbersIn(corpus));

  for (const slide of plan.slides) {
    if (seen.has(slide.slideId)) {
      problems.push({ slideId: slide.slideId, message: 'Slide id is used twice.' });
    }
    seen.add(slide.slideId);
    const sources = [...slide.sources, ...slide.blocks.flatMap(blockSources)];
    for (const source of sources) {
      const text = items.get(source.itemId);
      if (text === undefined) {
        problems.push({
          slideId: slide.slideId,
          message: `Source "${source.itemId}" is not an item of the content pack.`,
        });
      } else if (!text.includes(normalise(source.quote))) {
        problems.push({
          slideId: slide.slideId,
          message: `The quote from "${source.itemId}" is not in that item word for word.`,
        });
      }
    }
    for (const block of slide.blocks) {
      if (block.kind !== 'kpi') continue;
      const words = block.items.filter((item) => !/\d/.test(item.value)).map((item) => item.value);
      if (words.length > 0) {
        problems.push({
          slideId: slide.slideId,
          message: `KPI values must be figures, not words (${words.join(', ')}): use bullets instead.`,
        });
      }
    }
    const shown = [slide.headline, slide.subhead, ...slide.blocks.flatMap(blockText)];
    const invented = [...new Set(shown.flatMap(numbersIn))].filter(
      (n) => !known.has(n) && !known.has(n.replace('%', '')),
    );
    if (invented.length > 0) {
      problems.push({
        slideId: slide.slideId,
        message: `Figures not found in the content pack: ${invented.join(', ')}.`,
      });
    }
  }
  return problems;
}
