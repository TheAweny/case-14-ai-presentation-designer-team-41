import { describe, expect, it, vi } from 'vitest';
import type { ModelDetails, ModelRef, ModelSettings } from '@lct/contracts';
import { ModelCapabilityService } from './model-capabilities.js';
import { MemoryModelSettingsStore } from './model-settings-store.js';
import type { ModelSettingsService, ResolvedModel } from './model-settings.service.js';

const actor = { userId: 'u', admin: false };
const baseUrl = 'https://hub.example.test/v1';

/** Settings with one checked connection offering `models`, described as `details` say. */
function settingsWith(
  models: string[],
  details: Record<string, ModelDetails> = {},
): ModelSettingsService {
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
        editable: true,
        lastCheck: { ok: true, at: '2026-10-17T00:00:00Z', models, details },
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

const prompts = async () => ({ version: '1.3.0', prompt: 'ok' });

/** A gateway that reads `reasoning_effort` for `thinker` only and drops it for the rest. */
function gateway() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    return body.model === 'thinker'
      ? new Response('unsupported reasoning effort: "lct-probe-no-such-effort"', { status: 400 })
      : Response.json({ choices: [{ message: { content: 'o' } }] });
  }) as unknown as typeof fetch;
}

describe('ModelCapabilityService', () => {
  it('takes thinking from the description and asks the rest once, for free', async () => {
    const fetchImpl = gateway();
    const store = new MemoryModelSettingsStore();
    const service = new ModelCapabilityService(
      store,
      settingsWith(['thinker', 'plain', 'described', 'ears'], {
        described: {
          kinds: ['text', 'vision'],
          reasoning: { toggle: 'enable-thinking', levels: false },
        },
        ears: { kinds: ['speech'] },
      }),
      prompts,
      fetchImpl,
    );
    await service.check('hub', actor, true);
    // Two chat models the description said nothing about: one free request each.
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
    const ask = (modelId: string) =>
      service.capabilitiesOf({ connectionId: 'hub', modelId }, actor);
    await expect(ask('thinker')).resolves.toMatchObject({
      reasoning: { toggle: 'reasoning-effort' },
    });
    await expect(ask('plain')).resolves.toMatchObject({
      reasoning: { toggle: null, levels: false },
    });
    await expect(ask('described')).resolves.toMatchObject({
      reasoning: { toggle: 'enable-thinking' },
    });
    await service.check('hub', actor, false);
    expect(vi.mocked(fetchImpl)).toHaveBeenCalledTimes(2);
  });

  it('finds the speech model the provider described, and lets the person correct a kind', async () => {
    const settings = settingsWith(['talker', 'ears'], { ears: { kinds: ['speech'] } });
    const service = new ModelCapabilityService(
      new MemoryModelSettingsStore(),
      settings,
      prompts,
      gateway(),
    );
    await expect(service.speechModel(actor)).resolves.toMatchObject({ model: 'ears' });
    await service.setManualKinds('hub', 'talker', ['vision'], actor);
    const view = await service.withManualKinds(await settings.get(actor), actor);
    // Seeing pictures is a kind of chatting.
    expect(view.connections[0]?.manualKinds).toEqual({ talker: ['text', 'vision'] });
    await service.setManualKinds('hub', 'talker', null, actor);
    const reset = await service.withManualKinds(await settings.get(actor), actor);
    expect(reset.connections[0]?.manualKinds).toEqual({});
  });
});
