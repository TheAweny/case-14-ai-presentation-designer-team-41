import { readFile } from 'node:fs/promises';
import type { AuditFinding, ContentPack, LayoutVariant, SlideReview } from '@lct/contracts';
import type { EngineClient } from '@lct/engine-client';
import type { LoadedAgent } from '@lct/registry';
import { runContextualAudit } from '../audit/contextual-audit.js';
import type { ModelProvider } from '../models/provider.js';
import { slideIndexOf } from './self-check.js';

export interface VisualReviewOptions {
  engine: Pick<EngineClient, 'importDeck'>;
  agent: LoadedAgent;
  provider: ModelProvider;
  /** The request the deck answers: every figure on a slide must rest on it. */
  brief: string;
  /** What the deck has to achieve, in a sentence; the deck's title when nothing else is known. */
  goal: string;
  /** The written deck and the folder its pictures were taken out into. */
  pptxPath: string;
  mediaDir: string;
  /** The drawn slides, in deck order. */
  previews: readonly string[];
  seed: number;
  outputDir: string;
  /** Ask only about the slides with these 1-based numbers; absent: all of them. */
  only?: ReadonlySet<number>;
  /** Density stamped on every imported slide. Absent: balanced. */
  variant?: LayoutVariant;
  /** The earlier review of the deck: what it said of the slides not asked about now is kept. */
  previous?: VisualReview;
  signal?: AbortSignal;
}

export interface VisualReview {
  findings: AuditFinding[];
  failures: { slideId: string; error: string }[];
  reviews: SlideReview[];
  slideCount: number;
  pictures: number;
  /** Slides whose pictures were successfully loaded across merged passes. */
  picturedSlideIds: string[];
}

const CYRILLIC = /\p{Script=Cyrillic}/u;

/** The brief as the pack the questions are answered against: nothing else may be cited. */
function packOf(brief: string, goal: string): ContentPack {
  return {
    schemaVersion: 1,
    packId: 'brief',
    briefId: 'brief',
    language: CYRILLIC.test(brief) ? 'ru' : 'en',
    goal: goal.trim() || 'Презентация по запросу',
    audience: '',
    items: [{ itemId: 'brief', kind: 'brief', title: '', text: brief, origin: '' }],
  };
}

/**
 * The contextual half of the audit for one written variant: the content validation questions of
 * the case asked of the picture of every slide. The slides are read back from the file the user
 * gets, so the questions are about what is really there, not about what was planned. Findings
 * are written next to the deterministic ones as `audit-contextual.json`.
 */
export async function reviewVariantVisually(options: VisualReviewOptions): Promise<VisualReview> {
  options.signal?.throwIfAborted();
  const imported = await options.engine.importDeck(
    { schemaVersion: 1, pptxPath: options.pptxPath, mediaDir: options.mediaDir },
    options.signal,
  );
  options.signal?.throwIfAborted();
  const slides = imported.slides.map((slide) => ({
    ...slide,
    variant: options.variant ?? 'balanced',
  }));
  const images: Record<string, string> = {};
  const missingByIndex: ({ slideId: string; error: string } | undefined)[] = [];
  await Promise.all(
    slides.map(async (slide, index) => {
      if (options.only && !options.only.has(index + 1)) return;
      const unavailable = { slideId: slide.slideId, error: 'Slide preview unavailable.' };
      const path = options.previews[index];
      if (path === undefined) {
        missingByIndex[index] = unavailable;
        return;
      }
      try {
        const bytes = await readFile(path);
        if (bytes.length === 0) {
          missingByIndex[index] = unavailable;
          return;
        }
        images[slide.slideId] = `data:image/png;base64,${bytes.toString('base64')}`;
      } catch {
        missingByIndex[index] = unavailable;
      }
    }),
  );
  options.signal?.throwIfAborted();
  const missing = missingByIndex.flatMap((failure) => (failure ? [failure] : []));
  const wanted = slides.flatMap((slide, index) =>
    !options.only || options.only.has(index + 1) ? [slide.slideId] : [],
  );
  const result = await runContextualAudit({
    slides,
    pack: packOf(options.brief, options.goal),
    agent: options.agent,
    provider: options.provider,
    seed: options.seed,
    images,
    only: new Set(wanted.filter((id) => images[id] !== undefined)),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  // A review that was stopped writes nothing: its file would land after the run is done.
  options.signal?.throwIfAborted();
  const currentIds = new Set(slides.map((slide) => slide.slideId));
  const currentPictured = Object.keys(images);
  const { only, previous } = options;
  const kept = (slideId: string) => {
    const index = slideIndexOf(slideId);
    return currentIds.has(slideId) && index !== null && !(only?.has(index + 1) ?? false);
  };
  const picturedSlideIds =
    only && previous
      ? [
          ...new Set([
            ...previous.picturedSlideIds.filter((slideId) => kept(slideId)),
            ...currentPictured,
          ]),
        ]
      : currentPictured;
  const review: VisualReview = {
    ...result,
    failures: [...result.failures, ...missing],
    slideCount: slides.length,
    picturedSlideIds,
    pictures: picturedSlideIds.length,
  };
  if (only && previous) {
    // Slides asked about again replace their old answers; the rest of the deck stays as it was.
    review.findings = [
      ...previous.findings.filter((f) => kept(f.target.slideId)),
      ...review.findings,
    ];
    review.reviews = [...previous.reviews.filter((r) => kept(r.slideId)), ...review.reviews];
    review.failures = [...previous.failures.filter((f) => kept(f.slideId)), ...review.failures];
  }
  return review;
}
