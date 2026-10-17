import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFinalReview } from './final-review.js';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'final-review-'));
  directories.push(directory);
  const plan = [{ slide: { texts: [{ text: 'Only after prepayment' }] } }];
  const contentHash = createHash('sha256').update(JSON.stringify(plan)).digest('hex');
  const review = {
    schemaVersion: 1,
    contentRevision: 2,
    contentHash,
    status: 'requires-review',
    errors: 1,
    warnings: 0,
    deterministic: { errors: 0, warnings: 0 },
    contextual: { errors: 1, warnings: 0 },
    coverage: { total: 0, covered: 0, missing: [] },
    issues: [
      { slideIndex: 0, slotId: 'body', category: 'factual-error', message: 'Condition missing' },
    ],
  };
  await Promise.all([
    writeFile(join(directory, 'plan.json'), JSON.stringify(plan)),
    writeFile(join(directory, 'final-review.json'), JSON.stringify(review)),
    writeFile(
      join(directory, 'audit-deterministic.json'),
      JSON.stringify({ contentHash, contentRevision: 2 }),
    ),
    writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ contentHash, contentRevision: 2 }),
    ),
  ]);
  return { directory, review };
}
describe('final review identity', () => {
  it('includes semantic errors from the matching final revision', async () => {
    const { directory } = await fixture();
    expect(await readFinalReview(directory)).toMatchObject({
      errors: 1,
      deterministic: { errors: 0 },
      contextual: { errors: 1 },
    });
  });
  it('marks a stale review unavailable after the deck plan changes', async () => {
    const { directory } = await fixture();
    await writeFile(join(directory, 'plan.json'), '[]');
    expect(await readFinalReview(directory)).toBeNull();
  });
  it('does not treat a deterministic-only legacy report as a complete review', async () => {
    const { directory } = await fixture();
    await rm(join(directory, 'final-review.json'));
    expect(await readFinalReview(directory)).toBeNull();
  });
  it('rejects a deterministic report for another content revision', async () => {
    const { directory } = await fixture();
    const report = JSON.parse(await readFile(join(directory, 'audit-deterministic.json'), 'utf8'));
    await writeFile(
      join(directory, 'audit-deterministic.json'),
      JSON.stringify({ ...report, contentRevision: 1 }),
    );
    expect(await readFinalReview(directory)).toBeNull();
  });
});
