import { describe, expect, it, vi } from 'vitest';
import { createKeyVault } from './key-vault.js';
import { MemoryModelSettingsStore } from './model-settings-store.js';
import {
  InvalidModelSettingsInputError,
  ManagedConnectionError,
  ModelConnectionNotFoundError,
  ModelNotConfiguredError,
  ModelSettingsService,
} from './model-settings.service.js';

const SECRET = 'q4mR9v2LxT7pWc1nZ8bK3sHd6fJ0yGaE5uNo=';
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
    const settings = await setup().service.get();
    expect(settings.connections).toEqual([]);
    expect(settings.roles.map((role) => role.kind)).toEqual(Array(5).fill('unassigned'));
  });

  it('never lets the key out and stores it only encrypted', async () => {
    const { service, store } = setup();
    const saved = await service.saveConnection(cloud(KEY), 'u1');
    expect(saved).toMatchObject({
      name: 'Cloud',
      baseUrl: 'https://llm.example.com/v1',
      hasKey: true,
      keyHint: 'WXYZ',
      managed: false,
    });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(JSON.stringify(await service.get())).not.toContain(KEY);
    // At rest: ciphertext only, and the audit trail says what happened, not what the key is.
    expect(JSON.stringify([...store.connections.values()])).not.toContain(KEY);
    expect(store.connections.get(saved.connectionId)?.apiKeyEncrypted).toMatch(/^v1\./);
    expect(JSON.stringify(store.events)).not.toContain(KEY);
    expect(store.events[0]).toMatchObject({ userId: 'u1', action: 'connection-created' });
  });

  it('keeps the key when an edit leaves the field empty, replaces it when filled', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    const { service } = setup({ fetch: fetchMock as never });
    const { connectionId } = await service.saveConnection(cloud(KEY), null);
    const kept = await service.saveConnection(
      { ...cloud(''), connectionId, name: 'Cloud 2' },
      null,
    );
    expect(kept).toMatchObject({ name: 'Cloud 2', hasKey: true, keyHint: 'WXYZ' });

    await service.checkConnection(connectionId);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);

    const replaced = await service.saveConnection(
      { ...cloud('sk-another-key-00001111'), connectionId },
      null,
    );
    expect(replaced.keyHint).toBe('1111');
  });

  it('refuses to store a key without MODEL_KEYS_SECRET instead of storing it in the clear', async () => {
    const { service, store } = setup({ secret: '' });
    await expect(service.saveConnection(cloud(KEY), null)).rejects.toThrow(/MODEL_KEYS_SECRET/);
    expect(store.connections.size).toBe(0);
  });

  it('shows a key that no longer decrypts as missing, so it is entered again', async () => {
    const { service, store } = setup();
    const { connectionId } = await service.saveConnection(cloud(KEY), null);
    const moved = setup({ secret: `${SECRET}-rotated` });
    for (const connection of store.connections.values()) {
      await moved.store.saveConnection(connection);
    }
    const [view] = (await moved.service.get()).connections;
    expect(view).toMatchObject({ connectionId, hasKey: false, keyHint: null });
    await expect(moved.service.resolve({ connectionId, modelId: 'm' })).rejects.toThrow(
      /введите его заново/,
    );
  });

  it('forgets the last check when the address changes', async () => {
    const { service } = setup({ allowPrivateHosts: true });
    const { connectionId } = await service.saveConnection(
      { name: 'Ollama', preset: 'ollama', baseUrl: 'http://localhost:11434/v1' },
      null,
    );
    const checked = await service.checkConnection(connectionId);
    expect(checked.lastCheck).toEqual({
      ok: true,
      at: '2026-09-26T10:00:00.000Z',
      models: ['qwen'],
    });
    const renamed = await service.saveConnection(
      { connectionId, name: 'Ollama GPU', preset: 'ollama', baseUrl: 'http://localhost:11434/v1' },
      null,
    );
    expect(renamed.lastCheck).not.toBeNull();
    const moved = await service.saveConnection(
      {
        connectionId,
        name: 'Ollama GPU',
        preset: 'ollama',
        baseUrl: 'http://192.168.1.5:11434/v1',
      },
      null,
    );
    expect(moved.lastCheck).toBeNull();
  });

  it('rejects invalid input with problems per field', async () => {
    const { service } = setup();
    const error = await service
      .saveConnection({ name: '', preset: 'custom', baseUrl: 'localhost' }, null)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidModelSettingsInputError);
    expect((error as InvalidModelSettingsInputError).problems).toEqual({
      name: 'empty',
      baseUrl: 'protocol',
    });
    await expect(
      service.saveConnection(
        { connectionId: 'nope', name: 'x', preset: 'custom', baseUrl: 'http://x' },
        null,
      ),
    ).rejects.toBeInstanceOf(ModelConnectionNotFoundError);
  });

  it('probes an unsaved address with the saved key when the field is empty', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'm' }] }));
    const { service } = setup({ fetch: fetchMock as never });
    const { connectionId } = await service.saveConnection(cloud(KEY), null);
    const check = await service.probe({ connectionId, baseUrl: 'https://llm2.example.com/v1' });
    expect(check.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm2.example.com/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect((await service.get()).connections[0]?.lastCheck).toBeNull();
  });

  it('assigns roles, switches off only the illustrator, and unassigns on delete', async () => {
    const { service } = setup();
    const a = await service.saveConnection(
      { name: 'A', preset: 'custom', baseUrl: 'https://a.example/v1' },
      null,
    );
    const b = await service.saveConnection(
      { name: 'B', preset: 'custom', baseUrl: 'https://b.example/v1' },
      null,
    );
    await service.setRole(
      { role: 'planner', kind: 'model', connectionId: a.connectionId, modelId: 'p' },
      null,
    );
    await service.setRole(
      { role: 'writer', kind: 'model', connectionId: b.connectionId, modelId: 'w' },
      null,
    );
    await service.setRole({ role: 'image', kind: 'disabled' }, null);
    await expect(
      service.setRole({ role: 'critic', kind: 'disabled' }, null),
    ).rejects.toBeInstanceOf(InvalidModelSettingsInputError);
    await expect(
      service.setRole({ role: 'critic', kind: 'model', connectionId: 'gone', modelId: 'c' }, null),
    ).rejects.toBeInstanceOf(ModelConnectionNotFoundError);

    await service.deleteConnection(a.connectionId, null);
    const settings = await service.get();
    expect(settings.connections.map((item) => item.name)).toEqual(['B']);
    expect(settings.roles).toEqual([
      { role: 'planner', kind: 'unassigned' },
      { role: 'writer', kind: 'model', connectionId: b.connectionId, modelId: 'w' },
      { role: 'critic', kind: 'unassigned' },
      { role: 'vision', kind: 'unassigned' },
      { role: 'image', kind: 'disabled' },
    ]);
  });
});

describe('the server connection', () => {
  it('comes from the environment, read-only, with only a hint of its key', async () => {
    const { service } = setup({ env: SERVER_ENV });
    const settings = await service.get();
    expect(settings.connections).toEqual([
      {
        connectionId: 'server',
        name: 'llm.api.cloud.yandex.net',
        preset: 'custom',
        baseUrl: 'https://llm.api.cloud.yandex.net/v1',
        hasKey: true,
        keyHint: 'ABCD',
        lastCheck: null,
        managed: true,
      },
    ]);
    expect(JSON.stringify(settings)).not.toContain(SERVER_KEY);
    // The text roles default to it until someone assigns another model.
    expect(settings.roles.slice(0, 3)).toEqual(
      ['planner', 'writer', 'critic'].map((role) => ({
        role,
        kind: 'model',
        connectionId: 'server',
        modelId: SERVER_ENV.LLM_MODEL,
      })),
    );
    expect(settings.roles[3]).toEqual({ role: 'vision', kind: 'unassigned' });
  });

  it('can be checked but not edited, removed or probed from the interface', async () => {
    const { service } = setup({ env: SERVER_ENV });
    const checked = await service.checkConnection('server');
    expect(checked.lastCheck).toMatchObject({ ok: true, models: ['qwen'] });
    await expect(
      service.saveConnection({ ...cloud(KEY), connectionId: 'server' }, null),
    ).rejects.toBeInstanceOf(ManagedConnectionError);
    await expect(service.deleteConnection('server', null)).rejects.toBeInstanceOf(
      ManagedConnectionError,
    );
    await expect(
      service.probe({ connectionId: 'server', baseUrl: 'https://evil.example/v1' }),
    ).rejects.toBeInstanceOf(ManagedConnectionError);
  });
});

describe('resolve', () => {
  it('uses the picked model, else the writer role, else the server', async () => {
    const { service } = setup({ env: SERVER_ENV });
    expect(await service.resolve(null)).toEqual({
      connectionId: 'server',
      baseUrl: 'https://llm.api.cloud.yandex.net/v1',
      apiKey: SERVER_KEY,
      model: SERVER_ENV.LLM_MODEL,
    });
    const { connectionId } = await service.saveConnection(cloud(KEY), null);
    await service.setRole({ role: 'writer', kind: 'model', connectionId, modelId: 'w' }, null);
    expect(await service.resolve(null)).toMatchObject({ connectionId, apiKey: KEY, model: 'w' });
    expect(await service.resolve({ connectionId: 'server', modelId: 'other' })).toMatchObject({
      connectionId: 'server',
      model: 'other',
    });
  });

  it('gives each role its own model, and nothing for a role left without one', async () => {
    const { service } = setup();
    expect(await service.resolveRole('planner')).toBeNull();
    const { connectionId } = await service.saveConnection(cloud(KEY), null);
    await service.setRole({ role: 'critic', kind: 'model', connectionId, modelId: 'c' }, null);
    expect(await service.resolveRole('critic')).toMatchObject({ connectionId, model: 'c' });
    expect(await service.resolveRole('planner')).toBeNull();
  });

  it('says clearly that no model is configured', async () => {
    await expect(setup().service.resolve(null)).rejects.toBeInstanceOf(ModelNotConfiguredError);
    await expect(setup().service.resolve(null)).rejects.toThrow(/Модель не настроена/);
  });

  it('refuses a stored connection that points into a private network', async () => {
    const { service } = setup({ allowPrivateHosts: true });
    const { connectionId } = await service.saveConnection(
      { name: 'Ollama', preset: 'ollama', baseUrl: 'http://localhost:11434/v1' },
      null,
    );
    const strict = new ModelSettingsService(
      (service as unknown as { store: MemoryModelSettingsStore }).store,
      createKeyVault(SECRET),
      { env: {}, allowPrivateHosts: false },
    );
    await expect(strict.resolve({ connectionId, modelId: 'm' })).rejects.toThrow(/внутреннюю сеть/);
  });
});
