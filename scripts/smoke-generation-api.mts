import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const [templateId, briefPath, count = '10'] = process.argv.slice(2);
if (!templateId || !briefPath)
  throw new Error(
    'Usage: yarn tsx scripts/smoke-generation-api.mts templateId brief.md [slideCount]',
  );
const api = process.env.API_URL ?? 'http://localhost:3001';
const request = async (path: string, body?: unknown) => {
  const response = await fetch(
    `${api}${path}`,
    body
      ? {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300000),
        }
      : {},
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  return response.json();
};
await request('/generation/prepare', { templateId });
const started = Date.now();
const run = await request('/generation', {
  templateId,
  brief: await readFile(briefPath, 'utf8'),
  slideCount: Number(count),
});
let state;
while (Date.now() - started < 300000) {
  state = await request(`/runs/${run.runId}`);
  if (state.state === 'failed')
    throw new Error(JSON.stringify(await request(`/runs/${run.runId}/events`)));
  if (state.state === 'done') break;
  await new Promise((r) => setTimeout(r, 500));
}
if (state?.state !== 'done') throw new Error('Five-minute API deadline exceeded');
const finished = Date.now();
const manifest = await request(`/generation/${run.runId}/artifacts/manifest.json`);
const artifacts = [];
for (const name of ['deck.pptx', 'deck.pdf']) {
  const response = await fetch(`${api}/generation/${run.runId}/artifacts/${name}`);
  if (!response.ok) throw new Error(`Artifact ${name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (!manifest.artifacts.some((a: { sha256: string }) => a.sha256 === hash))
    throw new Error('Artifact hash mismatch');
  artifacts.push({ name, bytes: bytes.length, sha256: hash });
}
const deck = await request(`/generation/${run.runId}/deck`);
const listing = await request('/generation');
if (!listing.some((row: { deck: { runId: string } }) => row.deck.runId === run.runId))
  throw new Error('Completed deck absent from persisted listing');
if (deck.templateIr.slides.length !== Number(count)) throw new Error('Wrong slide count');
const evidence = {
  runId: run.runId,
  requestToDoneMs: finished - started,
  manifestMs: manifest.totalMs,
  slideCount: deck.templateIr.slides.length,
  artifacts,
  warnings: deck.warnings,
  persisted: true,
};
await mkdir(resolve('runs/generation-evidence'), { recursive: true });
await writeFile(
  resolve('runs/generation-evidence/api-result.json'),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
