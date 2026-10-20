import type { CompositionPlan, DeckOutline } from '@lct/contracts';

/**
 * A plan made without a model, for when the planner did not answer in its time or answered
 * nothing usable. The brief is read as the person wrote it: the first heading titles the deck,
 * each paragraph or list item becomes a point, the points are spread over the middle slides in
 * order, and the last slide carries the goal. The writers then write the copy as usual.
 */
export interface FallbackLayout {
  patternId: string;
  /** Content blocks besides the title: how many points the layout holds. */
  blocks: number;
  kind?: string | undefined;
  special?: boolean | undefined;
}

export interface FallbackPlanInput {
  brief: string;
  /** Exact count asked for; null lets the brief decide, within 5 to 15. */
  slideCount: number | null;
  outline?: DeckOutline | null;
  catalog: readonly FallbackLayout[];
  coverPatternIds: readonly string[];
}

const MIN_SLIDES = 5;
const MAX_AUTO_SLIDES = 15;

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

/** Lines of the brief that say something, without Markdown markers; each is in the brief verbatim. */
export function briefPoints(brief: string): { heading: string | null; points: string[] } {
  let heading: string | null = null;
  const points: string[] = [];
  for (const raw of brief.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[-*_=|]{3,}$/.test(line)) continue;
    const title = /^#{1,6}\s+(.+)$/.exec(line);
    if (title?.[1]) {
      heading ??= title[1].trim();
      continue;
    }
    const text = line.replace(/^(?:[-*+•]|\d+[.)])\s+/u, '').trim();
    if (text.length >= 3) points.push(text);
  }
  return { heading, points };
}

export function fallbackPlan(input: FallbackPlanInput): CompositionPlan {
  const { heading, points } = briefPoints(input.brief);
  const title = cut(heading ?? points[0] ?? 'Презентация', 100);
  const outline = input.outline ?? null;
  const goalLine =
    points.find((point) => /^(цель|задача|goal|просьба|решение)\b/iu.test(point)) ??
    points.at(-1) ??
    title;
  const count =
    outline?.slides.length ??
    input.slideCount ??
    Math.max(MIN_SLIDES, Math.min(MAX_AUTO_SLIDES, points.length + 2));
  const ordinary = input.catalog.filter(
    (layout) => !layout.special && layout.kind !== 'cover' && layout.kind !== 'closing',
  );
  const pool = ordinary.length ? ordinary : input.catalog;
  const cover =
    input.catalog.find((layout) => input.coverPatternIds.includes(layout.patternId)) ??
    input.catalog[0];
  if (!cover || !pool.length) throw new Error('The template has no composition to plan on.');
  const used = new Map<string, number>();
  // The layout whose blocks match the points best; among equals the one used least, so the deck
  // does not repeat one layout.
  const pick = (want: number): string => {
    const best = [...pool].sort(
      (a, b) =>
        Math.abs(Math.max(1, a.blocks) - want) - Math.abs(Math.max(1, b.blocks) - want) ||
        (used.get(a.patternId) ?? 0) - (used.get(b.patternId) ?? 0),
    )[0];
    const id = (best ?? cover).patternId;
    used.set(id, (used.get(id) ?? 0) + 1);
    return id;
  };
  const claim = (slide: number, index: number, text: string) => ({
    id: `slide-${slide + 1}-claim-${index + 1}`,
    text: cut(text, 1000),
    source: { sourceId: 'brief' as const, quote: cut(text, 2000) },
  });
  const middle = Math.max(0, count - 2);
  const body = points.filter((point) => point !== title && point !== goalLine);
  const slides: CompositionPlan['slides'] = [];
  for (let index = 0; index < count; index++) {
    const approved = outline?.slides[index];
    if (approved) {
      slides.push({
        patternId: index === 0 ? cover.patternId : pick(Math.max(1, approved.points.length)),
        purpose: cut(approved.title, 600),
        imageQuery: '',
        sourceEvidence: {},
        requiredClaims: [],
      });
      continue;
    }
    if (index === 0) {
      slides.push({
        patternId: cover.patternId,
        purpose: cut(title, 600),
        imageQuery: '',
        sourceEvidence: {},
        requiredClaims: heading || points[0] ? [claim(index, 0, title)] : [],
      });
      continue;
    }
    if (index === count - 1) {
      slides.push({
        patternId: pick(1),
        purpose: cut(goalLine, 600),
        imageQuery: '',
        sourceEvidence: {},
        requiredClaims: [claim(index, 0, goalLine)],
      });
      continue;
    }
    // Points spread evenly and in order over the middle slides; a short brief repeats none.
    const from = Math.floor(((index - 1) * body.length) / middle);
    const to = Math.floor((index * body.length) / middle);
    const share = body.slice(from, Math.max(to, from + (body.length >= middle ? 1 : 0)));
    const own = share.length ? share : [body[(index - 1) % Math.max(1, body.length)] ?? title];
    slides.push({
      patternId: pick(own.length),
      purpose: cut(own.join(' '), 600),
      imageQuery: '',
      sourceEvidence: {},
      requiredClaims: own.map((text, at) => claim(index, at, text)),
    });
  }
  return { title, audience: '', goal: cut(goalLine, 300), slides };
}
