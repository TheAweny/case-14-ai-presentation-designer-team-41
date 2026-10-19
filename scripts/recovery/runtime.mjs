import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = process.env.RECOVERY_API ?? 'http://127.0.0.1:13019';
const root = new URL('../../runs/recovery-runtime/', import.meta.url);
const faults = process.env.RECOVERY_FAULTS === '1';
const prefix = faults ? 'faults' : 'runtime';
if (process.env.RECOVERY_LIVE === '1') {
  throw new Error('Live model calls are paused by the user. Use the offline fake provider.');
}
const headers = {
  'x-lct-service-token':
    process.env.RECOVERY_SERVICE_TOKEN ?? 'recovery-isolated-test-service-token-2026',
};
async function api(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...headers,
      ...(body instanceof FormData || body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} ${response.status}: ${text}`);
  return JSON.parse(text);
}
await mkdir(root, { recursive: true });
for (const endpoint of [base, process.env.RECOVERY_ENGINE ?? 'http://127.0.0.1:18019']) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const ready = await fetch(`${endpoint}/health`).then(
      (response) => response.ok,
      () => false,
    );
    if (ready) break;
    if (attempt === 149) throw new Error(`The isolated service did not become ready: ${endpoint}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
const auth = await api('/auth/verify', {
  email: 'recovery@example.test',
  password: 'recovery-local-only',
});
headers['x-lct-user'] = auth.account.id;
const file = new FormData();
file.set('file', new Blob([await readFile(new URL('synthetic.pptx', root))]), 'synthetic.pptx');
const uploaded = await api('/files/template', file);
const preparationStarted = Date.now();
await api('/generation/prepare', { templateId: uploaded.fileId });
const readiness = await api(`/generation/prepare/${uploaded.fileId}`);
console.log(JSON.stringify({ preparationMs: Date.now() - preparationStarted, readiness }));
const request = {
  requestId: randomUUID(),
  templateId: uploaded.fileId,
  brief:
    'Пять слайдов: цель пилота; результаты измерений; проверка качества; ограничения; следующий этап. Команда проверяет доступность сервиса. Пилот оценивает устойчивость процесса. Доступность составила 98 % за 2026 год. Результат относится только к пилоту. Эксперты проверяют качество по журналу. Команда сопоставляет ошибки с наблюдениями. Наблюдения получены в тестовой среде. Оценка не подтверждает промышленную нагрузку. Команда повторит измерения под нагрузкой. Решение о запуске примут после проверки.',
  slideCount: 5,
  seed: 41,
  budget: { maxHttpRequests: 35, maxReservedTokens: 400000 },
};
await writeFile(new URL(`${prefix}-request.json`, root), JSON.stringify(request, null, 2));
const startedAt = Date.now();
const build = await api('/generation', request);
const duplicate = await api('/generation', request);
if (
  build.runId !== duplicate.runId ||
  JSON.stringify(build.variants) !== JSON.stringify(duplicate.variants)
)
  throw new Error('Duplicate start changed stable IDs');
await writeFile(
  new URL(`${prefix}-build.json`, root),
  JSON.stringify({ build, accountId: auth.account.id, startedAt }, null, 2),
);
console.log(JSON.stringify({ build, duplicateStart: 'same IDs' }));
let completed = false;
for (let i = 0; i < 155; i++) {
  const states = await Promise.all(
    build.variants.map(async (v) => ({ ...v, state: await api(`/runs/${v.runId}`) })),
  );
  if (states.every((v) => ['done', 'failed'].includes(v.state.state ?? v.state.status))) {
    const result = { generationMs: Date.now() - startedAt, states };
    await writeFile(new URL(`${prefix}-result.json`, root), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    if (!faults && states.some((variant) => variant.state.state !== 'done'))
      throw new Error('The ordinary fake build must complete all three variants');
    if (faults) {
      if (states.filter((v) => v.state.state === 'done').length !== 2)
        throw new Error('Fault case must preserve two completed variants');
      const sendCount = async () =>
        (await readFile(new URL('fake-sends.jsonl', root), 'utf8')).trim().split('\n').length;
      const before = await sendCount();
      const readyTimes = new Map(
        states.filter((v) => v.state.state === 'done').map((v) => [v.runId, v.state.updatedAt]),
      );
      const resumed = await Promise.all([
        api(`/generation/${build.runId}/resume`, {}),
        api(`/generation/${build.runId}/resume`, {}),
      ]);
      const ids = (variants) => JSON.stringify(variants.map((v) => [v.variant, v.runId]));
      if (resumed.some((r) => ids(r.variants) !== ids(build.variants)))
        throw new Error('Resume changed IDs');
      for (let retry = 0; retry < 40; retry++) {
        const after = await Promise.all(build.variants.map((v) => api(`/runs/${v.runId}`)));
        if (after.every((r) => r.state === 'done')) {
          const sendsAfter = await sendCount();
          if (sendsAfter !== before)
            throw new Error('Export resume repeated an accepted provider task');
          if (after.some((r) => readyTimes.has(r.runId) && readyTimes.get(r.runId) !== r.updatedAt))
            throw new Error('Resume republished a successful variant');
          const trace = {
            concurrentResume: 'same IDs, one worker',
            acceptedTaskRepeats: 0,
            before,
            sendsAfter,
            states: after,
          };
          await writeFile(new URL('resume-trace.json', root), JSON.stringify(trace, null, 2));
          console.log(JSON.stringify(trace));
          break;
        }
        if (retry === 39) throw new Error('Resume did not complete');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    completed = true;
    break;
  }
  if (i % 10 === 0) console.log(JSON.stringify({ elapsedMs: Date.now() - startedAt, states }));
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (!completed) throw new Error('The isolated build did not reach its expected terminal state');
