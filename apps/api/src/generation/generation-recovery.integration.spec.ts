import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { compositionPlanSchema, generationRequestSchema } from '@lct/contracts';
import { currentTemplateIndexRevision, dependencyKey, generatePresentation } from '@lct/pipeline';
import { fileURLToPath } from 'node:url';
import type * as Pipeline from '@lct/pipeline';
import { GenerationBuildStore, PostgresRunRepository } from '@lct/run-store';
import type { Account } from '../accounts/account-rules.js';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import { GenerationService, PROFILE_REVISION } from './generation.service.js';

vi.mock('@lct/pipeline', async (actual) => ({
  ...(await actual<typeof Pipeline>()),
  generatePresentation: vi.fn(),
}));

const databaseUrl = process.env.RUN_STORE_TEST_DATABASE_URL;
const owner: Account = {
  id: 'owner',
  email: 'owner@example.test',
  name: 'Owner',
  role: 'user',
  disabled: false,
  createdAt: '2026-10-19T00:00:00.000Z',
};
const profile = JSON.parse(
  await readFile(
    new URL('../../../../packages/contracts/fixtures/GenerationProfile.json', import.meta.url),
    'utf8',
  ),
).valid[0].payload;
const index = {
  templateHash: profile.templateHash,
  profileHash: dependencyKey(profile),
  revision: await currentTemplateIndexRevision(
    fileURLToPath(new URL('../../../../registry/agents', import.meta.url)),
  ),
  notes: profile.compositions.map((p: { patternId: string }) => ({
    patternId: p.patternId,
    kind: 'other',
    items: 1,
    useFor: 'Recovery fixture',
    skip: false,
  })),
};
const plan = compositionPlanSchema.parse({
  title: 'Accepted story',
  audience: '',
  goal: '',
  slides: Array.from({ length: 5 }, () => ({
    patternId: profile.compositions[0].patternId,
    purpose: 'Pilot 98 %',
    imageQuery: '',
  })),
});
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Missing recovery fixture value');
  return value;
}

describe.skipIf(!databaseUrl)(
  'Bugbot recovery regressions through GenerationService and PostgreSQL',
  () => {
    const schema = `api_recovery_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: databaseUrl });
    let url: string;
    let repository: PostgresRunRepository;
    let pool: Pool;
    let store: GenerationBuildStore;
    let root: string;
    let services: GenerationService[];
    let unblock: ReturnType<typeof deferred>;
    let plannerCalls: number;
    let mode: 'fail' | 'success' | 'partial' | 'hold';
    let calls: string[];
    beforeAll(async () => {
      await admin.query(`CREATE SCHEMA ${schema}`);
      const connection = new URL(required(databaseUrl));
      connection.searchParams.set('options', `-csearch_path=${schema},public`);
      url = connection.toString();
      repository = new PostgresRunRepository({ connectionString: url });
      await repository.migrate();
      const seed = new Pool({ connectionString: url });
      await seed.query(
        "INSERT INTO app_users(id,email,name,password_hash) VALUES('owner','recovery-owner@example.test','Owner','hash')",
      );
      await seed.end();
      pool = new Pool({ connectionString: url });
      store = new GenerationBuildStore(pool);
    });
    afterAll(async () => {
      await repository?.close();
      await pool?.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), 'lct-bugbot-recovery-'));
      vi.stubEnv('RUNS_DIR', root);
      vi.stubEnv('DATABASE_URL', url);
      vi.stubEnv('IMAGE_PROVIDER', '');
      vi.stubEnv('IMAGE_BASE_URL', '');
      vi.stubEnv('IMAGE_MODEL', '');
      vi.stubEnv('MODEL_PRICING_FILE', '');
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('Model/network calls forbidden');
        }),
      );
      services = [];
      unblock = deferred();
      plannerCalls = 0;
      calls = [];
      mode = 'fail';
      vi.mocked(generatePresentation).mockImplementation(async (options) => {
        const variant = required(options.variant);
        calls.push(variant);
        const accepted = await required(options.sharedPlan).once(async () => {
          plannerCalls++;
          return plan;
        });
        expect(accepted).toEqual(plan);
        const first = calls.filter((value) => value === variant).length === 1;
        if (mode === 'fail' || (mode === 'partial' && variant === 'dense' && first))
          throw new Error('Injected failed variant');
        if (mode === 'hold' || (mode === 'partial' && variant !== 'dense')) await unblock.promise;
        options.signal?.throwIfAborted();
        await mkdir(options.outputDir, { recursive: true });
        await writeFile(join(options.outputDir, 'manifest.json'), '{}');
        await options.onEvent?.({
          schemaVersion: 1,
          runId: options.runId,
          seq: options.eventSequence ?? 0,
          at: new Date().toISOString(),
          type: 'done',
          totalMs: 1,
          manifestPath: 'manifest.json',
        });
        return {} as Awaited<ReturnType<typeof generatePresentation>>;
      });
    });
    afterEach(async () => {
      unblock.release();
      for (const service of services) await service.onApplicationShutdown().catch(() => undefined);
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      await rm(root, { recursive: true, force: true });
    });
    function serviceOf() {
      const service = new GenerationService(
        repository,
        {
          resolve: async () => ({
            connectionId: 'offline',
            baseUrl: 'http://127.0.0.1:1',
            apiKey: 'fixture',
            model: 'offline',
            headers: {},
          }),
          resolveRole: async () => null,
        } as unknown as ModelSettingsService,
        {
          reasoningOf: async () => undefined,
        } as unknown as ModelCapabilityService,
      );
      vi.spyOn(service, 'template').mockResolvedValue({
        storage_path: join(root, 'fixture.pptx'),
        file_name: 'fixture.pptx',
        profile: { generation: profile, generationRevision: PROFILE_REVISION, index },
      });
      services.push(service);
      return service;
    }
    const request = () =>
      generationRequestSchema.parse({
        templateId: randomUUID(),
        requestId: randomUUID(),
        brief: 'Pilot 98 %',
        slideCount: 5,
      });
    async function waitFailed(runId: string) {
      await vi.waitFor(async () => expect((await repository.get(runId))?.state).toBe('failed'));
    }

    it('the first two Continue requests during an unexpired orphan lease reclaim once after expiry', async () => {
      const input = request();
      const original = await serviceOf().start(input, owner);
      await original.settled;
      const build = required(await store.byRequest(owner.id, required(input.requestId)));
      expect(build).not.toBeNull();
      await store.claim(build.id, owner.id);
      await pool.query(
        "UPDATE generation_builds SET lease_until=now()+interval '300 milliseconds' WHERE id=$1",
        [build.id],
      );
      for (const variant of original.variants)
        await repository.transition(variant.runId, 'running');
      const restarted = serviceOf();
      await restarted.onApplicationBootstrap();
      mode = 'success';
      const [first, second] = await Promise.all([
        restarted.resume(original.runId, owner),
        restarted.resume(original.runId, owner),
      ]);
      const outcomes = await Promise.all([first.settled, second.settled]);
      expect(outcomes.flat().every((end) => end.state === 'done')).toBe(true);
      expect(first.variants).toEqual(original.variants);
      expect(calls).toHaveLength(6);
    });

    it.each([true, false])(
      'queues concurrent retries once, even when the retry succeeds=%s',
      async (succeeds) => {
        mode = 'partial';
        const service = serviceOf();
        const original = await service.start(request(), owner);
        const dense = required(original.variants.find((entry) => entry.variant === 'dense'));
        await waitFailed(dense.runId);
        const [first, second] = await Promise.all([
          service.retryVariant(dense.runId, owner),
          service.retryVariant(dense.runId, owner),
        ]);
        expect(first.variants).toEqual([dense]);
        expect(second.variants).toEqual([dense]);
        expect(calls).toHaveLength(3);
        if (!succeeds) mode = 'fail';
        unblock.release();
        const ends = await Promise.all([first.settled, second.settled]);
        const state = succeeds ? 'done' : 'failed';
        expect(ends.flat()).toEqual([
          { ...dense, state },
          { ...dense, state },
        ]);
        expect(calls.filter((value) => value === 'dense')).toHaveLength(2);
        expect(calls.filter((value) => value === 'balanced')).toHaveLength(1);
        expect(calls.filter((value) => value === 'airy')).toHaveLength(1);
      },
    );

    it.each(['variant', 'build'])(
      'uses the persisted plan for %s resume without a planner checkpoint',
      async (kind) => {
        const service = serviceOf();
        const original = await service.start(request(), owner);
        await original.settled;
        expect(plannerCalls).toBe(1);
        mode = 'success';
        const retried =
          kind === 'variant'
            ? await service.retryVariant(original.runId, owner)
            : await service.resume(original.runId, owner);
        expect((await retried.settled).every((end) => end.state === 'done')).toBe(true);
        expect(plannerCalls).toBe(1);
      },
    );

    it('does not steal a renewed live lease, and a later explicit Stop cancels its waiting resume', async () => {
      const input = request();
      const original = await serviceOf().start(input, owner);
      await original.settled;
      const build = required(await store.byRequest(owner.id, required(input.requestId)));
      const foreign = required(await store.claim(build.id, owner.id));
      const restarted = serviceOf();
      mode = 'success';
      const following = await restarted.resume(original.runId, owner);
      await store.renew(foreign);
      await new Promise((resolve) => setTimeout(resolve, 550));
      expect(calls).toHaveLength(3);
      expect((await store.get(build.id, owner.id))?.worker_id).toBe(foreign.workerId);
      await restarted.cancel(original.runId);
      expect((await following.settled).every((end) => end.state === 'failed')).toBe(true);
      expect(calls).toHaveLength(3);
      expect((await store.get(build.id, owner.id))?.status).toBe('stopped');
    });

    it('explicit Stop takes precedence over an in-process queued retry', async () => {
      mode = 'partial';
      const service = serviceOf();
      const original = await service.start(request(), owner);
      const dense = required(original.variants.find((entry) => entry.variant === 'dense'));
      await waitFailed(dense.runId);
      const queued = await service.retryVariant(dense.runId, owner);
      await service.cancel(dense.runId);
      unblock.release();
      await original.settled;
      expect(await queued.settled).toEqual([{ ...dense, state: 'failed' }]);
      expect(calls).toHaveLength(3);
    });

    it('bounds recovery waiting without resetting the deadline or stealing a live worker', async () => {
      const input = request();
      const original = await serviceOf().start(input, owner);
      await original.settled;
      const build = required(await store.byRequest(owner.id, required(input.requestId)));
      const foreign = required(await store.claim(build.id, owner.id));
      const restarted = serviceOf();
      restarted.deadlineMs = 1000;
      mode = 'success';
      const following = await restarted.resume(original.runId, owner);
      expect((await following.settled).every((end) => end.state === 'failed')).toBe(true);
      expect(calls).toHaveLength(3);
      await expect(store.assert(foreign)).resolves.toBeUndefined();
    });

    it('serializes retries of different failed layouts without losing either intent', async () => {
      const service = serviceOf();
      const original = await service.start(request(), owner);
      await original.settled;
      mode = 'hold';
      const dense = required(original.variants.find((entry) => entry.variant === 'dense'));
      const airy = required(original.variants.find((entry) => entry.variant === 'airy'));
      const denseRetry = await service.retryVariant(dense.runId, owner);
      const airyRetry = await service.retryVariant(airy.runId, owner);
      unblock.release();
      expect(await denseRetry.settled).toEqual([{ ...dense, state: 'done' }]);
      expect(await airyRetry.settled).toEqual([{ ...airy, state: 'done' }]);
      expect(calls.filter((value) => value === 'dense')).toHaveLength(2);
      expect(calls.filter((value) => value === 'airy')).toHaveLength(2);
      expect(calls.filter((value) => value === 'balanced')).toHaveLength(1);
      expect(plannerCalls).toBe(1);
    });

    it('accepts duplicate start and Continue at full local capacity without starting a third build', async () => {
      mode = 'hold';
      const service = serviceOf();
      const firstInput = request();
      const first = await service.start(firstInput, owner);
      const second = await service.start(request(), owner);
      await vi.waitFor(() => expect(calls).toHaveLength(6));
      expect(await service.start(firstInput, owner)).toBe(first);
      const continued = await service.resume(first.runId, owner);
      const thirdInput = request();
      await expect(service.start(thirdInput, owner)).rejects.toThrow('already running');
      expect(await store.byRequest(owner.id, required(thirdInput.requestId))).toBeNull();
      unblock.release();
      await Promise.all([first.settled, second.settled]);
      expect((await continued.settled).every((end) => end.state === 'done')).toBe(true);
      expect(calls).toHaveLength(6);
    });

    it('reserves a generation across three variants and accounts durable success once', async () => {
      const limited = { ...owner, id: randomUUID() };
      await pool.query(
        "INSERT INTO app_users(id,email,name,password_hash) VALUES($1,$2,'Limited','hash')",
        [limited.id, `${limited.id}@example.test`],
      );
      const usage = new (await import('@lct/run-store')).AccountUsageStore(pool);
      await pool.query(
        "INSERT INTO app_users(id,email,name,password_hash,role) VALUES('quota-admin','quota-admin@example.test','Admin','hash','admin') ON CONFLICT DO NOTHING",
      );
      await usage.setPolicy(
        limited.id,
        { generation: { limit: 1, period: 'lifetime', timezone: 'UTC' } },
        'quota-admin',
      );
      const service = serviceOf();
      mode = 'hold';
      const input = request();
      const first = await service.start(input, limited);
      expect(await service.start(input, limited)).toBe(first);
      await expect(service.start(request(), limited)).rejects.toMatchObject({
        code: 'account-limit',
      });
      expect((await usage.view(limited.id)).metrics[0]).toMatchObject({ active: 1, completed: 0 });
      unblock.release();
      await first.settled;
      expect((await usage.view(limited.id)).metrics[0]).toMatchObject({ active: 0, completed: 1 });
      await expect(service.resume(first.runId, limited)).resolves.toMatchObject({
        runId: first.runId,
      });
      expect((await usage.view(limited.id)).metrics[0].completed).toBe(1);
    });

    it('continues accepted work when tariff data is missing or changes', async () => {
      vi.stubEnv('MODEL_PRICING_FILE', join(root, 'missing-prices.json'));
      const service = serviceOf();
      const first = await service.start(request(), owner);
      await first.settled;
      await writeFile(join(root, 'missing-prices.json'), 'not a tariff catalog');
      mode = 'success';
      const resumed = await service.resume(first.runId, owner);
      expect((await resumed.settled).every((end) => end.state === 'done')).toBe(true);
      expect(plannerCalls).toBe(1);
    });

    it('releases and invalidates its lease on graceful shutdown instead of waiting 30 seconds', async () => {
      mode = 'hold';
      const input = request();
      const service = serviceOf();
      const original = await service.start(input, owner);
      await vi.waitFor(() => expect(calls).toHaveLength(3));
      await service.onApplicationShutdown();
      const build = required(await store.byRequest(owner.id, required(input.requestId)));
      expect(await store.hasLiveLease(build.id)).toBe(false);
      expect(build?.status).toBe('interrupted');
      unblock.release();
      await original.settled;
      mode = 'success';
      const resumed = await serviceOf().resume(original.runId, owner);
      expect((await resumed.settled).every((end) => end.state === 'done')).toBe(true);
    });
  },
);
