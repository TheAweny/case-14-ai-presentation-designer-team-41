import type {
  AuditFinding,
  ContentPack,
  FixPatchBody,
  ReviewAnswer,
  SlideIr,
  SlideReview,
} from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { runAgent, type ModelProvider } from '../models/provider.js';
import { CONTEXTUAL_CHECKS, type ContextualCheck } from './contextual-checks.js';

export interface ContextualAuditOptions {
  /** The slides of one variant, in deck order. */
  readonly slides: readonly SlideIr[];
  readonly pack: ContentPack;
  readonly agent: LoadedAgent;
  readonly provider: ModelProvider;
  readonly seed: number;
  /** Rendered slides as data URLs, by slide id. The case asks the questions of the picture. */
  readonly images?: Readonly<Record<string, string>>;
  /** A "no" below this confidence is reported as info rather than as a defect. */
  readonly minConfidence?: number;
  /** Slides reviewed at once. The model calls of a deck run in parallel within this bound. */
  readonly concurrency?: number;
  readonly checks?: readonly ContextualCheck[];
  /** Stops slides that have not started. A slide already in flight receives the same signal. */
  readonly signal?: AbortSignal;
}

export interface ContextualAuditResult {
  readonly findings: AuditFinding[];
  readonly reviews: SlideReview[];
  /** Slides whose review failed; the rest of the deck is still audited. */
  readonly failures: { slideId: string; error: string }[];
}

const DEFAULT_MIN_CONFIDENCE = 0.6;
const DEFAULT_CONCURRENCY = 6;
/** Confidence at which a rewrite the model suggests is offered as a patch the user can apply. */
const PATCH_CONFIDENCE = 0.8;
/** Checks whose fix is new wording for the element the evidence points at. */
const REWRITES = new Set(['headline-states-conclusion', 'no-typos', 'no-service-text']);
/**
 * Pack passages sent with each slide. The ones sharing its figures and words are enough to check
 * its facts, and sending the whole pack with every slide is what made a run cost most.
 */
const MAX_SOURCES = 8;

const WORD = /[\p{L}\d]{4,}/gu;
const FIGURE = /\d+(?:[.,]\d+)?/g;

/** The passages of the pack a slide most likely rests on: shared figures first, then words. */
function relevantSources(slide: SlideIr, pack: ContentPack): { itemId: string; text: string }[] {
  const text = textsOf(slide)
    .map((t) => t.text)
    .join(' ')
    .toLowerCase();
  const figures = new Set(text.match(FIGURE) ?? []);
  const words = new Set(text.match(WORD) ?? []);
  return pack.items
    .map((item) => {
      const own = item.text.toLowerCase();
      const shared = (own.match(FIGURE) ?? []).filter((n) => figures.has(n));
      const common = [...new Set(own.match(WORD) ?? [])].filter((w) => words.has(w));
      return { item, score: shared.length * 5 + common.length };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SOURCES)
    .map(({ item }) => ({ itemId: item.itemId, text: item.text }));
}

interface ElementText {
  readonly elementId: string;
  readonly role: string;
  readonly text: string;
}

function textsOf(slide: SlideIr): ElementText[] {
  const texts: ElementText[] = [];
  for (const element of slide.elements) {
    const parts: string[] = [];
    if ('paragraphs' in element && element.paragraphs) {
      parts.push(...element.paragraphs.map((p) => p.runs.map((r) => r.text).join('')));
    }
    if (element.kind === 'table') {
      parts.push([element.headers, ...element.rows].map((row) => row.join(' | ')).join('\n'));
    }
    if (element.kind === 'chart') {
      const series = element.series.map((s) => `${s.name}: ${s.values.join(', ')}`);
      parts.push(
        [element.categories.join(', '), ...series, element.xTitle, element.yTitle].join('\n'),
      );
    }
    const text = parts.join('\n').trim();
    if (text.length > 0) {
      texts.push({ elementId: element.elementId, role: element.role, text });
    }
  }
  return texts;
}

function headlineOf(slide: SlideIr): string {
  return textsOf(slide).find((t) => t.role === 'title')?.text ?? '';
}

function inputFor(slides: readonly SlideIr[], index: number, options: ContextualAuditOptions) {
  const slide = slides[index] as SlideIr;
  const neighbour = (at: number) => {
    const other = slides[at];
    return other === undefined
      ? null
      : {
          headline: headlineOf(other),
          text: textsOf(other)
            .map((t) => t.text)
            .join('\n'),
        };
  };
  const checks = options.checks ?? CONTEXTUAL_CHECKS;
  return {
    task: 'review-slide',
    slideId: slide.slideId,
    position: `${index + 1} of ${slides.length}`,
    language: options.pack.language,
    goal: options.pack.goal,
    slide: { elements: textsOf(slide), notes: slide.notes ?? '' },
    previous: neighbour(index - 1),
    next: neighbour(index + 1),
    deckHeadlines: slides.map(headlineOf),
    sources: relevantSources(slide, options.pack),
    questions: checks.map(({ id, question }) => ({ checkId: id, question })),
  };
}

function targetOf(slide: SlideIr, evidence: string) {
  const quote = evidence.trim().toLowerCase();
  const element =
    quote.length > 0
      ? slide.elements.find((e) =>
          textsOf({ ...slide, elements: [e] })[0]
            ?.text.toLowerCase()
            .includes(quote),
        )
      : undefined;
  return {
    slideId: slide.slideId,
    variant: slide.variant,
    elementId: element?.elementId ?? null,
    box: element?.box ?? null,
  };
}

function patchFor(
  slide: SlideIr,
  answer: ReviewAnswer,
  findingId: string,
  elementId: string | null,
): FixPatchBody | null {
  if (
    elementId === null ||
    !REWRITES.has(answer.checkId) ||
    answer.confidence < PATCH_CONFIDENCE ||
    answer.suggestion.trim().length === 0
  ) {
    return null;
  }
  return {
    patchId: `patch:${findingId}`,
    findingId,
    slideId: slide.slideId,
    variant: slide.variant,
    ops: [
      {
        op: 'set-text',
        elementId,
        paragraphs: [
          {
            level: 0,
            lineSpacing: null,
            runs: [
              {
                text: answer.suggestion.trim(),
                font: '',
                sizePt: null,
                bold: null,
                italic: null,
                color: '',
              },
            ],
          },
        ],
      },
    ],
    rationale: answer.suggestion.trim(),
    touchesCopy: true,
  };
}

/** Turns one review into findings: a "no" is a defect when the model is sure enough, else info. */
export function findingsOf(
  slide: SlideIr,
  review: SlideReview,
  checks: readonly ContextualCheck[] = CONTEXTUAL_CHECKS,
  minConfidence: number = DEFAULT_MIN_CONFIDENCE,
): AuditFinding[] {
  const byId = new Map(checks.map((check) => [check.id, check]));
  const findings: AuditFinding[] = [];
  for (const answer of review.answers) {
    const check = byId.get(answer.checkId);
    if (check === undefined || answer.verdict !== 'no') {
      continue;
    }
    const findingId = `contextual:${check.id}:${slide.variant}:${slide.slideId}`;
    const target = targetOf(slide, answer.evidence);
    const patch = patchFor(slide, answer, findingId, target.elementId);
    const sure = answer.confidence >= minConfidence;
    findings.push({
      schemaVersion: 1,
      findingId,
      checkId: check.id,
      origin: 'contextual',
      severity: !sure ? 'info' : check.severity === 'error' ? 'major' : 'minor',
      confidence: Math.min(answer.confidence, 0.99),
      title: `Не выполнено: ${check.title.toLowerCase()}`,
      detail: answer.suggestion.trim() || check.question,
      target,
      evidence: {
        measured: '',
        expected: check.question,
        quote: answer.evidence,
        sources: [],
        screenshot: '',
      },
      fixability: patch ? 'auto' : 'assisted',
      proposedPatch: patch,
    });
  }
  return findings;
}

async function pool<T>(
  count: number,
  limit: number,
  signal: AbortSignal | undefined,
  work: (index: number) => Promise<T>,
): Promise<T[]> {
  const results: T[] = new Array<T>(count);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, count) }, async () => {
    while (true) {
      if (signal?.aborted) return;
      if (next >= count) return;
      const index = next;
      next += 1;
      results[index] = await work(index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * The contextual half of the audit: the content validation questions of the case, asked of every
 * slide of a variant by a model that sees the slide, its neighbours and the source material.
 *
 * Slides are reviewed in parallel. Each answer is validated against SlideReview, and each "no"
 * becomes a finding marked contextual, with the model's confidence and the text it quoted. A
 * rewrite is offered as a patch only when the model is sure, and nothing is ever applied here:
 * the user decides.
 */
export async function runContextualAudit(
  options: ContextualAuditOptions,
): Promise<ContextualAuditResult> {
  const { slides, agent, provider, seed } = options;
  const checks = options.checks ?? CONTEXTUAL_CHECKS;
  const outcomes = await pool(
    slides.length,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    options.signal,
    async (i) => {
      const slide = slides[i] as SlideIr;
      options.signal?.throwIfAborted();
      const image = options.images?.[slide.slideId];
      try {
        const review = await runAgent<SlideReview>(provider, {
          agent,
          input: inputFor(slides, i, options),
          seed,
          signal: options.signal,
          ...(image ? { images: [image] } : {}),
        });
        options.signal?.throwIfAborted();
        return { slide, review };
      } catch (error) {
        if (options.signal?.aborted) throw error;
        return { slide, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );
  options.signal?.throwIfAborted();
  const result: ContextualAuditResult = { findings: [], reviews: [], failures: [] };
  for (const outcome of outcomes) {
    if ('review' in outcome && outcome.review) {
      result.reviews.push(outcome.review);
      result.findings.push(
        ...findingsOf(outcome.slide, outcome.review, checks, options.minConfidence),
      );
    } else if ('error' in outcome) {
      result.failures.push({ slideId: outcome.slide.slideId, error: outcome.error });
    }
  }
  return result;
}
