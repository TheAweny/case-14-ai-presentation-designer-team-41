import { describe, expect, it, vi } from 'vitest';
import { PIPELINE_ROLES } from '@lct/contracts';
import { createKeyVault } from './key-vault.js';
import { MemoryModelSettingsStore } from './model-settings-store.js';
import {
  InvalidModelSettingsInputError,
  ManagedConnectionError,
  ModelConnectionNotFoundError,
  ModelNotConfiguredError,
  ModelSettingsService,
} from './model-settings.service.js';
import { VK_AI_SPACE_BASE_URL } from '@lct/contracts';

const SECRET = 'q4mR9v2LxT7pWc1nZ8bK3sHd6fJ0yGaE5uNo=';
/** Settings as an administrator sets them up: shared with everyone, the way they worked before accounts. */
const ADMIN = { userId: 'u1', admin: true };
/** Anyone else: uses shared connections, changes only their own. */
const ANN = { userId: 'ann', admin: false };
const KEY = 'sk-proj-very-secret-0123456789WXYZ';
const SERVER_KEY = 'yc-server-key-000000000000ABCD';
const SERVER_ENV = {
  LLM_BASE_URL: 'https://llm.api.cloud.yandex.net/v1/',
  LLM_MODEL: 'gpt://folder/qwen3.6-35b-a3b/latest',
  MODEL_API_KEY: SERVER_KEY,
};

function setup(
  options: {
    env?: Record<string, string>;
    fetch?: typeof fetch;
    secret?: string;
    allowPrivateHosts?: boolean;
  } = {},
) {
  let next = 0;
  const store = new MemoryModelSettingsStore();
  const fetchMock =
    options.fetch ?? (vi.fn(async () => Response.json({ data: [{ id: 'qwen' }] })) as never);
  const service = new ModelSettingsService(store, createKeyVault(options.secret ?? SECRET), {
    env: options.env ?? {},
    newId: () => `c${++next}`,
    now: () => new Date('2026-09-26T10:00:00.000Z'),
    fetch: fetchMock,
    resolve: async () => ['203.0.113.10'],
    allowPrivateHosts: options.allowPrivateHosts ?? false,
  });
  return { service, store, fetchMock };
}

const cloud = (apiKey?: string) => ({
  name: ' Cloud ',
  preset: 'custom' as const,
  baseUrl: 'https://llm.example.com/v1/',
  ...(apiKey === undefined ? {} : { apiKey }),
});

describe('ModelSettingsService', () => {
  it('starts empty without a server model: no connections, every role unassigned', async () => {
    const settings = await setup().service.get(ADMIN);
    expect(settings.connections).toEqual([]);
    expect(settings.roles.map((role) => role.kind)).toEqual(
      Array(PIPELINE_ROLES.length).fill('unassigned'),
    );
  });

  it('never lets the key out and stores it only encrypted', async () => {
    const { service, store } = setup();
    const saved = await service.saveConnection(cloud(KEY), ADMIN);
    expect(saved).toMatchObject({
      name: 'Cloud',
      baseUrl: 'https://llm.example.com/v1',
      hasKey: true,
      keyHint: 'WXYZ',
      managed: false,
    });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(JSON.stringify(await service.get(ADMIN))).not.toContain(KEY);
    // At rest: ciphertext only, and the audit trail says what happened, not what the key is.
    expect(JSON.stringify([...store.connections.values()])).not.toContain(KEY);
    expect(store.connections.get(saved.connectionId)?.apiKeyEncrypted).toMatch(/^v1\./);
    expect(JSON.stringify(store.events)).not.toContain(KEY);
    expect(store.events[0]).toMatchObject({ userId: 'u1', action: 'connection-created' });
  });

  it('keeps the key when an edit leaves the field empty, replaces it when filled', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    const { service } = setup({ fetch: fetchMock as never });
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    const kept = await service.saveConnection(
      { ...cloud(''), connectionId, name: 'Cloud 2' },
      ADMIN,
    );
    expect(kept).toMatchObject({ name: 'Cloud 2', hasKey: true, keyHint: 'WXYZ' });

    await service.checkConnection(connectionId, ADMIN);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);

    const replaced = await service.saveConnection(
      { ...cloud('sk-another-key-00001111'), connectionId },
      ADMIN,
    );
    expect(replaced.keyHint).toBe('1111');
  });

  it('refuses to store a key without MODEL_KEYS_SECRET instead of storing it in the clear', async () => {
    const { service, store } = setup({ secret: '' });
    await expect(service.saveConnection(cloud(KEY), ADMIN)).rejects.toThrow(/MODEL_KEYS_SECRET/);
    expect(store.connections.size).toBe(0);
  });

  it('shows a key that no longer decrypts as missing, so it is entered again', async () => {
    const { service, store } = setup();
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    const moved = setup({ secret: `${SECRET}-rotated` });
    for (const connection of store.connections.values()) {
      await moved.store.saveConnection(connection);
    }
    const [view] = (await moved.service.get(ADMIN)).connections;
    expect(view).toMatchObject({ connectionId, hasKey: false, keyHint: null });
    await expect(moved.service.resolve({ connectionId, modelId: 'm' }, ADMIN)).rejects.toThrow(
      /введите его заново/,
    );
  });

  it('forgets the last check when the address changes', async () => {
    const { service } = setup({ allowPrivateHosts: true });
    const { connectionId } = await service.saveConnection(
      { name: 'Ollama', preset: 'ollama', baseUrl: 'http://localhost:11434/v1' },
      ADMIN,
    );
    const checked = await service.checkConnection(connectionId, ADMIN);
    expect(checked.lastCheck).toEqual({
      ok: true,
      at: '2026-09-26T10:00:00.000Z',
      models: ['qwen'],
    });
    const renamed = await service.saveConnection(
      { connectionId, name: 'Ollama GPU', preset: 'ollama', baseUrl: 'http://localhost:11434/v1' },
      ADMIN,
    );
    expect(renamed.lastCheck).not.toBeNull();
    const moved = await service.saveConnection(
      {
        connectionId,
        name: 'Ollama GPU',
        preset: 'ollama',
        baseUrl: 'http://192.168.1.5:11434/v1',
      },
      ADMIN,
    );
    expect(moved.lastCheck).toBeNull();
  });

  it('rejects invalid input with problems per field', async () => {
    const { service } = setup();
    const error = await service
      .saveConnection({ name: '', preset: 'custom', baseUrl: 'localhost' }, ADMIN)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidModelSettingsInputError);
    expect((error as InvalidModelSettingsInputError).problems).toEqual({
      name: 'empty',
      baseUrl: 'protocol',
    });
    await expect(
      service.saveConnection(
        { connectionId: 'nope', name: 'x', preset: 'custom', baseUrl: 'http://x' },
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(ModelConnectionNotFoundError);
  });

  it('probes an unsaved address with the saved key when the field is empty', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'm' }] }));
    const { service } = setup({ fetch: fetchMock as never });
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    const check = await service.probe(
      { connectionId, baseUrl: 'https://llm2.example.com/v1' },
      ADMIN,
    );
    expect(check.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm2.example.com/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect((await service.get(ADMIN)).connections[0]?.lastCheck).toBeNull();
  });

  it('assigns roles, switches off only the illustrator, and unassigns on delete', async () => {
    const { service } = setup();
    const a = await service.saveConnection(
      { name: 'A', preset: 'custom', baseUrl: 'https://a.example/v1' },
      ADMIN,
    );
    const b = await service.saveConnection(
      { name: 'B', preset: 'custom', baseUrl: 'https://b.example/v1' },
      ADMIN,
    );
    await service.setRole(
      { role: 'planner', kind: 'model', connectionId: a.connectionId, modelId: 'p' },
      ADMIN,
    );
    await service.setRole(
      { role: 'writer', kind: 'model', connectionId: b.connectionId, modelId: 'w' },
      ADMIN,
    );
    await service.setRole({ role: 'image', kind: 'disabled' }, ADMIN);
    await expect(
      service.setRole({ role: 'critic', kind: 'disabled' }, ADMIN),
    ).rejects.toBeInstanceOf(InvalidModelSettingsInputError);
    await expect(
      service.setRole({ role: 'critic', kind: 'model', connectionId: 'gone', modelId: 'c' }, ADMIN),
    ).rejects.toBeInstanceOf(ModelConnectionNotFoundError);

    await service.deleteConnection(a.connectionId, ADMIN);
    const settings = await service.get(ADMIN);
    expect(settings.connections.map((item) => item.name)).toEqual(['B']);
    expect(settings.roles).toEqual([
      { role: 'assistant', kind: 'unassigned' },
      { role: 'planner', kind: 'unassigned' },
      { role: 'writer', kind: 'model', connectionId: b.connectionId, modelId: 'w' },
      { role: 'critic', kind: 'unassigned' },
      { role: 'vision', kind: 'unassigned' },
      { role: 'image', kind: 'disabled' },
      { role: 'speech', kind: 'unassigned' },
    ]);
  });
});

describe('the server connection', () => {
  it('comes from the environment, read-only, with only a hint of its key', async () => {
    const { service } = setup({ env: SERVER_ENV });
    const settings = await service.get(ADMIN);
    expect(settings.connections).toEqual([
      {
        connectionId: 'server',
        name: 'llm.api.cloud.yandex.net',
        preset: 'custom',
        baseUrl: 'https://llm.api.cloud.yandex.net/v1',
        hasKey: true,
        keyHint: 'ABCD',
        headers: [],
        lastCheck: null,
        enabledModels: null,
        managed: true,
      },
    ]);
    expect(JSON.stringify(settings)).not.toContain(SERVER_KEY);
    // Other text roles follow the primary selection instead of pinning the environment model.
    expect(settings.roles.slice(0, 4)).toEqual([
      { role: 'assistant', kind: 'unassigned' },
      { role: 'planner', kind: 'unassigned' },
      { role: 'writer', kind: 'model', connectionId: 'server', modelId: SERVER_ENV.LLM_MODEL },
      { role: 'critic', kind: 'unassigned' },
    ]);
    expect(settings.roles[4]).toEqual({ role: 'vision', kind: 'unassigned' });
  });

  it('can be checked but not edited, removed or probed from the interface', async () => {
    const { service } = setup({ env: SERVER_ENV });
    const checked = await service.checkConnection('server', ADMIN);
    expect(checked.lastCheck).toMatchObject({ ok: true, models: ['qwen'] });
    await expect(
      service.saveConnection({ ...cloud(KEY), connectionId: 'server' }, ADMIN),
    ).rejects.toBeInstanceOf(ManagedConnectionError);
    await expect(service.deleteConnection('server', ADMIN)).rejects.toBeInstanceOf(
      ManagedConnectionError,
    );
    await expect(
      service.probe({ connectionId: 'server', baseUrl: 'https://evil.example/v1' }, ADMIN),
    ).rejects.toBeInstanceOf(ManagedConnectionError);
  });

  it('lets an administrator limit which of its models stay available', async () => {
    const { service } = setup({ env: SERVER_ENV });
    await service.checkConnection('server', ADMIN);
    const limited = await service.setConnectionModels(
      { connectionId: 'server', enabledModels: ['qwen'] },
      ADMIN,
    );
    expect(limited.enabledModels).toEqual(['qwen']);
    await expect(
      service.setConnectionModels(
        { connectionId: 'server', enabledModels: ['qwen'] },
        { userId: 'ann', admin: false },
      ),
    ).rejects.toBeInstanceOf(ManagedConnectionError);
  });

  it('keeps its limit after a restart, for its own address only', async () => {
    const { service, store } = setup({ env: SERVER_ENV });
    await service.setConnectionModels({ connectionId: 'server', enabledModels: ['qwen'] }, ADMIN);
    const vault = createKeyVault(SECRET);
    const restarted = new ModelSettingsService(store, vault, { env: SERVER_ENV });
    expect((await restarted.get(ANN)).connections[0]?.enabledModels).toEqual(['qwen']);
    await expect(
      restarted.resolve({ connectionId: 'server', modelId: SERVER_ENV.LLM_MODEL }, ANN),
    ).rejects.toThrow(/выключена/);
    const moved = new ModelSettingsService(store, vault, {
      env: { ...SERVER_ENV, LLM_BASE_URL: 'https://gateway.example.com/v1' },
    });
    expect((await moved.get(ANN)).connections[0]?.enabledModels).toBeNull();
  });

  it('stops being the default of the text roles once its model is switched off', async () => {
    const { service } = setup({ env: SERVER_ENV });
    await service.setConnectionModels({ connectionId: 'server', enabledModels: [] }, ADMIN);
    const settings = await service.get(ANN);
    expect(settings.roles.slice(0, 3).map((role) => role.kind)).toEqual(
      Array(3).fill('unassigned'),
    );
    expect(await service.resolveRole('writer', ANN)).toBeNull();
  });
});

describe('resolve', () => {
  it('uses the picked model, else the writer role, else the server', async () => {
    const { service } = setup({ env: SERVER_ENV });
    expect(await service.resolve(null, ADMIN)).toEqual({
      connectionId: 'server',
      baseUrl: 'https://llm.api.cloud.yandex.net/v1',
      apiKey: SERVER_KEY,
      model: SERVER_ENV.LLM_MODEL,
      headers: {},
    });
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await service.setRole({ role: 'writer', kind: 'model', connectionId, modelId: 'w' }, ADMIN);
    expect(await service.resolve(null, ADMIN)).toMatchObject({
      connectionId,
      apiKey: KEY,
      model: 'w',
    });
    expect(
      await service.resolve({ connectionId: 'server', modelId: 'other' }, ADMIN),
    ).toMatchObject({
      connectionId: 'server',
      model: 'other',
    });
  });

  it('refuses a model that was switched off, and an id typed by hand past the list', async () => {
    const { service } = setup();
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await service.checkConnection(connectionId, ADMIN);
    await service.setConnectionModels({ connectionId, enabledModels: ['other'] }, ADMIN);
    await expect(service.resolve({ connectionId, modelId: 'qwen' }, ADMIN)).rejects.toThrow(
      /выключена/,
    );
    await expect(
      service.resolve({ connectionId, modelId: 'typed-by-hand' }, ADMIN),
    ).rejects.toThrow(/выключена/);
    await expect(service.resolve({ connectionId, modelId: 'other' }, ADMIN)).resolves.toMatchObject(
      { connectionId, model: 'other' },
    );
    const opened = await service.setConnectionModels({ connectionId, enabledModels: null }, ADMIN);
    expect(opened.enabledModels).toBeNull();
    await expect(service.resolve({ connectionId, modelId: 'qwen' }, ADMIN)).resolves.toMatchObject({
      model: 'qwen',
    });
  });

  it('keeps a model switched off when a later check fails', async () => {
    let up = true;
    const fetchMock = vi.fn(async () =>
      up
        ? Response.json({ data: [{ id: 'qwen' }, { id: 'big' }] })
        : new Response('', { status: 503 }),
    );
    const { service } = setup({ fetch: fetchMock as never });
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await service.checkConnection(connectionId, ADMIN);
    await service.setConnectionModels({ connectionId, enabledModels: ['qwen'] }, ADMIN);
    up = false;
    expect((await service.checkConnection(connectionId, ADMIN)).lastCheck?.ok).toBe(false);
    await expect(service.resolve({ connectionId, modelId: 'big' }, ADMIN)).rejects.toThrow(
      /выключена/,
    );
  });

  it('keeps the model list when the connection is renamed', async () => {
    const { service } = setup();
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await service.setConnectionModels({ connectionId, enabledModels: ['qwen'] }, ADMIN);
    const renamed = await service.saveConnection(
      { ...cloud(''), connectionId, name: 'Cloud renamed' },
      ADMIN,
    );
    expect(renamed.enabledModels).toEqual(['qwen']);
  });

  it('gives each role its own model, and nothing for a role left without one', async () => {
    const { service } = setup();
    expect(await service.resolveRole('planner', ADMIN)).toBeNull();
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await service.setRole({ role: 'critic', kind: 'model', connectionId, modelId: 'c' }, ADMIN);
    expect(await service.resolveRole('critic', ADMIN)).toMatchObject({ connectionId, model: 'c' });
    expect(await service.resolveRole('planner', ADMIN)).toBeNull();
  });

  it('says clearly that no model is configured', async () => {
    await expect(setup().service.resolve(null, ADMIN)).rejects.toBeInstanceOf(
      ModelNotConfiguredError,
    );
    await expect(setup().service.resolve(null, ADMIN)).rejects.toThrow(/Модель не настроена/);
  });

  it('refuses a stored connection that points into a private network', async () => {
    const { service } = setup({ allowPrivateHosts: true });
    const { connectionId } = await service.saveConnection(
      { name: 'Ollama', preset: 'ollama', baseUrl: 'http://localhost:11434/v1' },
      ADMIN,
    );
    const strict = new ModelSettingsService(
      (service as unknown as { store: MemoryModelSettingsStore }).store,
      createKeyVault(SECRET),
      { env: {}, allowPrivateHosts: false },
    );
    await expect(strict.resolve({ connectionId, modelId: 'm' }, ADMIN)).rejects.toThrow(
      /внутреннюю сеть/,
    );
  });
});

describe('shared and personal connections', () => {
  const BOB = { userId: 'bob', admin: false };

  it('shares what an administrator adds and keeps what a person adds to them', async () => {
    const { service } = setup();
    const shared = await service.saveConnection(cloud(KEY), ADMIN);
    const own = await service.saveConnection({ ...cloud(KEY), name: 'Mine' }, ANN);

    const ann = await service.get(ANN);
    expect(ann.connections.map((c) => [c.name, c.shared, c.editable])).toEqual([
      ['Cloud', true, false],
      ['Mine', false, true],
    ]);
    // The key of a shared connection is not even hinted at to those who cannot change it.
    expect(ann.connections[0]?.keyHint).toBeNull();
    expect((await service.get(BOB)).connections.map((c) => c.connectionId)).toEqual([
      shared.connectionId,
    ]);
    await expect(
      service.resolve({ connectionId: own.connectionId, modelId: 'm' }, BOB),
    ).rejects.toThrow(ModelNotConfiguredError);
    await expect(
      service.resolve({ connectionId: shared.connectionId, modelId: 'm' }, BOB),
    ).resolves.toMatchObject({ apiKey: KEY });
  });

  it('lets only an administrator change or delete a shared connection', async () => {
    const { service } = setup();
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await expect(
      service.saveConnection({ ...cloud(), connectionId, name: 'Hijacked' }, ANN),
    ).rejects.toThrow(ManagedConnectionError);
    await expect(service.deleteConnection(connectionId, ANN)).rejects.toThrow(
      ManagedConnectionError,
    );
    const own = await service.saveConnection(cloud(KEY), ANN);
    await expect(service.deleteConnection(own.connectionId, BOB)).rejects.toThrow(
      ModelConnectionNotFoundError,
    );
  });

  it('lets only an administrator change which models a shared connection offers', async () => {
    const { service } = setup();
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await service.checkConnection(connectionId, ADMIN);
    await expect(
      service.setConnectionModels({ connectionId, enabledModels: ['qwen'] }, ANN),
    ).rejects.toThrow(ManagedConnectionError);
    const limited = await service.setConnectionModels(
      { connectionId, enabledModels: ['qwen'] },
      ADMIN,
    );
    expect(limited.enabledModels).toEqual(['qwen']);
    expect((await service.get(ANN)).connections[0]?.enabledModels).toEqual(['qwen']);
    // The limit is on the shared key, not on the administrator's view of it.
    await expect(service.resolve({ connectionId, modelId: 'big' }, ANN)).rejects.toThrow(
      /выключена/,
    );
  });

  it('starts everyone on the roles an administrator set and lets each change their own', async () => {
    const { service } = setup();
    const shared = await service.saveConnection(cloud(KEY), ADMIN);
    await service.setRole(
      { role: 'writer', kind: 'model', connectionId: shared.connectionId, modelId: 'big' },
      ADMIN,
    );
    const writerOf = async (actor: typeof ANN) =>
      (await service.get(actor)).roles.find((role) => role.role === 'writer');

    expect(await writerOf(ANN)).toMatchObject({ modelId: 'big' });
    expect((await service.get(ANN)).inheritedRoles).toContain('writer');

    await service.setRole(
      { role: 'writer', kind: 'model', connectionId: shared.connectionId, modelId: 'small' },
      ANN,
    );
    expect(await writerOf(ANN)).toMatchObject({ modelId: 'small' });
    expect(await writerOf(BOB)).toMatchObject({ modelId: 'big' });
  });

  it('keeps the defaults on connections everyone can use', async () => {
    const { service } = setup();
    await service.saveConnection(cloud(KEY), ADMIN);
    const personal = await service.saveConnection({ ...cloud(KEY), shared: false }, ADMIN);
    expect(personal.shared).toBe(false);
    await expect(
      service.setRole(
        { role: 'writer', kind: 'model', connectionId: personal.connectionId, modelId: 'm' },
        ADMIN,
      ),
    ).rejects.toThrow(InvalidModelSettingsInputError);
  });
});

describe('headers of a connection', () => {
  const PROJECT = 'f0000000-0000-4000-8000-000000000001';

  it('sends the headers of the server connection from MODEL_HEADERS with every request', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'qwen38-27b-fp8' }] }));
    const { service } = setup({
      env: { ...SERVER_ENV, MODEL_HEADERS: `Project-ID=${PROJECT}` },
      fetch: fetchMock as never,
    });
    const settings = await service.get(ADMIN);
    expect(settings.connections[0]?.headers).toEqual([{ name: 'Project-ID', value: PROJECT }]);
    expect(await service.resolve(null, ADMIN)).toMatchObject({
      headers: { 'Project-ID': PROJECT },
    });
    await service.checkConnection('server', ADMIN);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({
      'Project-ID': PROJECT,
      authorization: `Bearer ${SERVER_KEY}`,
    });
  });

  it('sends no MODEL_HEADERS that do not read as headers', async () => {
    const { service } = setup({ env: { ...SERVER_ENV, MODEL_HEADERS: 'Authorization=Bearer x' } });
    expect(await service.resolve(null, ADMIN)).toMatchObject({ headers: {} });
  });

  it('keeps the headers of a saved connection, shows them, and drops an old check when they change', async () => {
    const { service } = setup();
    const saved = await service.saveConnection(
      {
        ...cloud(KEY),
        headers: [{ name: ' Project-ID ', value: ` ${PROJECT} ` }],
        lastCheck: { ok: true, at: '2026-09-26T10:00:00.000Z', models: ['qwen'] },
      },
      ADMIN,
    );
    expect(saved.headers).toEqual([{ name: 'Project-ID', value: PROJECT }]);
    const resolvedRef = { connectionId: saved.connectionId, modelId: 'qwen' };
    expect(await service.resolve(resolvedRef, ADMIN)).toMatchObject({
      headers: { 'Project-ID': PROJECT },
    });
    // An edit without headers keeps them, and keeps the check.
    const kept = await service.saveConnection(
      { ...cloud(), connectionId: saved.connectionId },
      ADMIN,
    );
    expect(kept.headers).toEqual(saved.headers);
    expect(kept.lastCheck).not.toBeNull();
    // Other headers make the old check say nothing.
    const changed = await service.saveConnection(
      { ...cloud(), connectionId: saved.connectionId, headers: [] },
      ADMIN,
    );
    expect(changed.headers).toEqual([]);
    expect(changed.lastCheck).toBeNull();
  });

  it('refuses a header the provider sets itself, such as the key', async () => {
    const { service } = setup();
    await expect(
      service.saveConnection(
        { ...cloud(KEY), headers: [{ name: 'Authorization', value: 'Bearer x' }] },
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(InvalidModelSettingsInputError);
    await expect(
      service.probe(
        { baseUrl: 'https://llm.example.com/v1', headers: [{ name: 'Bad Name', value: 'x' }] },
        ADMIN,
      ),
    ).rejects.toBeInstanceOf(InvalidModelSettingsInputError);
  });

  it('checks an unsaved connection with the headers typed in the form', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'qwen' }] }));
    const { service } = setup({ fetch: fetchMock as never });
    await service.probe(
      {
        baseUrl: 'https://llm.example.com/v1',
        apiKey: KEY,
        headers: [{ name: 'Project-ID', value: PROJECT }],
      },
      ADMIN,
    );
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ 'Project-ID': PROJECT });
  });
});

describe('a VK AI Space connection', () => {
  const vk = (shared?: boolean) => ({
    name: 'VK AI Space',
    preset: 'vk-ai-space' as const,
    baseUrl: VK_AI_SPACE_BASE_URL,
    apiKey: KEY,
    headers: [{ name: 'Project-ID', value: 'f0000000-0000-4000-8000-000000000001' }],
    ...(shared === undefined ? {} : { shared }),
  });

  it('takes the text roles and vision at once, as the default for everyone', async () => {
    const { service } = setup();
    const { connectionId } = await service.saveConnection(vk(), ADMIN);
    const forAnn = await service.get(ANN);
    for (const role of ['assistant', 'planner', 'writer', 'critic', 'vision'] as const) {
      expect(forAnn.roles.find((item) => item.role === role)).toEqual({
        role,
        kind: 'model',
        connectionId,
        modelId: 'qwen38-27b-fp8',
      });
    }
    expect(forAnn.roles.find((item) => item.role === 'image')?.kind).toBe('unassigned');
    expect(await service.resolve(null, ANN)).toMatchObject({
      model: 'qwen38-27b-fp8',
      headers: { 'Project-ID': 'f0000000-0000-4000-8000-000000000001' },
    });
  });

  it('takes the roles of the person who added it for themselves, and no one else', async () => {
    const { service } = setup();
    const { connectionId } = await service.saveConnection(vk(), ANN);
    expect((await service.get(ANN)).roles.find((item) => item.role === 'writer')).toMatchObject({
      connectionId,
    });
    expect((await service.get(ADMIN)).roles.find((item) => item.role === 'writer')?.kind).toBe(
      'unassigned',
    );
  });

  it('leaves the roles alone when it is edited', async () => {
    const { service } = setup({ env: SERVER_ENV });
    const { connectionId } = await service.saveConnection(vk(), ADMIN);
    await service.setRole(
      { role: 'writer', kind: 'model', connectionId: 'server', modelId: 'other' },
      ADMIN,
    );
    await service.saveConnection({ ...vk(), connectionId }, ADMIN);
    expect((await service.get(ADMIN)).roles.find((item) => item.role === 'writer')).toMatchObject({
      connectionId: 'server',
    });
  });
});

describe('the vision role of the server connection', () => {
  it('goes to VLM_MODEL when it is served by the same server, as on VK AI Space', async () => {
    const { service } = setup({
      env: {
        LLM_BASE_URL: VK_AI_SPACE_BASE_URL,
        LLM_MODEL: 'qwen38-27b-fp8',
        VLM_BASE_URL: `${VK_AI_SPACE_BASE_URL}/`,
        VLM_MODEL: 'qwen38-27b-fp8',
        MODEL_API_KEY: SERVER_KEY,
      },
    });
    expect((await service.get(ADMIN)).roles.find((item) => item.role === 'vision')).toEqual({
      role: 'vision',
      kind: 'model',
      connectionId: 'server',
      modelId: 'qwen38-27b-fp8',
    });
  });

  it('waits for a connection when the vision model runs on another server', async () => {
    const { service } = setup({
      env: { ...SERVER_ENV, VLM_BASE_URL: 'http://localhost:8081/v1', VLM_MODEL: 'qwen-vl' },
    });
    expect((await service.get(ADMIN)).roles.find((item) => item.role === 'vision')?.kind).toBe(
      'unassigned',
    );
  });
});

describe('primary model inheritance', () => {
  it('uses the primary for text tasks and preserves explicit role choices', async () => {
    const { service } = setup({ env: SERVER_ENV });
    const { connectionId } = await service.saveConnection(cloud(KEY), ADMIN);
    await service.setRole(
      { role: 'writer', kind: 'model', connectionId, modelId: 'primary' },
      ADMIN,
    );
    expect(await service.resolve(null, ANN)).toMatchObject({ connectionId, model: 'primary' });
    expect(await service.resolveRole('assistant', ANN)).toBeNull();
    await service.setRole(
      { role: 'planner', kind: 'model', connectionId, modelId: 'planning' },
      ADMIN,
    );
    expect(await service.resolveRole('planner', ANN)).toMatchObject({ model: 'planning' });
    await service.setRole({ role: 'planner', kind: 'default' }, ANN);
    expect(await service.resolveRole('planner', ANN)).toBeNull();
    expect((await service.get(ANN)).roles.find((role) => role.role === 'planner')).toEqual({
      role: 'planner',
      kind: 'default',
    });
    expect(await service.resolveRole('planner', ADMIN)).toMatchObject({ model: 'planning' });
    await service.setRole({ role: 'planner', kind: 'unassigned' }, ANN);
    expect(await service.resolveRole('planner', ANN)).toMatchObject({ model: 'planning' });
  });
  it.each(['writer', 'vision', 'image'])(
    'does not let %s follow an incompatible primary role',
    async (role) => {
      await expect(
        setup().service.setRole({ role, kind: 'default' }, ADMIN),
      ).rejects.toBeInstanceOf(InvalidModelSettingsInputError);
    },
  );
});
