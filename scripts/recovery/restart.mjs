import { readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = new URL('../../runs/recovery-runtime/', import.meta.url);
const base = 'http://127.0.0.1:13020';
const headers = {
  'content-type': 'application/json',
  'x-lct-service-token': 'recovery-isolated-test-service-token-2026',
  'x-lct-user': JSON.parse(await readFile(new URL('faults-build.json', root), 'utf8')).accountId,
};
async function api(path, body) {
  const res = await fetch(base + path, {
    headers,
    method: body === undefined ? 'GET' : 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return JSON.parse(text);
}
const control = (body) =>
  fetch('http://127.0.0.1:19019/control', { method: 'POST', body: JSON.stringify(body) });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitReady() {
  for (const service of [base, 'http://127.0.0.1:18019']) {
    for (let i = 0; i < 100; i++) {
      const ready = await fetch(service + '/health').then(
        (r) => r.ok,
        () => false,
      );
      if (ready) break;
      if (i === 99) throw new Error('Isolated API did not start');
      await sleep(100);
    }
  }
}
await waitReady();
const request = JSON.parse(await readFile(new URL('faults-request.json', root), 'utf8'));
request.requestId = randomUUID();
request.slideCount = 10;
request.brief = request.brief.replace('Пять слайдов', 'Десять слайдов');
await api('/generation/prepare', { templateId: request.templateId });
await control({ holdFrom: 7 });
try {
  const build = await api('/generation', request);
  const metadata = JSON.parse(
    await readFile(new URL(`${build.runId}/metadata.json`, root), 'utf8'),
  );
  const tasks = new URL(`build-${metadata.buildId}/tasks/`, root);
  let accepted;
  for (let i = 0; i < 100; i++) {
    accepted = (
      await Promise.all(
        (await readdir(tasks).catch(() => [])).map(async (file) =>
          JSON.parse(await readFile(new URL(file, tasks), 'utf8')),
        ),
      )
    ).filter((task) => task.value.textsBySlot);
    if (accepted.length >= 7) break;
    await sleep(100);
  }
  if (accepted?.length !== 7)
    throw new Error('Did not stop immediately after seven accepted writers');
  const before = (await readFile(new URL('fake-sends.jsonl', root), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const killed = spawnSync('docker', ['kill', 'lct-recovery-api-faults'], { encoding: 'utf8' });
  if (killed.status !== 0) throw new Error('Could not kill isolated worker');
  const killedAt = Date.now();
  const restarted = spawnSync('docker', ['start', 'lct-recovery-api-faults'], { encoding: 'utf8' });
  if (restarted.status !== 0) throw new Error('Could not restart isolated worker');
  await control({ holdFrom: null });
  console.log(
    JSON.stringify({
      killedAfterAcceptedWriters: 7,
      buildId: metadata.buildId,
      runIds: build.variants.map((v) => v.runId),
      resumeBeforeLeaseExpiry: true,
    }),
  );
  await waitReady();
  const resumeDelayMs = Date.now() - killedAt;
  if (resumeDelayMs >= 25000)
    throw new Error('Restart took too long to test the live-lease window');
  const resume = await Promise.all([
    api(`/generation/${build.runId}/resume`, {}),
    api(`/generation/${build.runId}/resume`, {}),
  ]);
  if (resume.some((r) => r.runId !== build.runId)) throw new Error('Restart changed run ids');
  for (let i = 0; i < 130; i++) {
    const states = await Promise.all(build.variants.map((v) => api(`/runs/${v.runId}`)));
    if (states.every((s) => s.state === 'done' || s.state === 'failed')) {
      const after = (await readFile(new URL('fake-sends.jsonl', root), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      const added = after.slice(before.length);
      const repeated = added.filter(
        (row) => row.name === 'planner' || (row.name === 'writer' && row.index < 7),
      );
      if (repeated.length) throw new Error('Restart repeated accepted tasks');
      const trace = {
        buildId: metadata.buildId,
        resumeDelayMs,
        resumeBeforeLeaseExpiry: true,
        acceptedBeforeKill: 7,
        repeatedAcceptedTasks: repeated.length,
        newWriterIndexes: added.filter((r) => r.name === 'writer').map((r) => r.index),
        states,
        note: 'Killed in-flight attempts retain unknown/pending reservations; no exactly-once billing claim.',
      };
      await writeFile(new URL('restart-trace.json', root), JSON.stringify(trace, null, 2));
      console.log(JSON.stringify(trace));
      if (states.some((s) => s.state !== 'done')) throw new Error('Restart left failed variants');
      break;
    }
    if (i === 129) throw new Error('Restart did not settle');
    await sleep(1000);
  }
} finally {
  await control({ holdFrom: null });
}
