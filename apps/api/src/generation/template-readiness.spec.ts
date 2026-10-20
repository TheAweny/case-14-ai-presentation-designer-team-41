import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationProfileSchema, generationRequestSchema } from '@lct/contracts';
import { currentTemplateIndexRevision, dependencyKey } from '@lct/pipeline';
import type { RunRepository } from '@lct/run-store';
import type { Account } from '../accounts/account-rules.js';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import { GenerationService, PROFILE_REVISION, type StoredTemplate } from './generation.service.js';

const profile = generationProfileSchema.parse(
  JSON.parse(
    await readFile(
      new URL('../../../../packages/contracts/fixtures/GenerationProfile.json', import.meta.url),
      'utf8',
    ),
  ).valid[0].payload,
);
const registry = fileURLToPath(new URL('../../../../registry/agents', import.meta.url));
const revision = await currentTemplateIndexRevision(registry);
const index = {
  templateHash: profile.templateHash,
  profileHash: dependencyKey(profile),
  revision,
  notes: profile.compositions.map((p) => ({
    patternId: p.patternId,
    kind: 'other',
    items: 1,
    useFor: 'Test layout',
    skip: false,
  })),
};
const owner = { id: 'owner', role: 'user' } as Account;
const request = generationRequestSchema.parse({
  templateId: '00000000-0000-4000-8000-000000000001',
  brief: 'Подготовленный материал для презентации',
});
let service: GenerationService;
afterEach(async () => {
  vi.restoreAllMocks();
  await service?.pool.end();
});

function setup(storedIndex: unknown = index) {
  service = new GenerationService(
    {} as RunRepository,
    {} as ModelSettingsService,
    {} as ModelCapabilityService,
  );
  const row: StoredTemplate = {
    storage_path: '/template.pptx',
    file_name: 'template.pptx',
    profile: { generation: profile, generationRevision: PROFILE_REVISION, index: storedIndex },
  };
  vi.spyOn(service, 'template').mockResolvedValue(row);
  vi.spyOn(service, 'registryDir').mockReturnValue(registry);
  return row;
}

describe('template readiness gates generation', () => {
  it.each([
    ['missing', undefined],
    [
      'partial',
      { ...index, notes: [...index.notes, { ...index.notes[0], patternId: 'unexpected-pattern' }] },
    ],
    ['stale', { ...index, revision: 'old-revision' }],
    ['stale', { ...index, profileHash: 'f'.repeat(64) }],
  ])('rejects %s notes before any generation work', async (readiness, storedIndex) => {
    const row = setup(storedIndex);
    // setup's default argument is useful elsewhere; absence is explicit in this test.
    if (storedIndex === undefined) row.profile.index = undefined;
    await expect(service.start(request, owner)).rejects.toMatchObject({
      response: { code: 'template-index-not-ready', readiness },
    });
    expect(GenerationService.prepared(row, revision)).toBe(false);
  });

  it('accepts a complete index only for the current profile and indexer revision', () => {
    const row = setup();
    expect(GenerationService.prepared(row, revision)).toBe(true);
    expect(GenerationService.prepared(row, 'next-revision')).toBe(false);
    expect(
      GenerationService.prepared(
        { ...row, profile: { ...row.profile, generationRevision: 0 } },
        revision,
      ),
    ).toBe(false);
  });

  it('retries only indexing after a failure and preserves the current profile', async () => {
    const row = setup();
    row.profile.index = undefined;
    const parse = vi.spyOn(service.engine, 'generationProfile');
    const query = vi
      .spyOn(service.pool, 'query')
      .mockResolvedValue({ rows: [], rowCount: 1 } as never);
    // Preview generation is independent and already complete in this fixture.
    row.profile.previews = [];
    const internal = service as unknown as { indexTemplate: (...args: unknown[]) => Promise<void> };
    const indexing = vi
      .spyOn(internal, 'indexTemplate')
      .mockRejectedValueOnce(new Error('index unavailable'))
      .mockResolvedValueOnce(undefined);
    await expect(service.prepare(request.templateId, null, owner)).rejects.toThrow(
      'index unavailable',
    );
    expect(service.preparationOf(request.templateId).progress).toBeNull();
    await service.prepare(request.templateId, null, owner);
    expect(parse).not.toHaveBeenCalled();
    expect(indexing).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalled();
  });
});
