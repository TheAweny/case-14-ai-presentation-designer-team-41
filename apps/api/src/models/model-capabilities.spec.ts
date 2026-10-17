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

const question = async () => ({ version: '1.1.0', question: 'q' });

describe('ModelCapabilityService', () => {
  it('asks a model once and answers later questions from what it kept', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { reasoning_effort?: string };
      const effort = body.reasoning_effort;
      if (effort && !['none', 'low', 'high'].includes(effort)) {
        return new Response('unsupported reasoning effort', { status: 400 });
      }
      const tokens = effort === 'none' ? 0 : effort ? 800 : 600;
      return Response.json({
        choices: [{ message: { content: '400' } }],
        usage: { completion_tokens_details: { reasoning_tokens: tokens } },
      });
    }) as unknown as typeof fetch;
    const store = new MemoryModelSettingsStore();
    const service = new ModelCapabilityService(store, settingsWith(['m']), question, fetchImpl);
    const ref = { connectionId: 'hub', modelId: 'm' };
    const [first, second] = await Promise.all([
      service.capabilitiesOf(ref, actor),
      service.capabilitiesOf(ref, actor),
    ]);
    expect(first).toEqual({
      reasoning: { toggle: 'reasoning-effort', levels: true },
      probed: true,
    });
    expect(second).toEqual(first);
    const asked = vi.mocked(fetchImpl).mock.calls.length;
    await service.capabilitiesOf(ref, actor);
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(asked);
  });

  it('finds the model that really transcribes, whatever the names', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const model = (init?.body as FormData).get('model');
      return model === 'house-voice'
        ? Response.json({ text: '' })
        : new Response('not a speech model', { status: 400 });
    }) as unknown as typeof fetch;
    const service = new ModelCapabilityService(
      new MemoryModelSettingsStore(),
      settingsWith(['chat-a', 'chat-b', 'house-voice', 'chat-c']),
      question,
      fetchImpl,
    );
    await expect(service.speechModel(actor)).resolves.toMatchObject({ model: 'house-voice' });
  });
});
