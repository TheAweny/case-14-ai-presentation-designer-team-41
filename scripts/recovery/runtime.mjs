import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const base = process.env.RECOVERY_API ?? 'http://127.0.0.1:13019';
const root = new URL('../../runs/recovery-runtime/', import.meta.url);
const live = process.env.RECOVERY_LIVE === '1';
const prefix = live ? 'live' : 'runtime';
if (live) {
  const exists = await access(new URL('live-request.json', root)).then(
    () => true,
    () => false,
  );
  if (exists)
    throw new Error('The single authorized live build was already submitted. Use its checkpoints.');
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
  budget: { maxHttpRequests: 35, maxReservedTokens: live ? 1000000 : 400000 },
  ...(live
    ? {
        model: {
          connectionId: 'recovery-qwen',
          modelId: 'gpt://b1geb1lt9ha40b3jdkvi/qwen3.6-35b-a3b/latest',
        },
      }
    : {}),
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
for (let i = 0; i < 155; i++) {
  const states = await Promise.all(
    build.variants.map(async (v) => ({ ...v, state: await api(`/runs/${v.runId}`) })),
  );
  if (states.every((v) => ['done', 'failed'].includes(v.state.state ?? v.state.status))) {
    const result = { generationMs: Date.now() - startedAt, states };
    await writeFile(new URL(`${prefix}-result.json`, root), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    break;
  }
  if (i % 10 === 0) console.log(JSON.stringify({ elapsedMs: Date.now() - startedAt, states }));
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
