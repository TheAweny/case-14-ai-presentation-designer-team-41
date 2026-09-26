import { describe, expect, it, vi } from 'vitest';
import { ConnectionNotFoundError, InvalidModelSettingsError } from '../lib/model-settings';
import { createDemoModelSettings } from './demo-model-settings';

const KEY = 'sk-proj-very-secret-0123456789WXYZ';

function source(fetchImpl?: typeof fetch) {
  let next = 0;
  return createDemoModelSettings({
    newId: () => `c${++next}`,
    now: () => new Date('2026-09-26T10:00:00.000Z'),
    fetch: fetchImpl ?? (vi.fn(async () => Response.json({ data: [{ id: 'qwen' }] })) as never),
  });
}

describe('createDemoModelSettings', () => {
  it('starts empty: no connections, every role unassigned', async () => {
    const settings = await source().get();
    expect(settings.connections).toEqual([]);
    expect(settings.roles.map((role) => role.kind)).toEqual([
      'unassigned',
      'unassigned',
      'unassigned',
      'unassigned',
      'unassigned',
    ]);
  });

  it('never lets the key out: only hasKey and the last characters', async () => {
    const demo = source();
    const saved = await demo.saveConnection({
      name: ' Cloud ',
      preset: 'custom',
      baseUrl: 'https://llm.example.com/v1/',
      apiKey: KEY,
    });
    expect(saved).toMatchObject({
      name: 'Cloud',
      baseUrl: 'https://llm.example.com/v1',
      hasKey: true,
      keyHint: 'WXYZ',
    });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    expect(JSON.stringify(await demo.get())).not.toContain(KEY);
  });

  it('keeps the key when an edit leaves the key field empty, replaces it when filled', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [] }));
    const demo = source(fetchMock as never);
    const { connectionId } = await demo.saveConnection({
      name: 'Cloud',
      preset: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      apiKey: KEY,
    });
    const kept = await demo.saveConnection({
      connectionId,
      name: 'Cloud 2',
      preset: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      apiKey: '',
    });
    expect(kept).toMatchObject({ name: 'Cloud 2', hasKey: true, keyHint: 'WXYZ' });

    await demo.checkConnection(connectionId);
    const firstInit = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((firstInit[1].headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);

    const replaced = await demo.saveConnection({
      connectionId,
      name: 'Cloud 2',
      preset: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      apiKey: 'sk-another-key-00001111',
    });
    expect(replaced.keyHint).toBe('1111');
  });

  it('forgets the last check when the address changes', async () => {
    const demo = source();
    const { connectionId } = await demo.saveConnection({
      name: 'Ollama',
      preset: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
    });
    const checked = await demo.checkConnection(connectionId);
    expect(checked.lastCheck).toEqual({
      ok: true,
      at: '2026-09-26T10:00:00.000Z',
      models: ['qwen'],
    });
    const renamed = await demo.saveConnection({
      connectionId,
      name: 'Ollama GPU',
      preset: 'ollama',
      baseUrl: 'http://localhost:11434/v1',
    });
    expect(renamed.lastCheck).not.toBeNull();
    const moved = await demo.saveConnection({
      connectionId,
      name: 'Ollama GPU',
      preset: 'ollama',
      baseUrl: 'http://192.168.1.5:11434/v1',
    });
    expect(moved.lastCheck).toBeNull();
  });

  it('rejects invalid input with problems per field', async () => {
    const demo = source();
    const error = await demo
      .saveConnection({ name: '', preset: 'custom', baseUrl: 'localhost' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(InvalidModelSettingsError);
    expect((error as InvalidModelSettingsError).problems).toEqual({
      name: 'empty',
      baseUrl: 'protocol',
    });
    await expect(
      demo.saveConnection({
        connectionId: 'nope',
        name: 'x',
        preset: 'custom',
        baseUrl: 'http://x',
      }),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);
  });

  it('probes an unsaved connection with the saved key when the field is empty', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ id: 'm' }] }));
    const demo = source(fetchMock as never);
    const { connectionId } = await demo.saveConnection({
      name: 'Cloud',
      preset: 'custom',
      baseUrl: 'https://llm.example.com/v1',
      apiKey: KEY,
    });
    const check = await demo.probe({ connectionId, baseUrl: 'https://llm2.example.com/v1' });
    expect(check.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm2.example.com/v1/models');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    // Проба ничего не сохраняет.
    expect((await demo.get()).connections[0]?.lastCheck).toBeNull();
  });

  it('assigns roles, switches off only the illustrator, and unassigns on delete', async () => {
    const demo = source();
    const a = await demo.saveConnection({ name: 'A', preset: 'custom', baseUrl: 'http://a/v1' });
    const b = await demo.saveConnection({ name: 'B', preset: 'custom', baseUrl: 'http://b/v1' });
    await demo.setRole({
      role: 'planner',
      kind: 'model',
      connectionId: a.connectionId,
      modelId: 'p',
    });
    await demo.setRole({
      role: 'writer',
      kind: 'model',
      connectionId: b.connectionId,
      modelId: 'w',
    });
    await demo.setRole({ role: 'image', kind: 'disabled' });
    await expect(demo.setRole({ role: 'critic', kind: 'disabled' })).rejects.toBeInstanceOf(
      InvalidModelSettingsError,
    );
    await expect(
      demo.setRole({ role: 'critic', kind: 'model', connectionId: 'gone', modelId: 'c' }),
    ).rejects.toBeInstanceOf(ConnectionNotFoundError);

    await demo.deleteConnection(a.connectionId);
    const settings = await demo.get();
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
