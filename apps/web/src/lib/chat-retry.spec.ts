import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatTurnRequest } from '@lct/contracts';
import { canRetryAnswer, createChatStore, type ChatStoreDeps } from './chat-store';
import { canRetryChat, chatRetryDelay, ChatHttpError } from './chat-retry';

const ID = '00000000-0000-4000-8000-0000000000cc';
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
  parts: [{ type: 'text', text: 'Ответ' }],
  status: 'done',
  createdAt: 2,
};
const document = (messages: ChatMessage[], running = false) =>
  Response.json({
    chatId: ID,
    title: 'Чат',
    projectId: null,
    deckIds: [],
    deckId: null,
    mode: 'chat',
    createdAt: '2026-10-15T00:00:00.000Z',
    updatedAt: '2026-10-15T00:00:00.000Z',
    messages,
    running,
  });
function response(requestId = USER) {
  return new Response(
    [
      { type: 'message', seq: 0, message: { ...user, id: requestId } },
      { type: 'message', seq: 1, message: answer },
      { type: 'turn-end', seq: 2 },
    ]
      .map((event) => `data: ${JSON.stringify(event)}\n\n`)
      .join(''),
  );
}
function setup(deps: Partial<ChatStoreDeps> = {}) {
  const store = createChatStore({
    request: async () => response(),
    uploadContent: async (file) => ({ fileId: USER, name: file.name, size: file.size }),
    uploadTemplate: async (file) => ({ templateId: USER, name: file.name }),
    wait: async () => undefined,
    ...deps,
  });
  store.draft(ID, { mode: 'chat', model: null, projectId: null });
  return store;
}

describe('chat recovery', () => {
  it('retries reading server state before deciding whether to resend a lost POST', async () => {
    let requestId = '';
    let reads = 0;
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/turns')) {
        requestId = (JSON.parse(String(init?.body)) as ChatTurnRequest).requestId ?? '';
        throw new TypeError('Connection lost');
      }
      if (++reads === 1) throw new TypeError('Still offline');
      return document([{ ...user, id: requestId }, answer]);
    });
    const store = setup({ request });
    store.send(ID, { text: 'Привет', files: [] });
    await vi.waitFor(() => expect(store.get(ID)?.messages).toHaveLength(2));
    expect(request.mock.calls.filter(([path]) => path.endsWith('/turns'))).toHaveLength(1);
    expect(reads).toBeGreaterThan(1);
  });

  it('preserves a newer draft when stopping an upload', async () => {
    let complete: (() => void) | undefined;
    const store = setup({
      uploadContent: async (file) => {
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
        return { fileId: USER, name: file.name, size: file.size };
      },
    });
    store.send(ID, { text: 'Первый запрос', files: [new File(['a'], 'notes.md')] });
    store.setDraft(ID, { text: 'Следующий запрос', files: [], templateFile: null });
    store.cancel(ID);
    complete?.();
    expect(store.get(ID)?.draft.text).toBe('Следующий запрос');
  });
  it('reconciles a lost POST acknowledgement without repeating a completed turn', async () => {
    let requestId = '';
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/turns')) {
        requestId = (JSON.parse(String(init?.body)) as ChatTurnRequest).requestId ?? '';
        throw new TypeError('Connection lost');
      }
      return document([{ ...user, id: requestId }, answer]);
    });
    const onTurnEnd = vi.fn();
    const store = setup({ request, onTurnEnd });
    store.send(ID, { text: 'Привет', files: [] });
    await vi.waitFor(() => expect(onTurnEnd).toHaveBeenCalledOnce());
    expect(request.mock.calls.filter(([path]) => path.endsWith('/turns'))).toHaveLength(1);
    expect(store.get(ID)).toMatchObject({ running: false, pending: null, recovery: null });
  });

  it('reuses the frozen request id and model on transient POST retries', async () => {
    const bodies: ChatTurnRequest[] = [];
    const wait = vi.fn(async () => undefined);
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (!path.endsWith('/turns')) return new Response(null, { status: 404 });
      const body = JSON.parse(String(init?.body)) as ChatTurnRequest;
      bodies.push(body);
      if (bodies.length === 1)
        return new Response(null, { status: 503, headers: { 'retry-after': '1' } });
      return response(body.requestId);
    });
    const store = setup({ request, wait });
    store.send(ID, { text: 'Привет', files: [] });
    store.setMode(ID, 'auto');
    store.send(ID, { text: 'Двойной клик', files: [] });
    await vi.waitFor(() => expect(store.get(ID)?.messages).toHaveLength(2));
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]?.mode).toBe('chat');
    expect(wait).toHaveBeenCalledWith(1000);
  });

  it('keeps files and skips completed uploads on a manual retry', async () => {
    const first = new File(['a'], 'one.md');
    const second = new File(['b'], 'two.md');
    let failed = false;
    const uploadContent = vi.fn(async (file: File) => {
      if (file === second && !failed) {
        failed = true;
        throw new Error('Upload unavailable');
      }
      return { fileId: USER, name: file.name, size: file.size };
    });
    const store = setup({ uploadContent });
    store.send(ID, { text: 'Материалы', files: [first, second] });
    await vi.waitFor(() => expect(store.get(ID)?.recovery).toBe('retry'));
    expect(store.get(ID)?.pending).toMatchObject({ restorable: true, text: 'Материалы' });
    store.retry(ID);
    await vi.waitFor(() => expect(store.get(ID)?.messages).toHaveLength(2));
    expect(uploadContent.mock.calls.map(([file]) => file.name)).toEqual([
      'one.md',
      'two.md',
      'two.md',
    ]);
  });

  it('restores the complete draft when an upload fails', async () => {
    const file = new File(['data'], 'notes.md');
    const store = setup({
      uploadContent: async () => {
        throw new Error('Upload failed');
      },
    });
    store.send(ID, {
      text: 'Материал',
      files: [file],
      template: { templateId: USER, name: 'Template' },
    });
    await vi.waitFor(() => expect(store.get(ID)?.recovery).toBe('retry'));
    store.restore(ID);
    expect(store.get(ID)).toMatchObject({
      pending: null,
      error: null,
      draft: { text: 'Материал', files: [file], template: { templateId: USER, name: 'Template' } },
    });
  });

  it('never automatically retries validation failures', async () => {
    const request = vi.fn(async () => new Response(null, { status: 400 }));
    const store = setup({ request });
    store.send(ID, { text: 'Сообщение', files: [] });
    await vi.waitFor(() => expect(store.get(ID)?.recovery).toBe('retry'));
    expect(request).toHaveBeenCalledOnce();
    store.restore(ID);
    expect(store.get(ID)?.pending).toBe(null);
    expect(store.get(ID)?.draft.text).toBe('Сообщение');
  });

  it('keeps an unaccepted message when a different turn is running', async () => {
    const request = vi.fn(async (path: string) =>
      path.endsWith('/turns') ? new Response(null, { status: 409 }) : document([user], true),
    );
    const store = setup({ request });
    store.send(ID, { text: 'Ещё сообщение', files: [] });
    await vi.waitFor(() => expect(store.get(ID)?.recovery).toBe('retry'));
    expect(store.get(ID)?.pending?.text).toBe('Ещё сообщение');
    expect(request.mock.calls.some(([path]) => path.endsWith('/stream'))).toBe(false);
  });

  it('offers reconnection after repeated stream failures and never resends POST', async () => {
    let online = false;
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/turns'))
        return new Response(
          `data: ${JSON.stringify({ type: 'message', seq: 0, message: user })}\n\n`,
        );
      if (!online) throw new TypeError('Offline');
      return document([user, answer]);
    });
    const store = setup({ request });
    store.send(ID, { text: 'Привет', files: [] });
    await vi.waitFor(() => expect(store.get(ID)?.recovery).toBe('reconnect'));
    expect(store.get(ID)?.running).toBe(true);
    online = true;
    store.retry(ID);
    await vi.waitFor(() => expect(store.get(ID)?.messages).toEqual([user, answer]));
    expect(store.get(ID)?.recovery).toBe(null);
    expect(request.mock.calls.filter(([path]) => path.endsWith('/turns'))).toHaveLength(1);
  });

  it('cancels an upload locally and prevents a late upload from sending a turn', async () => {
    let complete: (() => void) | undefined;
    const request = vi.fn(async () => response());
    const store = setup({
      request,
      uploadContent: async (file) => {
        await new Promise<void>((resolve) => {
          complete = resolve;
        });
        return { fileId: USER, name: file.name, size: file.size };
      },
    });
    const file = new File(['a'], 'one.md');
    store.send(ID, { text: 'Не отправлять', files: [file] });
    store.cancel(ID);
    complete?.();
    await vi.waitFor(() => expect(store.get(ID)?.running).toBe(false));
    expect(store.get(ID)?.draft).toMatchObject({ text: 'Не отправлять', files: [file] });
    expect(request).not.toHaveBeenCalled();
  });

  it('exposes cancellation failure and allows retry while the answer is still streaming', async () => {
    let close: (() => void) | undefined;
    let cancellations = 0;
    const request = vi.fn(async (path: string) => {
      if (path.endsWith('/cancel')) {
        cancellations++;
        if (cancellations === 1) return new Response(null, { status: 503 });
        close?.();
        return new Response(null, { status: 204 });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            close = () => {
              controller.enqueue(new TextEncoder().encode('data: {"type":"turn-end","seq":1}\n\n'));
              controller.close();
            };
          },
        }),
      );
    });
    const store = setup({ request });
    store.send(ID, { text: 'Привет', files: [] });
    await vi.waitFor(() => expect(store.get(ID)?.activity).toBe('answering'));
    store.cancel(ID);
    await vi.waitFor(() => expect(store.get(ID)?.recovery).toBe('cancel'));
    store.retry(ID);
    await vi.waitFor(() => expect(store.get(ID)?.running).toBe(false));
    expect(cancellations).toBe(2);
  });
});

describe('retry policy', () => {
  it('retries transient transport failures, preserving authorization and validation errors', () => {
    expect(canRetryChat(new TypeError('Network'))).toBe(true);
    for (const status of [408, 429, 500, 502, 503, 504])
      expect(canRetryChat(new ChatHttpError('', status))).toBe(true);
    for (const status of [400, 401, 403, 404, 409, 422])
      expect(canRetryChat(new ChatHttpError('', status))).toBe(false);
    expect(chatRetryDelay(0, new ChatHttpError('', 429, '60'))).toBe(60000);
  });

  it('allows a fresh failed answer only if the turn had no mutating tools', () => {
    const failed = { ...answer, status: 'failed' as const };
    expect(canRetryAnswer([user, failed])).toBe(true);
    for (const name of ['build_deck', 'edit_slide', 'unknown_tool']) {
      expect(
        canRetryAnswer([
          user,
          {
            ...failed,
            parts: [{ type: 'tool', callId: 'call', name, input: {}, status: 'failed' }],
          },
        ]),
      ).toBe(false);
    }
    expect(canRetryAnswer([user, answer])).toBe(false);
  });
});

describe('model recovery selection', () => {
  it('loads a saved chat choice, restores uploaded attachments for editing and sends with the replacement', async () => {
    const attachment = { kind: 'file' as const, fileId: USER, name: 'notes.md', size: 10 };
    const original = { ...user, attachments: [attachment] };
    const failed = {
      ...answer,
      status: 'failed' as const,
      parts: [{ type: 'error' as const, message: 'Unavailable' }],
    };
    const selected = { connectionId: 'fixture', modelId: 'alpha' };
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path.endsWith('/turns')) return new Response('data: {"type":"turn-end","seq":1}\n\n');
      if (init?.method === 'PATCH') return new Response(null, { status: 204 });
      const body = (await document([original, failed]).json()) as Record<string, unknown>;
      return Response.json({ ...body, model: selected });
    });
    const store = createChatStore({
      request,
      uploadContent: vi.fn(),
      uploadTemplate: vi.fn(),
      wait: async () => undefined,
    });
    await store.load(ID);
    expect(store.get(ID)?.model).toEqual(selected);
    store.editFailed(ID, ANSWER);
    expect(store.get(ID)?.draft).toMatchObject({ text: original.text, attachments: [attachment] });
    store.setDraft(ID, { text: '', files: [], templateFile: null });
    store.retryAnswer(ID, ANSWER, { connectionId: 'fixture', modelId: 'beta' });
    await vi.waitFor(() =>
      expect(request.mock.calls.some(([path]) => path.endsWith('/turns'))).toBe(true),
    );
    const sent = request.mock.calls.find(([path]) => path.endsWith('/turns'));
    const body = JSON.parse(String(sent?.[1]?.body)) as ChatTurnRequest;
    expect(body.model?.modelId).toBe('beta');
    expect(body.requestId).not.toBe(USER);
    expect(body.input).toEqual({ type: 'message', text: original.text, attachments: [attachment] });
  });
  it('serializes rapid model picks and reports a failed preference save without blocking chat', async () => {
    let release: (() => void) | undefined;
    let writes = 0;
    const request = vi.fn(async (_path: string, init?: RequestInit) => {
      if (init?.method !== 'PATCH') return document([user, answer]);
      if (++writes === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return new Response(null, { status: writes === 2 ? 503 : 204 });
    });
    const store = createChatStore({ request, uploadContent: vi.fn(), uploadTemplate: vi.fn() });
    await store.load(ID);
    store.setModel(ID, { connectionId: 'fixture', modelId: 'alpha' });
    store.setModel(ID, { connectionId: 'fixture', modelId: 'beta' });
    await vi.waitFor(() => expect(writes).toBe(1));
    release?.();
    await vi.waitFor(() => expect(store.get(ID)?.selectionError).toBe(true));
    expect(store.get(ID)?.model?.modelId).toBe('beta');
    expect(store.get(ID)?.recovery).toBeNull();
  });
});
