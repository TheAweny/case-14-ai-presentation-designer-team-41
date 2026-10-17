import { describe, expect, it, vi } from 'vitest';
import type { AssistantChatMessage, ChatEvent, ChatMessage, UserChatMessage } from '@lct/contracts';
import { canRetryAnswer, createChatStore } from './chat-store';
import { applyChatEvent, readChatEvents } from './chat-stream';

const USER = '00000000-0000-4000-8000-000000000001';
const ANSWER = '00000000-0000-4000-8000-000000000002';

const user: UserChatMessage = {
  role: 'user',
  id: USER,
  text: 'Привет',
  attachments: [],
  mode: 'chat',
  createdAt: 1,
};
const answer: AssistantChatMessage = {
  role: 'assistant',
  id: ANSWER,
  parts: [],
  status: 'streaming',
  createdAt: 2,
};

describe('research turn recovery', () => {
  it('allows retry after a failed answer that only researched materials', () => {
    expect(
      canRetryAnswer([
        user,
        {
          ...answer,
          status: 'failed',
          parts: [
            {
              type: 'tool',
              callId: 'research',
              name: 'research_materials',
              input: {},
              status: 'done',
              output: {},
            },
          ],
        },
      ]),
    ).toBe(true);
  });

  it('refuses answer retry after research followed by a build', () => {
    expect(
      canRetryAnswer([
        user,
        {
          ...answer,
          status: 'failed',
          parts: [
            {
              type: 'tool',
              callId: 'research',
              name: 'research_materials',
              input: {},
              status: 'done',
              output: {},
            },
            {
              type: 'tool',
              callId: 'build',
              name: 'build_deck',
              input: {},
              status: 'done',
              output: {},
            },
          ],
        },
      ]),
    ).toBe(false);
  });
});

function sse(events: ChatEvent[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

const CONTINUATION = 'Продолжи с места остановки, учитывая уже выполненные действия.';
const CHAT_MODEL = { connectionId: 'conn', modelId: 'base' };
const PICKED_MODEL = { connectionId: 'picked', modelId: 'replacement' };

function failedChat(chatId: string, running = false) {
  return {
    chatId,
    title: 'Чат',
    projectId: null,
    deckIds: [] as string[],
    deckId: null,
    mode: 'chat' as const,
    model: CHAT_MODEL,
    createdAt: '2026-09-29T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
    messages: [
      user,
      {
        ...answer,
        status: 'failed' as const,
        parts: [{ type: 'error' as const, message: 'stopped' }],
      },
    ],
    running,
  };
}

function continuationStream(): Response {
  return sse([
    {
      type: 'message',
      seq: 0,
      message: {
        ...user,
        role: 'user' as const,
        id: '00000000-0000-4000-8000-000000000011',
        text: CONTINUATION,
      },
    },
    {
      type: 'message',
      seq: 1,
      message: {
        ...answer,
        role: 'assistant' as const,
        id: '00000000-0000-4000-8000-000000000012',
        status: 'done',
        parts: [{ type: 'text', text: 'Дальше.' }],
      },
    },
    { type: 'turn-end', seq: 2 },
  ]);
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
  it('reports EOF without turn-end as an interrupted turn', async () => {
    const response = sse([{ type: 'message', seq: 0, message: answer }]);
    if (!response.body) throw new Error('Missing test stream.');
    await expect(readChatEvents(response.body, () => undefined)).rejects.toThrow();
  });
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
  it('reconciles an interrupted stream with the saved server document without resending the turn', async () => {
    const chatId = '00000000-0000-4000-8000-0000000000cc';
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/turns'))
        return sse([
          { type: 'message', seq: 0, message: user },
          { type: 'message', seq: 1, message: answer },
        ]);
      return Response.json({
        chatId,
        title: 'Чат',
        projectId: null,
        deckIds: [],
        deckId: null,
        mode: 'chat',
        createdAt: '2026-09-29T00:00:00.000Z',
        updatedAt: '2026-09-29T00:00:00.000Z',
        messages: [
          user,
          { ...answer, status: 'done', parts: [{ type: 'text', text: 'Сохранённый ответ.' }] },
        ],
        running: false,
      });
    });
    const onTurnEnd = vi.fn();
    const store = createChatStore({
      request,
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
      onTurnEnd,
    });
    store.start(
      chatId,
      { projectId: null, mode: 'chat', model: null },
      { text: 'Привет', files: [] },
    );
    await vi.waitFor(() =>
      expect(store.get(chatId)?.messages[1]).toMatchObject({
        status: 'done',
        parts: [{ text: 'Сохранённый ответ.' }],
      }),
    );
    expect(request.mock.calls.filter(([path]) => path.endsWith('/turns'))).toHaveLength(1);
    expect(onTurnEnd).toHaveBeenCalledTimes(1);
  });
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

  it('rebuilds a failed variant: shows it rebuilding, then the result the server finished', async () => {
    vi.useFakeTimers();
    const chatId = '00000000-0000-4000-8000-0000000000c1';
    const buildId = '00000000-0000-4000-8000-0000000000b1';
    const base = {
      type: 'result' as const,
      buildId,
      variants: [{ variant: 'balanced' as const, deckId: 'run-balanced' }],
      reviews: null,
      recommended: 'balanced' as const,
      elapsedMs: 1000,
    };
    const failed = {
      ...base,
      failed: [
        { variant: 'dense' as const, runId: 'run-dense', status: 'failed' as const, reason: null },
      ],
    };
    const retrying = {
      ...base,
      failed: [
        {
          variant: 'dense' as const,
          runId: 'run-dense-2',
          status: 'retrying' as const,
          reason: null,
        },
      ],
    };
    const finished = {
      ...base,
      variants: [
        { variant: 'dense' as const, deckId: 'run-dense-2' },
        { variant: 'balanced' as const, deckId: 'run-balanced' },
      ],
    };
    const chat = (result: object) =>
      Response.json({
        chatId,
        title: 'Чат',
        projectId: null,
        deckIds: [],
        deckId: null,
        mode: 'auto',
        createdAt: '2026-10-16T00:00:00.000Z',
        updatedAt: '2026-10-16T00:00:00.000Z',
        messages: [user, { ...answer, status: 'done', parts: [result] }],
        running: false,
      });
    let reads = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === `/chats/${chatId}/variants/retry`) {
        expect(JSON.parse(String(init?.body))).toEqual({ buildId, variant: 'dense' });
        return Response.json(retrying);
      }
      reads += 1;
      // Первое чтение — открыть чат, второе — пересборка ещё идёт, третье — готово.
      return chat(reads === 1 ? failed : reads === 2 ? retrying : finished);
    });
    const onTurnEnd = vi.fn();
    const store = createChatStore({
      request,
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
      onTurnEnd,
    });
    const resultIn = () => {
      const message = store.get(chatId)?.messages[1];
      return message?.role === 'assistant' ? message.parts[0] : undefined;
    };
    await store.load(chatId);
    await store.retryVariant(chatId, buildId, 'dense');
    expect(resultIn()).toMatchObject({ failed: [{ status: 'retrying', runId: 'run-dense-2' }] });
    await vi.advanceTimersByTimeAsync(4000);
    expect(resultIn()).toMatchObject({ failed: [{ status: 'retrying' }] });
    await vi.advanceTimersByTimeAsync(4000);
    expect(resultIn()).toEqual(finished);
    expect(onTurnEnd).toHaveBeenCalledWith(chatId);
    // Итог дописан — больше не спрашиваем.
    const after = request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);
    expect(request.mock.calls.length).toBe(after);
    vi.useRealTimers();
  });

  it('passes on why the server refused to rebuild a variant', async () => {
    const request = vi.fn(async () =>
      Response.json({ message: 'Only a failed variant can be built again.' }, { status: 409 }),
    );
    const store = createChatStore({
      request,
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
    });
    await expect(
      store.retryVariant('00000000-0000-4000-8000-0000000000c1', 'b', 'dense'),
    ).rejects.toThrow('Only a failed variant can be built again.');
  });

  it('continues a failed answer as one new message and keeps the draft', async () => {
    const chatId = '00000000-0000-4000-8000-0000000000c2';
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      if (path === `/chats/${chatId}/turns`) return continuationStream();
      return Response.json(failedChat(chatId));
    });
    const uploadContent = vi.fn(async () => ({ fileId: 'f', name: 'f', size: 0 }));
    const store = createChatStore({
      request,
      uploadContent,
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
    });
    await store.load(chatId);
    const file = new File(['notes'], 'notes.md');
    const kept = {
      kind: 'file' as const,
      fileId: '00000000-0000-4000-8000-00000000000f',
      name: 'kept.md',
      size: 4,
    };
    store.setDraft(chatId, {
      text: 'unsaved',
      files: [file],
      templateFile: null,
      attachments: [kept],
    });
    store.continueAfterFailure(chatId, ANSWER, CONTINUATION, PICKED_MODEL);
    expect(store.get(chatId)?.pending).toMatchObject({
      text: CONTINUATION,
      attachments: [],
      failed: null,
    });
    expect(store.get(chatId)?.draft).toMatchObject({ text: 'unsaved', attachments: [kept] });
    expect(store.get(chatId)?.draft.files[0]).toBe(file);
    await vi.waitFor(() => expect(store.get(chatId)?.running).toBe(false));
    const turns = request.mock.calls.filter(([path]) => String(path).endsWith('/turns'));
    expect(turns).toHaveLength(1);
    expect(turns[0]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(turns[0]?.[1]?.body))).toMatchObject({
      model: PICKED_MODEL,
      input: { type: 'message', text: CONTINUATION, attachments: [] },
    });
    expect(request.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
    expect(uploadContent).not.toHaveBeenCalled();
    expect(store.get(chatId)?.model).toEqual(CHAT_MODEL);
    expect(store.get(chatId)?.draft).toMatchObject({ text: 'unsaved', attachments: [kept] });
    expect(store.get(chatId)?.draft.files[0]).toBe(file);
  });

  it('sends the continuation once when the button is clicked twice', async () => {
    const chatId = '00000000-0000-4000-8000-0000000000c3';
    const request = vi.fn(async (path: string) => {
      if (path === `/chats/${chatId}/turns`) return continuationStream();
      return Response.json(failedChat(chatId));
    });
    const store = createChatStore({
      request,
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
    });
    await store.load(chatId);
    store.continueAfterFailure(chatId, ANSWER, CONTINUATION);
    store.continueAfterFailure(chatId, ANSWER, CONTINUATION);
    await vi.waitFor(() => expect(store.get(chatId)?.running).toBe(false));
    expect(request.mock.calls.filter(([path]) => String(path).endsWith('/turns'))).toHaveLength(1);
  });

  it('does not post for a stale failure card or while a turn is running', async () => {
    const staleId = '00000000-0000-4000-8000-0000000000c4';
    const staleRequest = vi.fn(async (_path: string) => Response.json(failedChat(staleId)));
    const stale = createChatStore({
      request: staleRequest,
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
    });
    await stale.load(staleId);
    stale.continueAfterFailure(staleId, USER, CONTINUATION);
    expect(
      staleRequest.mock.calls.filter(([path]) => String(path).endsWith('/turns')),
    ).toHaveLength(0);

    const busyId = '00000000-0000-4000-8000-0000000000c5';
    let releaseTurn: (response: Response) => void = (_response): void => undefined;
    const turnGate = new Promise<Response>((resolve) => {
      releaseTurn = resolve;
    });
    const busyRequest = vi.fn(async (path: string) => {
      if (path === `/chats/${busyId}/turns`) return turnGate;
      return Response.json(failedChat(busyId));
    });
    const busy = createChatStore({
      request: busyRequest,
      uploadContent: async () => ({ fileId: 'f', name: 'f', size: 0 }),
      uploadTemplate: async () => ({ templateId: 't', name: 't' }),
    });
    await busy.load(busyId);
    busy.continueAfterFailure(busyId, ANSWER, CONTINUATION);
    await vi.waitFor(() => expect(busy.get(busyId)?.running).toBe(true));
    busy.continueAfterFailure(busyId, ANSWER, CONTINUATION, PICKED_MODEL);
    expect(busyRequest.mock.calls.filter(([path]) => String(path).endsWith('/turns'))).toHaveLength(
      1,
    );
    releaseTurn(continuationStream());
    await vi.waitFor(() => expect(busy.get(busyId)?.running).toBe(false));
  });
});
