import type { CopyEdits, DeckPlan, PlanBlock, SlideIr } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { runAgent, type ModelProvider } from '../models/provider.js';

/** A part of the plan that overflowed its box, with the length it has to come down to. */
export interface CopyTarget {
  readonly slideId: string;
  readonly path: string;
  readonly text: string;
  readonly maxChars: number;
}

/** Shortest a rewrite is asked to be; below this a headline stops saying anything. */
const MIN_CHARS = 16;

function partsOf(block: PlanBlock, index: number): { path: string; text: string }[] {
  if (block.kind === 'paragraph' || block.kind === 'quote') {
    return [{ path: `blocks.${index}.text`, text: block.text }];
  }
  if (block.kind === 'bullets') {
    return block.items.map((text, i) => ({ path: `blocks.${index}.items.${i}`, text }));
  }
  return [];
}

function planParts(slide: DeckPlan['slides'][number]): { path: string; text: string }[] {
  return [
    { path: 'headline', text: slide.headline },
    ...(slide.subhead ? [{ path: 'subhead', text: slide.subhead }] : []),
    ...slide.blocks.flatMap(partsOf),
  ];
}

/**
 * Parts of the plan that overflow in any variant, each with a target length.
 *
 * An element's overflow says how many lines it is short. Its text is mapped back to the plan
 * part it came from, and the part is asked to shrink in proportion: a headline set on one line
 * that needs two more is asked for a third of its length. Where variants disagree, the tightest
 * target wins, so one rewrite fits them all.
 */
export function findOverflows(
  plan: DeckPlan,
  variants: readonly { readonly slides: readonly SlideIr[] }[],
): CopyTarget[] {
  const targets = new Map<string, CopyTarget>();
  for (const { slides } of variants) {
    for (const slide of slides) {
      const planned = plan.slides.find((s) => s.slideId === slide.slideId);
      if (planned === undefined) continue;
      const parts = planParts(planned);
      for (const element of slide.elements) {
        if (element.kind !== 'text' || !element.overflow || element.overflow.lines === 0) continue;
        const lines = element.paragraphs.map((p) => p.runs.map((r) => r.text).join(''));
        const held = Math.max(1, lines.length);
        const ratio = held / (held + element.overflow.lines);
        for (const line of lines) {
          const part = parts.find((p) => p.text === line);
          if (part === undefined) continue;
          const maxChars = Math.max(MIN_CHARS, Math.floor(part.text.length * ratio * 0.95));
          const key = `${slide.slideId}:${part.path}`;
          const known = targets.get(key);
          if (known === undefined || maxChars < known.maxChars) {
            targets.set(key, {
              slideId: slide.slideId,
              path: part.path,
              text: part.text,
              maxChars,
            });
          }
        }
      }
    }
  }
  return [...targets.values()];
}

const NUMBER = /\d+(?:[.,]\d+)?/g;

function numbers(text: string): Set<string> {
  return new Set((text.match(NUMBER) ?? []).map((n) => n.replace(',', '.')));
}

function setPart(slide: DeckPlan['slides'][number], path: string, text: string): void {
  if (path === 'headline') {
    slide.headline = text;
    return;
  }
  if (path === 'subhead') {
    slide.subhead = text;
    return;
  }
  const [, index, field, item] = path.split('.');
  const block = slide.blocks[Number(index)];
  if (block === undefined) return;
  if (field === 'text' && (block.kind === 'paragraph' || block.kind === 'quote')) {
    block.text = text;
  } else if (field === 'items' && block.kind === 'bullets' && item !== undefined) {
    block.items[Number(item)] = text;
  }
}

export interface FitCopyResult {
  readonly plan: DeckPlan;
  readonly applied: number;
  /** Edits refused, with why: longer than before, or carrying a figure the original did not. */
  readonly rejected: string[];
}

/**
 * Asks the copy-fitter agent for shorter wording of the parts that overflow, and applies an edit
 * only when it is shorter than what it replaces and brings no figure the original did not have.
 * The plan is copied, never changed in place.
 */
export async function fitCopy(options: {
  readonly plan: DeckPlan;
  readonly targets: readonly CopyTarget[];
  readonly agent: LoadedAgent;
  readonly provider: ModelProvider;
  readonly seed: number;
}): Promise<FitCopyResult> {
  const { targets } = options;
  const plan = structuredClone(options.plan);
  if (targets.length === 0) {
    return { plan, applied: 0, rejected: [] };
  }
  const answer = await runAgent<CopyEdits>(options.provider, {
    agent: options.agent,
    seed: options.seed,
    input: {
      task: 'fit-copy',
      language: plan.language,
      parts: targets.map(({ slideId, path, text, maxChars }) => ({
        slideId,
        path,
        text,
        maxChars,
      })),
    },
  });
  let applied = 0;
  const rejected: string[] = [];
  for (const edit of answer.edits) {
    const target = targets.find((t) => t.slideId === edit.slideId && t.path === edit.path);
    const slide = plan.slides.find((s) => s.slideId === edit.slideId);
    if (target === undefined || slide === undefined) continue;
    const text = edit.text.trim();
    const invented = [...numbers(text)].filter((n) => !numbers(target.text).has(n));
    if (text.length === 0 || text.length >= target.text.length) {
      rejected.push(`${edit.slideId} ${edit.path}: not shorter`);
    } else if (invented.length > 0) {
      rejected.push(`${edit.slideId} ${edit.path}: new figures ${invented.join(', ')}`);
    } else {
      setPart(slide, edit.path, text);
      applied += 1;
    }
  }
  return { plan, applied, rejected };
}
