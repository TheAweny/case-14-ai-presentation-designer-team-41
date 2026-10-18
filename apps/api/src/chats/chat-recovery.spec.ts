import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatTurnRequest } from '@lct/contracts';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import type { ModelSettingsService } from '../models/model-settings.service.js';
import type { ModelCapabilityService } from '../models/model-capabilities.js';
import { ChatsService } from './chats.service.js';

const account = { id: 'owner' } as Account;
const chatId = '00000000-0000-4000-8000-000000000010';
const userId = '00000000-0000-4000-8000-000000000011';
const request = (text = 'Построй презентацию'): ChatTurnRequest => ({
  mode: 'plan',
  model: null,
  reasoningEffort: null,
  thinking: null,
  projectId: null,
  deckId: null,
  slideCount: null,
  input: { type: 'message', text, attachments: [] },
  ...{ requestId: userId },
});
const pending: (() => void)[] = [];
const services: ChatsService[] = [];
afterEach(async () => {
  pending.splice(0).forEach((finish) => finish());
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(services.splice(0).map((service) => service.onApplicationShutdown()));
});

function database(messages: ChatMessage[] = []) {
  let deleted = false;
  const sessions = new Set<{
    listening: boolean;
    listeners: Map<string, (value: { channel: string; payload: string }) => void>;
  }>();
  const row = {
    id: chatId,
    owner_id: account.id,
    title: 'Chat',
    project_id: null,
    deck_ids: [],
    primary_deck_id: null,
    mode: 'plan',
    messages,
    model: null as { connectionId: string; modelId: string } | null,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const locks = new Set<string>();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('pg_notify')) {
      for (const session of sessions)
        if (session.listening)
          session.listeners.get('notification')?.({
            channel: 'chat_turn_cancel',
            payload: String(values[0]),
          });
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes('INSERT INTO chats')) {
      deleted = false;
      row.messages = JSON.parse(String(values[7])) as ChatMessage[];
      row.model = JSON.parse(String(values[8] ?? null)) as typeof row.model;
    }
    if (deleted) return { rows: [], rowCount: 0 };
    if (sql.includes('UPDATE chats SET title') && values[6] === true)
      row.model = JSON.parse(String(values[7])) as typeof row.model;
    if (sql.includes('UPDATE chats SET mode'))
      row.messages = JSON.parse(String(values[5])) as ChatMessage[];
    if (sql.includes('DELETE FROM chats') && values[1] !== account.id)
      return { rows: [], rowCount: 0 };
    if (sql.includes('DELETE FROM chats')) deleted = true;
    if (sql.includes('WHERE id = $1 AND owner_id = $2') && values[1] !== account.id)
      return { rows: [], rowCount: 0 };
    return { rows: [row], rowCount: 1 };
  });
  const pool = {
    query,
    end: async () => undefined,
    connect: vi.fn(async () => {
      let held: string | null = null;
      const session = {
        listening: false,
        listeners: new Map<string, (value: { channel: string; payload: string }) => void>(),
      };
      sessions.add(session);
      return {
        query: async (sql: string, values: unknown[] = []) => {
          if (sql === 'LISTEN chat_turn_cancel') {
            session.listening = true;
            return { rows: [] };
          }
          if (sql === 'UNLISTEN chat_turn_cancel') {
            session.listening = false;
            return { rows: [] };
          }
          if (sql.includes('pg_try_advisory_lock')) {
            const key = String(values[0]);
            if (locks.has(key)) return { rows: [{ acquired: false }] };
            locks.add(key);
            held = key;
            return { rows: [{ acquired: true }] };
          }
          if (sql.includes('pg_advisory_unlock')) {
            if (held) locks.delete(held);
            held = null;
            return { rows: [] };
          }
          return query(sql, values);
        },
        on: (event: string, listener: (value: { channel: string; payload: string }) => void) =>
          session.listeners.set(event, listener),
        off: (event: string) => session.listeners.delete(event),
        release: () => {
          if (held) locks.delete(held);
          sessions.delete(session);
        },
      };
    }),
  };
  return { row, pool, exists: () => !deleted };
}

function service(db: ReturnType<typeof database>) {
  const instance = new ChatsService(
    {} as GenerationService,
    {} as ModelSettingsService,
    {} as ModelCapabilityService,
  );
  Reflect.set(instance, 'pool', db.pool);
  Reflect.set(instance, 'lockPool', db.pool);
  const answer = vi.fn(async () => new Promise<void>((resolve) => pending.push(resolve)));
  Reflect.set(instance, 'answer', answer);
  services.push(instance);
  return { instance, answer };
}

describe('durable chat execution regressions', () => {
  it('attaches from another API process and streams snapshots until the owner finishes', async () => {
    const db = database();
    const owner = service(db),
      viewer = service(db);
    await owner.instance.startTurn(chatId, request(), account);
    const stream = await viewer.instance.attach(chatId, account);
    expect(stream).not.toBeNull();
    if (!stream) return;
    const events: string[] = [];
    const stop = stream.watch((event) => events.push(event.type), true);
    pending.shift()?.();
    await vi.waitFor(() => expect(events).toContain('turn-end'), { timeout: 2000 });
    stop();
    expect(events).toContain('message');
  });

  it('cancels the turn owned by another API process after checking ownership', async () => {
    const db = database();
    const owner = service(db),
      remote = service(db);
    const turn = await owner.instance.startTurn(chatId, request(), account);
    await remote.instance.cancel(chatId, account);
    expect(turn.controller.signal.aborted).toBe(true);
  });

  it('never recreates a deleted chat from a delayed progress save', async () => {
    const db = database();
    const f = service(db);
    const state = Reflect.apply(Reflect.get(f.instance, 'stateOf'), f.instance, [
      db.row,
      account.id,
    ]);
    await f.instance.remove(chatId, account);
    const result = await (
      Reflect.apply(Reflect.get(f.instance, 'save'), f.instance, [state]) as Promise<void>
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result).toBeInstanceOf(Error);
    expect(db.exists()).toBe(false);
  });
  it('rejects oversized UTF-8 chat documents before acknowledging a saved message', async () => {
    const db = database();
    const f = service(db);
    const result = await f.instance.startTurn(chatId, request('я'.repeat(2200000)), account).then(
      () => null,
      (error: unknown) => error,
    );
    expect(result instanceof Error && /large|объём|размер/i.test(result.message)).toBe(true);
    expect(f.answer).not.toHaveBeenCalled();
  });
  it('rejects a second API process while another process holds the chat turn', async () => {
    const db = database();
    const first = service(db),
      second = service(db);
    await first.instance.startTurn(chatId, request(), account);
    await expect(second.instance.startTurn(chatId, request(), account)).rejects.toThrow(
      /already|running|answering/i,
    );
    expect(second.answer).not.toHaveBeenCalled();
  });

  it('replays a persisted request after restart without appending or answering again', async () => {
    const db = database([
      {
        role: 'user',
        id: userId,
        text: 'Построй презентацию',
        attachments: [],
        mode: 'plan',
        createdAt: 1,
      },
    ]);
    const restarted = service(db);
    const turn = await restarted.instance.startTurn(chatId, request(), account);
    expect(turn.finished).toBe(true);
    expect(db.row.messages).toHaveLength(1);
    expect(restarted.answer).not.toHaveBeenCalled();
  });

  it('marks abandoned streaming messages as interrupted after restart', async () => {
    const db = database([
      {
        role: 'assistant',
        id: crypto.randomUUID(),
        createdAt: 1,
        status: 'streaming',
        parts: [{ type: 'text', text: 'Начал ответ' }],
      },
    ]);
    const restarted = service(db);
    const document = await restarted.instance.get(chatId, account);
    expect(document.running).toBe(false);
    expect(document.messages[0]).toMatchObject({
      status: 'failed',
      parts: expect.arrayContaining([
        expect.objectContaining({
          type: 'error',
          message: expect.stringMatching(/прерван|interrupted/i),
        }),
      ]),
    });
  });

  it('checks ownership before a remove request can abort a running turn', async () => {
    const db = database();
    const owner = service(db);
    const turn = await owner.instance.startTurn(chatId, request(), account);
    await expect(owner.instance.remove(chatId, { id: 'attacker' } as Account)).rejects.toThrow();
    expect(turn.controller.signal.aborted).toBe(false);
  });
});

describe('durable chat model selection', () => {
  it('validates the selection, returns it after reload, and never overwrites it with streamed messages', async () => {
    const db = database();
    const { instance } = service(db);
    const primary = { connectionId: 'server', modelId: 'primary' };
    await instance.update(chatId, { model: primary }, account);
    expect((await instance.get(chatId, account)).model).toEqual(primary);
    const state = Reflect.apply(Reflect.get(instance, 'stateOf'), instance, [db.row, account.id]);
    const other = { connectionId: 'server', modelId: 'other' };
    await instance.update(chatId, { model: other }, account);
    await Reflect.apply(Reflect.get(instance, 'save'), instance, [state]);
    expect((await instance.get(chatId, account)).model).toEqual(other);
    await instance.update(chatId, { model: null }, account);
    expect((await instance.get(chatId, account)).model).toBeNull();
    await expect(
      instance.update(chatId, { model: { modelId: 'missing-connection' } }, account),
    ).rejects.toThrow('Invalid model selection');
    await expect(
      instance.update(chatId, { model: primary }, { id: 'other' } as Account),
    ).rejects.toThrow('Chat not found');
  });
});
