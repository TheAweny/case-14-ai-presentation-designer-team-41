import { describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ChatMessage } from '@lct/contracts';
import { createChatStore } from './chat-store';
import { applyChatEvent, readChatEvents } from './chat-stream';

const USER = '00000000-0000-4000-8000-000000000001';
const ANSWER = '00000000-0000-4000-8000-000000000002';

const user: ChatMessage = {
  role: 'user',
  id: USER,
  text: 'Привет',
  attachments: [],
  mode: 'chat',
  createdAt: 1,
};
const answer: ChatMessage = {
  role: 'assistant',
  id: ANSWER,
  parts: [],
  status: 'streaming',
  createdAt: 2,
};

function sse(events: ChatEvent[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('applyChatEvent', () => {
  it('builds an answer from messages, parts and text deltas', () => {
    const events: ChatEvent[] = [
      { type: 'message', seq: 0, message: user },
      { type: 'message', seq: 1, message: answer },
      { type: 'text-delta', seq: 2, messageId: ANSWER, index: 0, delta: 'Здра' },
      { type: 'text-delta', seq: 3, messageId: ANSWER, index: 0, delta: 'вствуйте' },
      {
        type: 'part',
        seq: 4,
        messageId: ANSWER,
        index: 1,
        part: { type: 'tool', callId: 'c', name: 'list_templates', input: {}, status: 'running' },
      },
      { type: 'message', seq: 5, message: { ...answer, status: 'done', parts: [] } },
    ];
    const states = events.reduce<ChatMessage[][]>(
      (all, event) => [...all, [...applyChatEvent(all.at(-1) ?? [], event)]],
      [],
    );
    expect(states[4]?.[1]).toMatchObject({
      parts: [
        { type: 'text', text: 'Здравствуйте' },
        { type: 'tool', status: 'running' },
      ],
    });
    // Сообщение целиком заменяет прежнее с тем же id, а не добавляется.
    expect(states[5]).toHaveLength(2);
    expect(states[5]?.[1]).toMatchObject({ status: 'done' });
  });
});

describe('readChatEvents', () => {
  it('reads events split between chunks and skips broken lines', async () => {
    const text = `data: ${JSON.stringify({ type: 'ping', seq: 0 })}\n\ndata: {broken\n\ndata: ${JSON.stringify({ type: 'turn-end', seq: 1 })}\n\n`;
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 7));
        controller.enqueue(bytes.slice(7));
        controller.close();
      },
    });
    const seen: string[] = [];
    await readChatEvents(body, (event) => seen.push(event.type));
    expect(seen).toEqual(['ping', 'turn-end']);
  });
});

describe('chat store', () => {
  it('starts a chat: uploads files, sends the turn and follows its answer', async () => {
    const request = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>(async () =>
      sse([
        { type: 'message', seq: 0, message: user },
        { type: 'message', seq: 1, message: { ...answer, status: 'done' } },
        { type: 'turn-end', seq: 2 },
      ]),
    );
    const uploadContent = vi.fn(async (file: File) => ({
      fileId: '00000000-0000-4000-8000-00000000000f',
      name: file.name,
      size: file.size,
    }));
    const onTurnEnd = vi.fn();
    const store = createChatStore({
      request,
      uploadContent,
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
      onTurnEnd,
    });
    const chatId = '00000000-0000-4000-8000-0000000000cc';
    store.start(
      chatId,
      { projectId: null, mode: 'plan', model: null },
      { text: 'Привет', files: [new File(['a'], 'notes.md')] },
    );
    expect(store.get(chatId)?.pending).toMatchObject({ text: 'Привет', failed: null });
    await vi.waitFor(() => expect(onTurnEnd).toHaveBeenCalled());

    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as {
      mode: string;
      input: { attachments: { kind: string; name: string }[] };
    };
    expect(request.mock.calls[0]?.[0]).toBe(`/chats/${chatId}/turns`);
    expect(body.mode).toBe('plan');
    expect(body.input.attachments).toEqual([
      expect.objectContaining({ kind: 'file', name: 'notes.md' }),
    ]);
    expect(store.get(chatId)).toMatchObject({ pending: null, running: false });
    expect(store.get(chatId)?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
    ]);
  });

  it('keeps a message that did not go, with the reason', async () => {
    const store = createChatStore({
      request: async () =>
        Response.json({ message: 'The chat is answering already.' }, { status: 409 }),
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
    });
    const chatId = '00000000-0000-4000-8000-0000000000dd';
    store.start(chatId, { projectId: null, mode: 'chat', model: null }, { text: 'Ещё', files: [] });
    await vi.waitFor(() =>
      expect(store.get(chatId)?.pending?.failed).toBe('The chat is answering already.'),
    );
    expect(store.get(chatId)?.running).toBe(false);
  });

  it('answers a missing chat as missing and attaches to a running one', async () => {
    const running = '00000000-0000-4000-8000-0000000000ee';
    const request = vi.fn(async (path: string) => {
      if (path === '/chats/missing') return new Response('', { status: 404 });
      if (path === `/chats/${running}/stream`)
        return sse([
          { type: 'message', seq: -1, message: answer },
          { type: 'turn-end', seq: 0 },
        ]);
      return Response.json({
        chatId: running,
        title: 'Чат',
        projectId: null,
        deckIds: [],
        deckId: null,
        mode: 'auto',
        createdAt: '2026-09-29T00:00:00.000Z',
        updatedAt: '2026-09-29T00:00:00.000Z',
        messages: [user],
        running: true,
      });
    });
    const store = createChatStore({
      request,
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
    });
    await store.load('missing');
    expect(store.get('missing')?.status).toBe('missing');
    await store.load(running);
    expect(store.get(running)).toMatchObject({ status: 'ready', mode: 'auto', running: false });
    expect(store.get(running)?.messages).toHaveLength(2);
  });
});
