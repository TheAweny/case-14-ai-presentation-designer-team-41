import { describe, expect, it, vi } from 'vitest';
import type { ModelRef, ModelSettings } from '@lct/contracts';
import { ModelCapabilityService } from './model-capabilities.js';
import { MemoryModelSettingsStore } from './model-settings-store.js';
import type { ModelSettingsService, ResolvedModel } from './model-settings.service.js';

const actor = { userId: 'u', admin: false };
const baseUrl = 'https://hub.example.test/v1';

/** Settings with one checked connection offering `models`, and a resolver for them. */
function settingsWith(models: string[]): ModelSettingsService {
  const settings: ModelSettings = {
    connections: [
      {
        connectionId: 'hub',
        name: 'Hub',
        preset: 'custom',
        baseUrl,
        hasKey: true,
        keyHint: null,
        managed: false,
        lastCheck: { ok: true, at: '2026-10-17T00:00:00Z', models },
      },
    ],
    roles: [{ role: 'speech', kind: 'unassigned' }],
  };
  return {
    get: async () => settings,
    resolve: async (ref: ModelRef | null): Promise<ResolvedModel> => ({
      connectionId: ref?.connectionId ?? 'hub',
      baseUrl,
      apiKey: 'key',
      model: ref?.modelId ?? models[0] ?? '',
      headers: {},
    }),
  } as unknown as ModelSettingsService;
}

const prompts = async () => ({
  version: '1.2.0',
  question: 'q',
  chat: 'c',
  vision: 'v',
  image: 'i',
});

/**
 * A provider whose models are, whatever their names: `chatter` chats and sees, `writer` only
 * chats, `painter` draws, `ear` transcribes. Everything else is refused.
 */
function provider() {
  const seen = new Map<string, number>();
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace(baseUrl, '');
    if (path === '/audio/transcriptions') {
      const model = (init?.body as FormData).get('model');
      return model === 'ear' ? Response.json({ text: '' }) : new Response('no', { status: 400 });
    }
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      reasoning_effort?: string;
      messages?: { content: unknown }[];
    };
    if (path === '/images/generations') {
      return body.model === 'painter'
        ? Response.json({ data: [{ b64_json: 'AAAA' }] })
        : new Response('no', { status: 400 });
    }
    if (body.model !== 'chatter' && body.model !== 'writer') {
      return new Response('no', { status: 404 });
    }
    if (body.reasoning_effort && !['none', 'low', 'high'].includes(body.reasoning_effort)) {
      return new Response('unsupported reasoning effort', { status: 400 });
    }
    let content = 'ok';
    if (Array.isArray(body.messages?.[0]?.content)) {
      // The red square is asked about first, the blue one second; only `chatter` sees them.
      const count = (seen.get(body.model) ?? 0) + 1;
      seen.set(body.model, count);
      content = body.model === 'chatter' ? (count % 2 ? 'Red' : 'Blue') : 'Orange';
    }
    const tokens = body.reasoning_effort === 'none' ? 0 : body.reasoning_effort ? 800 : 600;
    return Response.json({
      choices: [{ message: { content } }],
      usage: { completion_tokens_details: { reasoning_tokens: tokens } },
    });
  }) as unknown as typeof fetch;
}

describe('ModelCapabilityService', () => {
  it('sorts every model of a connection by what it does, and asks nothing twice', async () => {
    const fetchImpl = provider();
    const settings = settingsWith(['chatter', 'writer', 'painter', 'ear', 'video']);
    const service = new ModelCapabilityService(
      new MemoryModelSettingsStore(),
      settings,
      prompts,
      fetchImpl,
    );
    await service.classify('hub', actor, true);
    const view = await service.withKinds(await settings.get(actor), actor);
    expect(view.connections[0]?.modelKinds).toEqual({
      chatter: ['text', 'vision'],
      writer: ['text'],
      painter: ['image'],
      ear: ['speech'],
      video: [],
    });
    const asked = vi.mocked(fetchImpl).mock.calls.length;
    await service.classify('hub', actor, false);
    await expect(service.speechModel(actor)).resolves.toMatchObject({ model: 'ear' });
    await expect(
      service.capabilitiesOf({ connectionId: 'hub', modelId: 'chatter' }, actor),
    ).resolves.toEqual({ reasoning: { toggle: 'reasoning-effort', levels: true }, probed: true });
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(asked);
  });

  it('asks again when the person checks the connection', async () => {
    const fetchImpl = provider();
    const service = new ModelCapabilityService(
      new MemoryModelSettingsStore(),
      settingsWith(['writer']),
      prompts,
      fetchImpl,
    );
    await service.classify('hub', actor, true);
    const asked = vi.mocked(fetchImpl).mock.calls.length;
    await service.classify('hub', actor, true);
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(asked * 2);
  });
});
