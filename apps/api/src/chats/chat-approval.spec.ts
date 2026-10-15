import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatTurnRequest, DeckOutline } from '@lct/contracts';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import { ChatsService } from './chats.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

const account = { id: 'owner' } as Account;
const templateId = '00000000-0000-4000-8000-000000000001';
const outline = (title: string): DeckOutline => ({
  title,
  audience: '',
  goal: '',
  slides: Array.from({ length: 10 }, (_, index) => ({
    title: `${title} ${index}`,
    points: ['Бюджет 9 млн'],
    kind: 'statement',
  })),
});
const plan = (planId: string, status: 'proposed' | 'approved', title: string): ChatMessage => ({
  role: 'assistant',
  id: crypto.randomUUID(),
  createdAt: 1,
  status: 'done',
  parts: [
    {
      type: 'plan',
      callId: planId,
      planId,
      revision: 1,
      outline: outline(title),
      templateId,
      status,
    },
  ],
});
const services: ChatsService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onApplicationShutdown()));
});

function fixture(messages: ChatMessage[]) {
  const generation = { template: vi.fn(async () => ({})) } as unknown as GenerationService;
  const service = new ChatsService(generation, {} as ModelSettingsService);
  services.push(service);
  Reflect.set(
    service,
    'save',
    vi.fn(async () => undefined),
  );
  Reflect.set(
    service,
    'loadAgent',
    vi.fn(async () => ({})),
  );
  Reflect.set(
    service,
    'chatModel',
    vi.fn(async () => {
      throw new Error('No model needed');
    }),
  );
  const build = vi.fn(async () => undefined);
  Reflect.set(service, 'buildApproved', build);
  const state = {
    id: crypto.randomUUID(),
    ownerId: account.id,
    title: 'Chat',
    projectId: null,
    mode: 'plan',
    messages,
    deckIds: [],
    primaryDeckId: null,
  };
  const turn = { controller: new AbortController(), emit: vi.fn() };
  const invoke = (name: string, ...args: unknown[]): Promise<unknown> =>
    Reflect.apply(Reflect.get(service, name), service, args);
  const approve = (
    planId: string,
    edited: DeckOutline = outline('Edited'),
    revision = 1,
  ): ChatTurnRequest => ({
    mode: 'plan',
    model: null,
    projectId: null,
    deckId: null,
    slideCount: null,
    input: { type: 'approve-plan', planId, outline: edited, templateId, ...{ revision } },
  });
  return { service, state, turn, build, invoke, approve };
}

describe('approved plan snapshot regressions', () => {
  it('never announces a successful answer when its final state could not be saved', async () => {
    const id = crypto.randomUUID();
    const f = fixture([plan(id, 'proposed', 'New')]);
    const request = f.approve(id);
    const prepared = await f.invoke('acceptInput', f.state, request, account, f.turn);
    Reflect.set(
      f.service,
      'save',
      vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error('Storage unavailable')),
    );
    f.turn.emit.mockClear();
    await expect(f.invoke('answer', f.state, request, account, f.turn, prepared)).rejects.toThrow(
      'Storage unavailable',
    );
    const messages = f.turn.emit.mock.calls.map(
      ([event]) => event as { type: string; message?: { status: string } },
    );
    expect(messages.some((event) => event.message?.status === 'done')).toBe(false);
    expect(messages.at(-1)?.message?.status).toBe('failed');
  });
  it('records explicit user approval as the source of the accepted outline', async () => {
    const id = crypto.randomUUID();
    const f = fixture([plan(id, 'proposed', 'New')]);
    await f.invoke('acceptInput', f.state, f.approve(id), account, f.turn);
    expect(f.state.messages[0]).toMatchObject({ parts: [{ approvalSource: 'user' }] });
  });

  it('rejects an approval of an older plan after a newer plan exists', async () => {
    const old = crypto.randomUUID(),
      latest = crypto.randomUUID();
    const f = fixture([plan(old, 'approved', 'Old'), plan(latest, 'approved', 'Latest')]);
    await expect(
      f.invoke('acceptInput', f.state, f.approve(old, outline('Old')), account, f.turn),
    ).rejects.toThrow(/newer|replaced|latest/i);
  });

  it('never builds an approval submitted in read-only chat mode', async () => {
    const id = crypto.randomUUID();
    const f = fixture([plan(id, 'proposed', 'New')]);
    const input = { ...f.approve(id), mode: 'chat' };
    await expect(f.invoke('acceptInput', f.state, input, account, f.turn)).rejects.toThrow(
      /mode|режим/i,
    );
    expect(f.build).not.toHaveBeenCalled();
  });
  it('builds the second approved plan with the exact edited outline', async () => {
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    const f = fixture([plan(first, 'approved', 'Old'), plan(second, 'proposed', 'New')]);
    const edited = outline('Исправленный бюджет');
    const request = f.approve(second, edited);
    const prepared = await f.invoke('acceptInput', f.state, request, account, f.turn);
    await f.invoke('answer', f.state, request, account, f.turn, prepared);
    expect(f.build).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ planId: second, outline: edited, revision: 1 }),
    );
  });

  it('replays an identical approval without scheduling a second build', async () => {
    const id = crypto.randomUUID();
    const f = fixture([plan(id, 'proposed', 'New')]);
    const request = f.approve(id);
    await f.invoke('acceptInput', f.state, request, account, f.turn);
    const duplicate = await f.invoke('acceptInput', f.state, request, account, f.turn);
    expect(duplicate).toMatchObject({ replay: true, approved: null });
  });

  it('rejects edits to an already approved revision', async () => {
    const id = crypto.randomUUID();
    const f = fixture([plan(id, 'approved', 'Original')]);
    await expect(f.invoke('acceptInput', f.state, f.approve(id), account, f.turn)).rejects.toThrow(
      /revision|approved/i,
    );
  });

  it('rejects a stale revision before changing the plan', async () => {
    const id = crypto.randomUUID();
    const f = fixture([plan(id, 'proposed', 'Original')]);
    await expect(
      f.invoke('acceptInput', f.state, f.approve(id, outline('Stale'), 0), account, f.turn),
    ).rejects.toThrow(/revision/i);
    expect(f.state.messages[0]).toMatchObject({
      parts: [{ outline: { title: 'Original' }, status: 'proposed' }],
    });
  });
});

describe('build tool operation replay', () => {
  it('returns an existing completed operation instead of starting another build', async () => {
    const id = crypto.randomUUID(),
      buildId = crypto.randomUUID();
    const approved = plan(id, 'approved', 'Approved');
    if (approved.role !== 'assistant') throw new Error('Invalid fixture');
    const messages: ChatMessage[] = [
      approved,
      {
        role: 'assistant',
        id: crypto.randomUUID(),
        createdAt: 2,
        status: 'done',
        parts: [
          {
            type: 'build',
            callId: 'original',
            buildId,
            templateId,
            templateName: 'Template',
            runId: 'existing',
            variantRunIds: ['existing'],
            startedAt: 1,
            finishedAt: 2,
            status: 'done',
            error: null,
            ...{ planId: id, planRevision: 1 },
          },
          {
            type: 'result',
            buildId,
            variants: [{ variant: 'balanced', deckId: 'existing' }],
            reviews: null,
            recommended: 'balanced',
            elapsedMs: 1,
          },
        ],
      },
    ];
    const generation = {
      template: vi.fn(async () => {
        throw new Error('A replay must not prepare a template');
      }),
    } as unknown as GenerationService;
    const scope: ChatToolScope = {
      account,
      chatId: 'chat',
      projectId: null,
      mode: 'plan',
      model: null,
      messages: () => messages,
      updatePart: () => undefined,
      addDecks: () => undefined,
    };
    const build = chatTools(generation, scope).find((tool) => tool.name === 'build_deck');
    if (!build) throw new Error('Missing build tool');
    const outcome = await build.run(build.input.parse({ templateId, planId: id }), {
      callId: 'retry',
      signal: new AbortController().signal,
      show: () => 0,
      update: () => undefined,
    });
    expect(outcome.output).toMatchObject({
      status: 'done',
      reused: true,
      variants: [{ variant: 'balanced', deckId: 'existing' }],
    });
    expect(generation.template).not.toHaveBeenCalled();
  });
});
