import { readFile } from 'node:fs/promises';
import type { AuditFinding, ContentPack, SlideIr, SlideReview } from '@lct/contracts';
import type { EngineClient } from '@lct/engine-client';
import type { LoadedAgent } from '@lct/registry';
import { runContextualAudit } from '../audit/contextual-audit.js';
import type { ModelProvider } from '../models/provider.js';
import type { DeckVariant } from './workflow.js';

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
  signal?: AbortSignal;
  /** Layout variant of this run. Imported slides are labeled with it before findings are built. */
  variant?: DeckVariant;
}

export interface VisualReview {
  findings: AuditFinding[];
  failures: { slideId: string; error: string }[];
  reviews: SlideReview[];
  slideCount: number;
  /** Previews that were read. A missing or unreadable preview is a failure, not a review. */
  pictures: number;
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
 * gets, so the questions are about what is really there, not about what was planned. The caller
 * publishes the findings once the review has finished inside its deadline.
 */
export async function reviewVariantVisually(options: VisualReviewOptions): Promise<VisualReview> {
  if (options.signal?.aborted) throw options.signal.reason;
  const { slides: imported } = await options.engine.importDeck(
    { schemaVersion: 1, pptxPath: options.pptxPath, mediaDir: options.mediaDir },
    options.signal,
  );
  if (options.signal?.aborted) throw options.signal.reason;
  const variant = options.variant;
  const slides = variant
    ? imported.map((slide) => (slide.variant === variant ? slide : { ...slide, variant }))
    : imported;
  const images: Record<string, string> = {};
  const unread: { slideId: string; error: string }[] = [];
  const pictured: SlideIr[] = [];
  for (const [index, slide] of slides.entries()) {
    if (options.signal?.aborted) throw options.signal.reason;
    const path = options.previews[index];
    if (path === undefined) {
      unread.push({ slideId: slide.slideId, error: 'preview missing' });
      continue;
    }
    try {
      const bytes = await readFile(path);
      images[slide.slideId] = `data:image/png;base64,${bytes.toString('base64')}`;
      pictured.push(slide);
    } catch (error) {
      unread.push({
        slideId: slide.slideId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (options.signal?.aborted) throw options.signal.reason;
  const result =
    pictured.length === 0
      ? { findings: [], reviews: [], failures: [] }
      : await runContextualAudit({
          slides: pictured,
          pack: packOf(options.brief, options.goal),
          agent: options.agent,
          provider: options.provider,
          seed: options.seed,
          images,
          signal: options.signal,
        });
  if (options.signal?.aborted) throw options.signal.reason;
  return {
    findings: result.findings,
    failures: [...unread, ...result.failures],
    reviews: result.reviews,
    slideCount: slides.length,
    pictures: pictured.length,
  };
}
