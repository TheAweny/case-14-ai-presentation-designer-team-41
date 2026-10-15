import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatTurnRequest, DeckOutline } from '@lct/contracts';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import { ChatsService } from './chats.service.js';

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
  parts: [{ type: 'plan', callId: planId, planId, outline: outline(title), templateId, status }],
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
