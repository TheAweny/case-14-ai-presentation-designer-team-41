import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { finalReviewSchema, type FinalReview } from '@lct/contracts';

const identitySchema = z.object({
  contentRevision: z.number().int().positive(),
  contentHash: z.string().length(64),
});

/** A partial, missing, or stale audit cannot establish that a presentation is clean. */
export async function readFinalReview(directory: string): Promise<FinalReview | null> {
  try {
    const read = async (name: string): Promise<unknown> =>
      JSON.parse(await readFile(join(directory, name), 'utf8'));
    const [rawReview, plan, rawDeterministic, rawManifest] = await Promise.all([
      read('final-review.json'),
      read('plan.json'),
      read('audit-deterministic.json'),
      read('manifest.json'),
    ]);
    const review = finalReviewSchema.parse(rawReview);
    const deterministic = identitySchema.parse(rawDeterministic);
    const manifest = identitySchema.parse(rawManifest);
    const contentHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
    if (
      review.status === 'unknown' ||
      review.contextual === null ||
      review.deterministic === null ||
      [review, deterministic, manifest].some(
        (value) =>
          value.contentHash !== contentHash || value.contentRevision !== review.contentRevision,
      )
    )
      return null;
    return review;
  } catch {
    // Older runs and incomplete writes have no complete final review.
    return null;
  }
}
