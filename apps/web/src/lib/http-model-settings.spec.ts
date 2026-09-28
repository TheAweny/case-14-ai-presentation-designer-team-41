import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionNotFoundError, InvalidModelSettingsError } from './model-settings';
import { createHttpModelSettings } from './http-model-settings';

const settings = {
  connections: [
    {
      connectionId: 'connection-1',
      name: 'Local',
      preset: 'ollama',
      baseUrl: 'http://ollama:11434/v1',
      hasKey: true,
      keyHint: 'cret',
      lastCheck: { ok: true, at: '2026-09-28T10:00:00.000Z', models: ['qwen3'] },
    },
  ],
  roles: [{ role: 'writer', kind: 'model', connectionId: 'connection-1', modelId: 'qwen3' }],
};

afterEach(() => vi.unstubAllGlobals());

describe('HTTP model settings source', () => {
  it('binds reads to the authenticated server-action user', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify(settings)));
    vi.stubGlobal('fetch', fetch);
    await expect(createHttpModelSettings('user-1').get()).resolves.toEqual(settings);
    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3001/model-settings?userId=user-1',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('sends the current user while saving a connection', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ connection: settings.connections[0] })));
    vi.stubGlobal('fetch', fetch);
    await createHttpModelSettings('user-1').saveConnection({
      name: 'Local',
      preset: 'ollama',
      baseUrl: 'http://ollama:11434/v1',
    });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      userId: 'user-1',
      name: 'Local',
    });
  });

  it('maps API validation and missing connections to domain errors', async () => {
    const source = createHttpModelSettings('user-1');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 400 })),
    );
    await expect(source.get()).rejects.toBeInstanceOf(InvalidModelSettingsError);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 404 })),
    );
    await expect(source.deleteConnection('missing')).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });
});
