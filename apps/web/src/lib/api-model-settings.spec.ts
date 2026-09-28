import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SERVICE_TOKEN_HEADER, USER_HEADER, apiFetch, publicApiUrl } from './api';
import { createApiModelSettings } from './api-model-settings';
import {
  ConnectionNotFoundError,
  InvalidModelSettingsError,
  ModelKeysUnavailableError,
} from './model-settings';

const TOKEN = 'Zx8v3Qm1Lp7Rt2Wc9Ns4Hd6Kf0Jy5Ga_Eu';
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('API_SERVICE_TOKEN', TOKEN);
  vi.stubEnv('API_INTERNAL_URL', 'http://api:3001/');
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('apiFetch on the server', () => {
  it('goes to the internal address with the service token and the acting account', async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    await apiFetch('/generation', { method: 'POST' }, { userId: 'u1' });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://api:3001/generation');
    const headers = new Headers(init?.headers);
    expect(headers.get(SERVICE_TOKEN_HEADER)).toBe(TOKEN);
    expect(headers.get(USER_HEADER)).toBe('u1');
    expect(init?.cache).toBe('no-store');
  });

  it('gives the browser addresses behind the proxy, never the API itself', () => {
    expect(publicApiUrl('/generation/r1/artifacts/deck.pdf')).toBe(
      '/api/backend/generation/r1/artifacts/deck.pdf',
    );
  });
});

describe('createApiModelSettings', () => {
  it('asks the API for the signed-in account', async () => {
    fetchMock.mockResolvedValue(Response.json({ connections: [], roles: [] }));
    await createApiModelSettings('u1').get();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://api:3001/model-settings');
    expect(new Headers(init?.headers).get(USER_HEADER)).toBe('u1');
  });

  it('turns refusals of the API back into the errors of the settings window', async () => {
    const source = createApiModelSettings('u1');
    fetchMock.mockResolvedValueOnce(Response.json({ reason: 'notFound' }, { status: 404 }));
    await expect(source.deleteConnection('c1')).rejects.toBeInstanceOf(ConnectionNotFoundError);

    fetchMock.mockResolvedValueOnce(
      Response.json({ reason: 'invalid', problems: { baseUrl: 'protocol' } }, { status: 400 }),
    );
    const invalid = await source
      .saveConnection({ name: 'x', preset: 'custom', baseUrl: 'x' })
      .catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(InvalidModelSettingsError);
    expect((invalid as InvalidModelSettingsError).problems).toEqual({ baseUrl: 'protocol' });

    fetchMock.mockResolvedValueOnce(Response.json({ reason: 'unavailable' }, { status: 503 }));
    await expect(
      source.saveConnection({ name: 'x', preset: 'custom', baseUrl: 'https://x', apiKey: 'k' }),
    ).rejects.toBeInstanceOf(ModelKeysUnavailableError);
  });

  it('drops anything the API might send beyond the public view, a key included', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        connectionId: 'c1',
        name: 'Cloud',
        preset: 'custom',
        baseUrl: 'https://llm.example.com/v1',
        hasKey: true,
        keyHint: 'WXYZ',
        lastCheck: null,
        managed: false,
        apiKey: 'sk-should-never-travel',
      }),
    );
    const saved = await createApiModelSettings('u1').saveConnection({
      name: 'Cloud',
      preset: 'custom',
      baseUrl: 'https://llm.example.com/v1',
    });
    expect(JSON.stringify(saved)).not.toContain('sk-should-never-travel');
  });
});
