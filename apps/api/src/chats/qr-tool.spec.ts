import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatMode, ChatPart, QrCodePart } from '@lct/contracts';
import { chatPartSchema } from '@lct/contracts';
import {
  ChatToolDispatcher,
  AnswerWriter,
  chatInstructions,
  loadChatAgent,
  modelHistory,
  runChatTurn,
  toolSpecs,
  type ToolContext,
  type ChatModel,
  type ModelStepRequest,
} from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';
import { generationBrief } from './chat-brief.js';
import { ChatsService } from './chats.service.js';
import { qrTool } from './qr-tool.js';

const USER = '00000000-0000-4000-8000-000000000001';
const ASSISTANT = '00000000-0000-4000-8000-000000000002';
const FILE = '00000000-0000-4000-8000-000000000003';
const FOREIGN = '00000000-0000-4000-8000-000000000004';
const URL = 'https://ex.test/a?sig=(x)&k=2;';

function user(text = '', files: string[] = []): ChatMessage {
  return {
    role: 'user',
    id: USER,
    text,
    attachments: files.map((fileId) => ({
      kind: 'file',
      fileId,
      name: 'brief.txt',
      size: 200,
    })),
    mode: 'chat',
    createdAt: 1,
  };
}
function assistant(parts: ChatPart[] = []): Extract<ChatMessage, { role: 'assistant' }> {
  return { role: 'assistant', id: ASSISTANT, parts, status: 'streaming', createdAt: 2 };
}
function result(
  name: string,
  input: unknown,
  output: unknown,
  status: 'done' | 'failed' | 'running' = 'done',
): ChatPart {
  return { type: 'tool', callId: 'read-call', name, input, output, status };
}
function read(text = URL) {
  return {
    name: 'brief.txt',
    text,
    offset: 0,
    nextOffset: null,
    hasMore: false,
    totalChars: text.length,
  };
}
function extracted(text = URL) {
  return {
    fileId: FILE,
    name: 'brief.pdf',
    sourceSha256: 'a'.repeat(64),
    text,
    offset: 0,
    nextOffset: null,
    truncated: false,
    totalChars: text.length,
    coordinateSystem: 'prepared-text-utf16',
  };
}
function fetched(url = URL, requestedUrl = url) {
  return {
    requestedUrl,
    url,
    title: 'Source',
    text: 'body',
    fetchedAt: '2026-10-18T12:00:00Z',
    contentHash: 'b'.repeat(64),
    offset: 0,
    nextOffset: null,
    truncated: false,
    trust: 'unverified',
  };
}
function fixture(messages: ChatMessage[], mode: ChatMode = 'chat') {
  const controller = new AbortController();
  const shown: ChatPart[] = [];
  const scope: ChatToolScope = {
    account: { id: 'owner' } as Account,
    chatId: 'chat',
    projectId: null,
    mode,
    model: null,
    messages: () => messages,
    updatePart: vi.fn(),
    addDecks: vi.fn(),
  };
  const context: ToolContext = {
    callId: 'qr-call',
    signal: controller.signal,
    show: vi.fn((part) => {
      shown.push(part);
      return shown.length - 1;
    }),
    update: vi.fn(),
  };
  const tool = qrTool(scope);
  return {
    scope,
    context,
    controller,
    shown,
    tool,
    run: (url = URL) => tool.run({ url }, context),
  };
}

describe('generate_qr through the real API tool registry', () => {
  it('shows the QR in the real agent loop and sends only metadata to the scripted model', async () => {
    const test = fixture([user(URL)]);
    const tools = chatTools({} as GenerationService, test.scope, undefined, {
      search: null,
      fetchSource: vi.fn(),
    });
    const agent = await loadChatAgent('../../registry/agents');
    const requests: ModelStepRequest[] = [];
    const model: ChatModel = {
      model: 'scripted',
      async step(request) {
        requests.push({ ...request, messages: [...request.messages] });
        return {
          text: requests.length === 1 ? '' : 'QR готов.',
          truncated: false,
          inputTokens: 1,
          outputTokens: 1,
          toolCalls:
            requests.length === 1
              ? [{ id: 'qr-call', name: 'generate_qr', arguments: JSON.stringify({ url: URL }) }]
              : [],
        };
      },
    };
    const writer = new AnswerWriter(ASSISTANT, () => undefined);
    const outcome = await runChatTurn({
      model,
      instructions: chatInstructions(agent, 'chat', {}),
      history: modelHistory(test.scope.messages()),
      tools,
      specs: toolSpecs(agent, tools),
      mode: 'chat',
      writer,
      signal: test.context.signal,
    });
    expect(outcome.end).toBe('answer');
    expect(writer.parts.filter((part) => part.type === 'qr-code')).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.some((message) => message.role === 'tool')).toBe(true);
    expect(JSON.stringify(requests)).not.toMatch(/base64|pngDataUrl|iVBOR/);
  });

  it.each(['chat', 'plan', 'auto'] as const)(
    'dispatches in %s with a registry description and no network',
    async (mode) => {
      const fetchSource = vi.fn(() => {
        throw new Error('Unexpected network');
      });
      const test = fixture([user(`[ссылка](${URL})`)], mode);
      const tools = chatTools({} as GenerationService, test.scope, undefined, {
        search: null,
        fetchSource,
      });
      const agent = await loadChatAgent('../../registry/agents');
      const specs = toolSpecs(agent, tools);
      expect(specs.some((spec) => spec.name === 'generate_qr')).toBe(true);
      const dispatcher = new ChatToolDispatcher({ tools, specs, mode });
      const outcome = await dispatcher.dispatch(
        'generate_qr',
        JSON.stringify({ url: URL }),
        test.context,
      );
      expect(outcome.failed).not.toBe(true);
      const part = test.shown[0] as QrCodePart;
      expect(chatPartSchema.safeParse(part).success).toBe(true);
      expect(part).toMatchObject({
        url: URL,
        source: { kind: 'user', messageId: USER },
        reachability: { status: 'not-checked' },
      });
      expect(part.sha256).toBe(
        createHash('sha256')
          .update(Buffer.from(part.pngDataUrl.slice('data:image/png;base64,'.length), 'base64'))
          .digest('hex'),
      );
      expect(JSON.stringify(outcome.output)).not.toMatch(/base64|pngDataUrl|iVBOR/);
      expect(fetchSource).not.toHaveBeenCalled();
    },
  );

  it('keeps binary data out of model history, generation brief and chat facts', async () => {
    const messages = [user(URL)];
    const test = fixture(messages);
    const outcome = await test.run();
    messages.push(assistant([result('generate_qr', { url: URL }, outcome.output), ...test.shown]));
    const facts = (ChatsService.prototype as unknown as { facts(state: unknown): unknown }).facts({
      messages,
      mode: 'chat',
      projectId: null,
      deckIds: [],
      primaryDeckId: null,
    });
    for (const value of [
      modelHistory(messages),
      facts,
      generationBrief(messages, null, 'model', []),
    ]) {
      expect(JSON.stringify(value)).not.toMatch(/base64|pngDataUrl|iVBOR/);
    }
    expect(JSON.stringify(modelHistory(messages))).toContain('generate_qr');
  });
});

describe('QR provenance', () => {
  it.each(['read_file', 'extract_material'])(
    'accepts only text from an attached %s result',
    async (name) => {
      const output =
        name === 'read_file' ? read(`Материал: <${URL}>`) : extracted(`Материал: <${URL}>`);
      const test = fixture([user('', [FILE]), assistant([result(name, { fileId: FILE }, output)])]);
      await test.run();
      expect(test.shown[0]).toMatchObject({
        source: { kind: 'material', fileId: FILE, callId: 'read-call', messageId: ASSISTANT },
      });
    },
  );

  it.each(['final', 'requested'])(
    'marks only an existing validated fetch %s URL as fetched',
    async (which) => {
      const requested = 'https://ex.test/redirect';
      const test = fixture([
        user(),
        assistant([result('fetch_source', { url: requested }, fetched(URL, requested))]),
      ]);
      await test.run(which === 'final' ? URL : requested);
      expect(test.shown[0]).toMatchObject({
        source: { kind: 'web-source' },
        reachability: { status: 'fetched', fetchedAt: '2026-10-18T12:00:00Z' },
      });
    },
  );

  it.each([
    [user(), assistant([{ type: 'text', text: URL }])],
    [user(), assistant([result('search_web', {}, { results: [{ url: URL, snippet: URL }] })])],
    [user(), assistant([result('fetch_source', { url: URL }, fetched(), 'failed')])],
    [user(), assistant([result('fetch_source', { url: URL }, fetched(), 'running')])],
    [user(), assistant([result('fetch_source', { url: URL }, { url: URL })])],
    [user(), assistant([result('fetch_source', { url: 'https://other.test' }, fetched())])],
    [user('', [FILE]), assistant([result('read_file', { fileId: FOREIGN }, read())])],
    [user('', [FILE]), assistant([result('read_file', {}, { ...read(), fileId: FILE })])],
    [
      user('', [FILE]),
      assistant([
        result('extract_material', { fileId: FILE }, { ...extracted(), fileId: FOREIGN }),
      ]),
    ],
    [
      user('', [FILE]),
      assistant([
        result('extract_material', { fileId: FILE }, { ...extracted(), text: 'body', name: URL }),
      ]),
    ],
    [user('', [FILE]), assistant([result('read_file', { fileId: FILE }, read(), 'failed')])],
    [assistant([result('read_file', { fileId: FILE }, read())]), user('', [FILE])],
    [user(), assistant([result('generate_qr', { url: URL }, { url: URL })])],
  ])('rejects unattested source %#', async (...messages) => {
    const test = fixture(messages as ChatMessage[]);
    await expect(test.run()).rejects.toThrow(/exactly match/);
    expect(test.shown).toEqual([]);
  });

  it.each([
    ['https://ex.test', 'https://ex.test.evil/a'],
    ['https://ex.test/a', 'https://ex.test/a?sig=secret'],
    ['https://ex.test/a?sig=', 'https://ex.test/a?sig=(x)&k=2'],
    ['https://ex.test/a', 'https://evil.test/?next=https://ex.test/a'],
    ['https://ex.test/a', 'https://evil.test/?next=(https://ex.test/a)'],
    ['https://ex.test/a', 'https://ex.test/a;'],
    ['https://ex.test/a', 'xhttps://ex.test/a'],
    ['https://ex.test/?sig=', 'https://ex.test/?sig="abc"'],
    ['https://ex.test/?sig=', 'https://ex.test/?sig=`abc`'],
  ])('rejects a prefix/query spoof %s from %s', async (requested, text) => {
    await expect(fixture([user(text)]).run(requested)).rejects.toThrow(/exactly match/);
  });

  it.each(['read_file', 'extract_material'])(
    'rejects %s tokens touching either incomplete page edge',
    async (name) => {
      for (const edge of ['start', 'end']) {
        const text = edge === 'end' ? `Материал ${URL}` : `${URL} конец`;
        const base = name === 'read_file' ? read(text) : extracted(text);
        const output = {
          ...base,
          offset: edge === 'start' ? 100 : 0,
          totalChars: edge === 'end' ? 1000 : 100 + text.length,
          nextOffset: edge === 'end' ? text.length : null,
          ...(name === 'read_file' ? { hasMore: edge === 'end' } : { truncated: edge === 'end' }),
        };
        const test = fixture([
          user('', [FILE]),
          assistant([result(name, { fileId: FILE }, output)]),
        ]);
        await expect(test.run()).rejects.toThrow(/exactly match/);
      }
    },
  );

  it.each(['read_file', 'extract_material'])(
    'accepts complete %s tokens inside a partial page',
    async (name) => {
      const text = ` ${URL} `;
      const output = {
        ...(name === 'read_file' ? read(text) : extracted(text)),
        offset: 100,
        totalChars: 1000,
        nextOffset: 100 + text.length,
        ...(name === 'read_file' ? { hasMore: true } : { truncated: true }),
      };
      await fixture([user('', [FILE]), assistant([result(name, { fileId: FILE }, output)])]).run();
    },
  );

  it.each(['read_file', 'extract_material'])(
    'rejects a wrapped token at the incomplete %s page start',
    async (name) => {
      const text = `(${URL}) `;
      const output = {
        ...(name === 'read_file' ? read(text) : extracted(text)),
        offset: 100,
        totalChars: 100 + text.length,
      };
      await expect(
        fixture([user('', [FILE]), assistant([result(name, { fileId: FILE }, output)])]).run(),
      ).rejects.toThrow(/exactly match/);
    },
  );

  it('encodes a private URL explicitly given by the user without a fetched claim', async () => {
    const url = 'http://127.0.0.1:8080/internal';
    const test = fixture([user(url)]);
    await test.run(url);
    expect(test.shown[0]).toMatchObject({ reachability: { status: 'not-checked' } });
  });
});

describe('QR turn lifecycle', () => {
  it('deduplicates concurrent calls and bounds the turn to eight unique URLs', async () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://ex.test/${i}`);
    const test = fixture([user(urls.join(' '))]);
    const duplicate = await Promise.all([test.run(urls[0]), test.run(urls[0])]);
    expect(duplicate[0].output).toEqual(duplicate[1].output);
    expect(test.shown).toHaveLength(1);
    for (const url of urls.slice(1, 8)) await test.run(url);
    await expect(test.run(urls[8])).rejects.toThrow(/eight/);
    expect(test.shown).toHaveLength(8);
    await test.run(urls[0]);
    expect(test.shown).toHaveLength(8);
  });

  it('does not show an image after cancellation during encoding', async () => {
    const test = fixture([user(URL)]);
    const pending = test.run();
    test.controller.abort();
    await expect(pending).rejects.toThrow();
    expect(test.shown).toEqual([]);
  });

  it('does not show after source context or current turn disappears', async () => {
    for (const removeSource of [true, false]) {
      const live = assistant();
      const messages = [user(URL), live];
      const test = fixture(messages);
      const tool = qrTool({ ...test.scope, currentMessageId: ASSISTANT });
      const pending = tool.run({ url: URL }, test.context);
      if (removeSource) messages.splice(0, 1);
      else live.status = 'cancelled';
      await expect(pending).rejects.toThrow();
      expect(test.shown).toEqual([]);
    }
  });
});
