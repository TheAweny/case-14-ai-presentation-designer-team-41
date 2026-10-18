import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelRequestError } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import {
  ModelNotConfiguredError,
  type ModelSettingsService,
  type ResolvedModel,
} from '../models/model-settings.service.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import { ChatsService } from './chats.service.js';
import type { ChatToolScope } from './chat-tools.js';

const instances: ChatsService[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((service) => service.onApplicationShutdown()));
});
const resolved = (connectionId: string, model: string): ResolvedModel => ({
  connectionId,
  model,
  apiKey: 'private-test-key',
  baseUrl: 'https://model.example.test/v1',
  headers: {},
});

async function approvedTurn(
  picked: { connectionId: string; modelId: string } | null,
  options: {
    unavailable?: boolean;
    failure?: Error;
    assistantUnset?: boolean;
    resolutionFailure?: boolean;
  } = {},
) {
  const models = {
    resolveRole: vi.fn(async () =>
      options.assistantUnset ? null : resolved('assistant-connection', 'assistant-model'),
    ),
    resolve: vi.fn(async (ref: typeof picked) => {
      if (options.resolutionFailure)
        throw new ModelNotConfiguredError('Выбранная модель выключена.');
      return ref
        ? resolved(ref.connectionId, ref.modelId)
        : resolved('writer-connection', 'writer-model');
    }),
  };
  const service = new ChatsService(
    {} as GenerationService,
    models as unknown as ModelSettingsService,
    {
      reasoningOf: async () => {
        if (options.unavailable) throw new Error('Capabilities unavailable');
        return { toggle: null, levels: false };
      },
    } as unknown as ModelCapabilityService,
  );
  instances.push(service);
  Reflect.set(service, 'save', async () => undefined);
  Reflect.set(service, 'saveSoon', () => undefined);
  Reflect.set(service, 'loadAgent', async () => ({
    agent: { config: { generation: {} } },
    jsonMode: '',
  }));
  const build = vi.fn(async (_writer: unknown, _scope: ChatToolScope) => {
    if (options.failure) throw options.failure;
    return false;
  });
  Reflect.set(service, 'buildApproved', build);
  const state = {
    id: crypto.randomUUID(),
    ownerId: 'owner',
    title: 'Test',
    projectId: null,
    mode: 'plan',
    messages: [],
    deckIds: [],
    primaryDeckId: null,
  };
  await Reflect.apply(Reflect.get(service, 'answer'), service, [
    state,
    { mode: 'plan', model: picked, thinking: null, reasoningEffort: null },
    { id: 'owner', role: 'user' } as Account,
    { controller: new AbortController(), emit: () => undefined },
    {
      approved: {
        planId: crypto.randomUUID(),
        revision: 1,
        templateId: crypto.randomUUID(),
        outline: { title: 'Test', slides: [] },
      },
    },
  ]);
  return { models, build, state };
}

describe('chat to generation model routing', () => {
  it('never builds an approved plan with a substitute after the selected model is disabled', async () => {
    const { build, state, models } = await approvedTurn(
      { connectionId: 'personal', modelId: 'disabled' },
      { resolutionFailure: true },
    );
    expect(build).not.toHaveBeenCalled();
    expect(models.resolveRole).not.toHaveBeenCalled();
    expect(state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: 'error',
              failure: expect.objectContaining({
                kind: 'not-configured',
                modelId: 'disabled',
                connectionId: 'personal',
              }),
            }),
          ]),
        }),
      ]),
    );
  });

  it('passes the displayed assistant default to a confirmed build instead of the different writer', async () => {
    const { build, models } = await approvedTurn(null);
    expect(build).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        model: { connectionId: 'assistant-connection', modelId: 'assistant-model' },
      }),
      expect.anything(),
      expect.anything(),
    );
    expect(models.resolve).not.toHaveBeenCalled();
  });

  it('keeps the exact selected connection even when its model id equals a shared model', async () => {
    const picked = { connectionId: 'personal-connection', modelId: 'assistant-model' };
    const { build, models } = await approvedTurn(picked);
    expect(build.mock.calls[0]?.[1]).toMatchObject({ model: picked });
    expect(models.resolve).toHaveBeenCalledWith(picked, { userId: 'owner', admin: false });
    expect(models.resolveRole).not.toHaveBeenCalled();
  });

  it('uses the writer only when the assistant has no assignment', async () => {
    const { build } = await approvedTurn(null, { assistantUnset: true });
    expect(build.mock.calls[0]?.[1]).toMatchObject({
      model: { connectionId: 'writer-connection', modelId: 'writer-model' },
    });
  });

  it('keeps the assistant identity when optional post-approval commentary cannot initialize', async () => {
    const { build } = await approvedTurn(null, { unavailable: true });
    expect(build.mock.calls[0]?.[1]).toMatchObject({
      model: { connectionId: 'assistant-connection', modelId: 'assistant-model' },
    });
  });

  it('does not relabel a planner failure as the explicitly selected chat model', async () => {
    const failure = new ModelRequestError('Planner unavailable', {
      kind: 'unavailable',
      modelId: 'planner-model',
      connectionId: 'planner-connection',
    });
    const { state } = await approvedTurn(
      { connectionId: 'personal', modelId: 'chat-model' },
      { failure },
    );
    expect(state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parts: expect.arrayContaining([
            expect.objectContaining({
              type: 'error',
              failure: expect.objectContaining({
                modelId: 'planner-model',
                connectionId: 'planner-connection',
              }),
            }),
          ]),
        }),
      ]),
    );
  });
});
