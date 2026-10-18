import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditFinding, ContentPack, SlideReview } from '@lct/contracts';
import type { EngineClient } from '@lct/engine-client';
import type { LoadedAgent } from '@lct/registry';
import { runContextualAudit } from '../audit/contextual-audit.js';
import type { ModelProvider } from '../models/provider.js';

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
}

export interface VisualReview {
  findings: AuditFinding[];
  failures: { slideId: string; error: string }[];
  reviews: SlideReview[];
  slideCount: number;
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
  const { slides } = await options.engine.importDeck(
    { schemaVersion: 1, pptxPath: options.pptxPath, mediaDir: options.mediaDir },
    options.signal,
  );
  const images: Record<string, string> = {};
  await Promise.all(
    slides.map(async (slide, index) => {
      const path = options.previews[index];
      if (path === undefined) return;
      const bytes = await readFile(path);
      images[slide.slideId] = `data:image/png;base64,${bytes.toString('base64')}`;
    }),
  );
  const result = await runContextualAudit({
    slides,
    pack: packOf(options.brief, options.goal),
    agent: options.agent,
    provider: options.provider,
    seed: options.seed,
    images,
  });
  const review: VisualReview = { ...result, slideCount: slides.length };
  await writeFile(
    join(options.outputDir, 'audit-contextual.json'),
    JSON.stringify(
      {
        model: options.provider.name,
        agent: `${options.agent.config.id}@${options.agent.config.version}`,
        slides: slides.length,
        pictures: Object.keys(images).length,
        findings: review.findings,
        failures: review.failures,
        reviews: review.reviews,
      },
      null,
      2,
    ),
  );
  return review;
}
