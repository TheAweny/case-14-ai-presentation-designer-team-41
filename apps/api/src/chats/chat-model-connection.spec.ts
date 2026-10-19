import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresProviderLedger } from '@lct/run-store';
import { ModelRequestError } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import type { ModelSettingsService, ResolvedModel } from '../models/model-settings.service.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import { ChatsService } from './chats.service.js';
import type { ChatAgent } from '@lct/pipeline';
import type { ChatTurnRequest } from '@lct/contracts';

const account = { id: 'owner' } as Account;
const services: ChatsService[] = [];
beforeEach(() => {
  vi.spyOn(PostgresProviderLedger.prototype, 'begin').mockResolvedValue('test-attempt');
  vi.spyOn(PostgresProviderLedger.prototype, 'end').mockResolvedValue(undefined);
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onApplicationShutdown()));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const quotaBody = JSON.stringify({
  error: {
    code: 'token_quota_exhausted',
    type: 'token_quota_exhausted',
    message: 'API token quota exhausted. request-id secret-request-9',
  },
});

function resolved(connectionId: string): ResolvedModel {
  return {
    connectionId,
    baseUrl: 'https://models.example/v1',
    apiKey: 'secret-key',
    model: 'qwen3.8-max-preview',
    headers: { 'Project-ID': 'secret-project' },
  };
}

function service(models: Pick<ModelSettingsService, 'resolve' | 'resolveRole'>): ChatsService {
  const instance = new ChatsService(
    {} as GenerationService,
    models as ModelSettingsService,
    {
      reasoningOf: vi.fn(async () => ({ toggle: null, levels: false })),
    } as unknown as ModelCapabilityService,
  );
  services.push(instance);
  return instance;
}

const agent = {
  jsonMode: 'Answer as JSON.',
  agent: { config: { generation: { maxOutputTokens: 32 } } },
} as ChatAgent;

const request = {
  mode: 'chat',
  model: null,
  reasoningEffort: null,
} as ChatTurnRequest;

async function chatModel(
  instance: ChatsService,
): Promise<{ step(input: unknown): Promise<unknown> } & Record<string, unknown>> {
  return Reflect.apply(Reflect.get(instance, 'chatModel'), instance, [request, account, agent]);
}

describe('chat model connection on quota failure', () => {
  it('keeps the assistant connection when the chat has no picked model', async () => {
    const fetchImpl = vi.fn(async () => new Response(quotaBody, { status: 403 }));
    vi.stubGlobal('fetch', fetchImpl);
    const models = {
      resolve: vi.fn(),
      resolveRole: vi.fn(async (role: string) =>
        role === 'assistant' ? resolved('assistant-connection') : null,
      ),
    };
    const model = await chatModel(service(models));
    await expect(
      model.step({ messages: [], tools: [], signal: AbortSignal.timeout(5000) }),
    ).rejects.toMatchObject({
      message: 'Model API HTTP 403 for qwen3.8-max-preview.',
      failure: {
        kind: 'quota-exhausted',
        modelId: 'qwen3.8-max-preview',
        connectionId: 'assistant-connection',
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(models.resolve).not.toHaveBeenCalled();
    expect(model.model).toBe('qwen3.8-max-preview');
    expect(model.contextOverheadChars).toBe('Answer as JSON.'.length);
    expect(JSON.stringify(model)).not.toMatch(/secret-key|secret-project/);
  });

  it('uses the writer connection when the assistant role is unset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(quotaBody, { status: 403 })),
    );
    const models = {
      resolveRole: vi.fn(async () => null),
      resolve: vi.fn(async () => resolved('writer-connection')),
    };
    const model = await chatModel(service(models));
    const error = await model
      .step({ messages: [], tools: [], signal: AbortSignal.timeout(5000) })
      .then(() => {
        throw new Error('The quota refusal should fail the step.');
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error).toMatchObject({
      failure: { kind: 'quota-exhausted', connectionId: 'writer-connection' },
    });
    expect(String(error)).not.toMatch(/secret-key|secret-project|secret-request/);
    expect(models.resolve).toHaveBeenCalledWith(null, { userId: account.id, admin: false });
  });
});

describe('chat thinking', () => {
  it('thinks as the assistant config says, whatever the deck switch of the turn', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ choices: [{ message: { content: 'Ок' }, finish_reason: 'stop' }] }),
    );
    vi.stubGlobal('fetch', fetchImpl);
    const instance = new ChatsService(
      {} as GenerationService,
      {
        resolve: vi.fn(async () => resolved('own')),
        resolveRole: vi.fn(async () => null),
      } as unknown as ModelSettingsService,
      {
        reasoningOf: vi.fn(async () => ({ toggle: 'enable-thinking', levels: false })),
      } as unknown as ModelCapabilityService,
    );
    services.push(instance);
    const thinkingAgent = {
      jsonMode: 'Answer as JSON.',
      agent: { config: { generation: { maxOutputTokens: 32, thinking: true } } },
    } as ChatAgent;
    const model = (await Reflect.apply(Reflect.get(instance, 'chatModel'), instance, [
      { ...request, thinking: false },
      account,
      thinkingAgent,
    ])) as { step(input: unknown): Promise<unknown> };
    await model.step({
      messages: [],
      tools: [],
      signal: AbortSignal.timeout(5000),
      onText: () => undefined,
    });
    const body = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
  });
});
