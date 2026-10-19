import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Run only against the explicitly configured disposable fake-provider stack.
if (process.env.RECOVERY_ACCESS !== '1' || process.env.RECOVERY_LIVE === '1')
  throw new Error('Offline access fixture requires RECOVERY_ACCESS=1; live calls are paused.');
const base = process.env.RECOVERY_API ?? 'http://127.0.0.1:13019';
assert.equal(new URL(base).origin, 'http://127.0.0.1:13019');
const root = new URL('../../runs/recovery-runtime/', import.meta.url);
const headers = {
  'x-lct-service-token':
    process.env.RECOVERY_SERVICE_TOKEN ?? 'recovery-isolated-test-service-token-2026',
};
async function response(path, method = 'GET', body) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body instanceof FormData || body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
}
async function api(path, method = 'GET', body) {
  const result = await response(path, method, body);
  assert.ok(result.ok, `${path}: ${result.status} ${await result.clone().text()}`);
  return result.json();
}
const auth = await api('/auth/verify', 'POST', {
  email: 'recovery@example.test',
  password: 'recovery-local-only',
});
headers['x-lct-user'] = auth.account.id;
headers['x-lct-session'] = auth.session.token;
const path = `/account-usage/${auth.account.id}`;
const previous = await api(path);
const before = previous.metrics.find((row) => row.metric === 'generation');
assert.equal(before.active, 0);
let build;
try {
  await api(path, 'PUT', {
    ...previous.override,
    generation: { limit: before.completed + 1, period: 'lifetime', timezone: 'UTC' },
    concurrency: { limit: 1, period: 'lifetime', timezone: 'UTC' },
    storage: {
      limit: previous.storageBytes + 100 * 1024 * 1024,
      period: 'lifetime',
      timezone: 'UTC',
    },
  });
  const file = new FormData();
  file.set(
    'file',
    new Blob([await readFile(new URL('synthetic.pptx', root))]),
    'access-synthetic.pptx',
  );
  const uploaded = await api('/files/template', 'POST', file);
  await api('/generation/prepare', 'POST', { templateId: uploaded.fileId });
  const original = JSON.parse(await readFile(new URL('runtime-request.json', root), 'utf8'));
  const input = { ...original, templateId: uploaded.fileId, requestId: randomUUID() };
  const requests = [input, { ...input, requestId: randomUUID() }];
  const starts = await Promise.all(requests.map((value) => response('/generation', 'POST', value)));
  assert.equal(starts.filter((value) => value.ok).length, 1);
  const denied = starts.find((value) => !value.ok);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, 'account-limit');
  const winner = starts.findIndex((value) => value.ok);
  build = await starts[winner].json();
  const duplicate = await api('/generation', 'POST', requests[winner]);
  assert.equal(duplicate.runId, build.runId);
  for (let i = 0; i < 155; i++) {
    const states = await Promise.all(build.variants.map((value) => api(`/runs/${value.runId}`)));
    if (states.every((value) => value.state === 'done')) break;
    assert.ok(
      !states.some((value) => value.state === 'failed'),
      'The offline fixture must complete all variants',
    );
    if (i === 154) throw new Error('Offline build did not complete');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const usage = await api(path);
  const totals = usage.metrics.find((row) => row.metric === 'generation');
  assert.equal(totals.completed, before.completed + 1);
  assert.equal(totals.active, 0);
  const exhausted = await response('/generation', 'POST', { ...input, requestId: randomUUID() });
  assert.equal(exhausted.status, 403);
  const continued = await api(`/generation/${build.runId}/resume`, 'POST', {});
  assert.equal(continued.runId, build.runId);
  const deck = await api(`/generation/${build.runId}/deck`);
  assert.ok(deck);
  const result = {
    build,
    concurrentStart: 'one admitted, one denied',
    successIncrement: 1,
    duplicateStart: 'same IDs',
    resume: 'same ID at exhausted quota',
    storageLimitEnabled: true,
  };
  await writeFile(new URL('access-policy-result.json', root), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (build) await response(`/generation/${build.runId}/cancel`, 'POST', {});
  await api(path, 'PUT', previous.override);
  await response('/auth/logout', 'POST');
}
