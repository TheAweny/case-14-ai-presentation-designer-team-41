import { randomUUID } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EngineClient } from '@lct/engine-client';
import { generatePresentation, OpenAICompatibleProvider } from '@lct/pipeline';

const [template, briefFile, count = '10'] = process.argv.slice(2);
if (!template || !briefFile)
  throw new Error(
    'Usage: yarn tsx scripts/generate-presentation.mts template.pptx brief.md [slideCount]',
  );
const engine = new EngineClient({
  baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
  timeoutMs: 120000,
});
const profile = await engine.generationProfile(resolve(template));
const runId = randomUUID();
const outputDir = resolve('runs', runId);
const result = await generatePresentation({
  runId,
  templatePath: resolve(template),
  outputDir,
  profile,
  brief: await readFile(briefFile, 'utf8'),
  slideCount: Number(count),
  registryDir: resolve('registry/agents'),
  engine,
  provider: new OpenAICompatibleProvider({
    apiKey: process.env.MODEL_API_KEY ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? '',
    model: process.env.LLM_MODEL ?? '',
  }),
  onEvent: async (event) => {
    await appendFile(resolve(outputDir, 'events.jsonl'), JSON.stringify(event) + '\n');
    process.stdout.write(JSON.stringify(event) + '\n');
  },
});
process.stdout.write(JSON.stringify({ outputDir, totalMs: result.manifest.totalMs }) + '\n');
