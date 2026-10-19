import { readFile, mkdir, writeFile } from 'node:fs/promises';
import {
  createGenerationWorkflow,
  SharedPlan,
  SharedContent,
} from '../../packages/pipeline/dist/index.js';
const root = new URL('../../runs/recovery-runtime/', import.meta.url);
const profile = JSON.parse(
  await readFile(
    new URL('../../packages/contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
).valid[0].payload;
const pattern = profile.compositions[0];
profile.compositions = [pattern];
async function run(shared) {
  const calls = [];
  const provider = {
    model: 'fake',
    async generate(agent, _instructions, input, schema) {
      calls.push(agent);
      return schema.parse(
        agent === 'planner'
          ? {
              title: 'Пилот',
              slides: Array.from({ length: 10 }, () => ({
                patternId: pattern.patternId,
                purpose: 'Рост 18 %',
                imageQuery: '',
              })),
            }
          : {
              patternId: pattern.patternId,
              textsBySlot: Object.fromEntries(
                pattern.slots.map((s) => [s.slotId, 'Рост 18 % за 2026 год']),
              ),
              speakerNotes: 'Пилот, без экстраполяции.',
              visual: null,
            },
      );
    },
  };
  const sharedPlan = new SharedPlan();
  const sharedContent = shared ? new SharedContent() : undefined;
  const started = performance.now();
  const results = await Promise.all(
    ['dense', 'balanced', 'airy'].map(async (variant) => {
      const workflow = createGenerationWorkflow({
        provider,
        sharedPlan,
        sharedContent,
        variant,
        plannerInstructions: '',
        writerInstructions: '',
        repairInstructions: '',
        signal: new AbortController().signal,
      });
      return (await workflow.createRun()).start({
        inputData: { brief: 'Рост 18 % за 2026 год', slideCount: 10, profile },
      });
    }),
  );
  if (results.some((r) => r.status !== 'success' || r.result.length !== 10))
    throw new Error('Benchmark workflow failed');
  return {
    plannerTasks: calls.filter((c) => c === 'planner').length,
    writerTasks: calls.filter((c) => c === 'writer').length,
    offlineWorkflowMs: Math.round(performance.now() - started),
    httpAttempts: null,
    inputTokens: null,
    outputTokens: null,
    cost: null,
    note: 'In-process fake provider; timing excludes inference, network, export and rendering.',
  };
}
const result = {
  baselineIndependentWriters: await run(false),
  sharedContent: await run(true),
  batchComparison:
    'Live latency/token/reliability comparison of bounded batches vs one large response is not measured.',
};
if (result.baselineIndependentWriters.writerTasks !== 30 || result.sharedContent.writerTasks !== 10)
  throw new Error('Unexpected task counts');
await mkdir(root, { recursive: true });
await writeFile(new URL('content-benchmark.json', root), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
