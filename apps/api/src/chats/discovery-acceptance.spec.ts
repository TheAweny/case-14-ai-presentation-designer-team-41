import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatPart, DeckOutline } from '@lct/contracts';
import {
  AnswerWriter,
  loadChatAgent,
  modelHistory,
  runChatTurn,
  toolSpecs,
  type ChatModel,
  type ToolContext,
} from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';
import { readPreparation } from './preparation.js';
import { preparationRevisionForBuild, questionsAllowed } from './discovery-policy.js';

const templateId = '00000000-0000-4000-8000-000000000001';
const outline: DeckOutline = {
  title: 'Сервис заявок',
  audience: '',
  goal: '',
  slides: Array.from({ length: 5 }, (_, i) => ({
    title: `Тезис ${i + 1}`,
    points: ['История решений сохраняется'],
    kind: 'statement',
  })),
};
function user(text: string): Extract<ChatMessage, { role: 'user' }> {
  return {
    role: 'user',
    id: crypto.randomUUID(),
    text,
    attachments: [],
    mode: 'auto',
    createdAt: Date.now(),
  };
}
function fixture(messages: ChatMessage[] = []) {
  let currentId = '';
  let parts: ChatPart[] = [];
  const start = vi.fn(async (_input: { brief: string; outline: DeckOutline | null }) => {
    throw new Error('Captured generation boundary');
  });
  const generation = {
    template: vi.fn(async () => ({ file_name: 'Synthetic', profile: null })),
    prepare: vi.fn(async () => undefined),
    start,
    pool: { query: vi.fn(async (): Promise<{ rows: unknown[] }> => ({ rows: [] })) },
  };
  const scope: ChatToolScope = {
    account: { id: 'owner' } as Account,
    chatId: 'one-chat',
    projectId: null,
    mode: 'auto',
    model: null,
    get currentMessageId() {
      return currentId;
    },
    messages: () => messages,
    updatePart(messageId, index, part) {
      const message = messages.find((message) => message.id === messageId);
      if (message?.role === 'assistant') message.parts[index] = part;
    },
    addDecks: () => undefined,
  };
  const begin = () => {
    currentId = crypto.randomUUID();
    parts = [];
    messages.push({
      role: 'assistant',
      id: currentId,
      createdAt: Date.now(),
      status: 'done',
      parts,
    });
  };
  const context = (): ToolContext => ({
    signal: new AbortController().signal,
    callId: crypto.randomUUID(),
    show: (part) => parts.push(part) - 1,
    update: (i, part) => {
      parts[i] = part;
    },
  });
  const tools = () =>
    chatTools(generation as unknown as GenerationService, scope, undefined, {
      search: null,
      fetchSource: async () => {
        throw new Error('No network');
      },
    });
  const invoke = async (name: string, input: unknown) => {
    const tool = tools().find((tool) => tool.name === name);
    if (!tool) throw new Error(name);
    const ctx = context();
    const parsed = tool.input.parse(input);
    const part: ChatPart = {
      type: 'tool',
      name,
      input: parsed,
      callId: ctx.callId,
      status: 'running',
    };
    parts.push(part);
    const outcome = await tool.run(parsed, ctx);
    const live = parts.find((part) => part.type === 'tool' && part.callId === ctx.callId);
    Object.assign(live ?? part, { status: 'done', output: outcome.output });
    return outcome;
  };
  begin();
  return { messages, scope, generation, start, invoke, begin, tools };
}

describe('discovery preparation through real server tools', () => {
  it('keeps the immutable revision of the retry attempt when attempts share a buildId', () => {
    const buildId = crypto.randomUUID();
    const build: Extract<ChatPart, { type: 'build' }> = {
      type: 'build',
      callId: 'original',
      buildId,
      planId: null,
      planRevision: null,
      templateId,
      templateName: 'Synthetic',
      runId: 'run',
      variantRunIds: ['run'],
      startedAt: 1,
      finishedAt: 2,
      status: 'failed',
      error: 'Interrupted',
    };
    const attempt = (callId: string, revision: string): ChatMessage => ({
      role: 'assistant',
      id: crypto.randomUUID(),
      createdAt: 1,
      status: 'done',
      parts: [
        {
          type: 'tool',
          name: 'build_deck',
          callId,
          status: 'done',
          input: { preparationRevision: revision },
          output: {},
        },
        { ...build, callId },
      ],
    });
    const messages = [attempt('original', 'a'.repeat(64)), attempt('retry', 'b'.repeat(64))];
    expect(preparationRevisionForBuild(messages, { ...build, callId: 'retry' })).toBe(
      'b'.repeat(64),
    );
    expect(preparationRevisionForBuild(messages, build)).toBe('a'.repeat(64));
  });
  it('uses a fact already read in an attachment and rechecks its account access before reuse', async () => {
    const fileId = '00000000-0000-4000-8000-000000000002';
    const message = user('Возьми цифры из материала');
    message.attachments.push({ kind: 'file', fileId, name: 'pilot.txt', size: 20 });
    const f = fixture([message]);
    const quote = 'Пилот: 25 заявок';
    const sourceMessage: ChatMessage = {
      role: 'assistant',
      id: 'read',
      createdAt: 1,
      status: 'done',
      parts: [
        {
          type: 'tool',
          name: 'read_file',
          callId: 'source-call',
          status: 'done',
          input: { fileId },
          output: {
            name: 'pilot.txt',
            text: quote,
            offset: 0,
            nextOffset: null,
            hasMore: false,
            totalChars: quote.length,
          },
        },
      ],
    };
    f.messages.push(sourceMessage);
    f.begin();
    f.generation.pool.query.mockResolvedValue({ rows: [{ id: fileId }] });
    await f.invoke('save_preparation', {
      entries: [
        {
          key: 'requirements.pilot',
          value: quote,
          status: 'source',
          evidence: { messageId: sourceMessage.id, callId: 'source-call', sourceId: fileId, quote },
        },
      ],
    });
    expect(
      (
        await f.invoke('ask_user', {
          question: 'Сколько заявок?',
          preparationKey: 'requirements.pilot',
        })
      ).output,
    ).toMatchObject({ status: 'already-resolved' });
    // Revoked/foreign ownership cannot be bypassed by replaying a previously saved preparation.
    f.generation.pool.query.mockResolvedValue({ rows: [] });
    await expect(f.invoke('build_deck', { templateId })).rejects.toThrow(
      'available to this account',
    );
    expect(f.start).not.toHaveBeenCalled();
    expect(f.generation.pool.query).toHaveBeenLastCalledWith(expect.stringContaining('owner_id'), [
      fileId,
      'owner',
    ]);
  });
  it.each([
    ['Для покупателя: выбрать продукт', 'покупателя', 'выбрать продукт'],
    ['Для директора: согласовать пилот', 'директора', 'согласовать пилот'],
  ])('passes audience and purpose from %s without asking again', async (text, audience, goal) => {
    const message = user(text);
    const f = fixture([message]);
    await f.invoke('save_preparation', {
      entries: [
        {
          key: 'audience',
          value: audience,
          status: 'user',
          evidence: { messageId: message.id, quote: text },
        },
        {
          key: 'goal',
          value: goal,
          status: 'user',
          evidence: { messageId: message.id, quote: text },
        },
        {
          key: 'desiredAction',
          value: goal,
          status: 'user',
          evidence: { messageId: message.id, quote: text },
        },
      ],
    });
    const skipped = await f.invoke('ask_user', {
      question: 'Кто будет смотреть?',
      preparationKey: 'audience',
    });
    expect(skipped.output).toMatchObject({ status: 'already-resolved' });
    const proposed = await f.invoke('propose_plan', { outline });
    const { planId } = proposed.output as { planId: string };
    await f.invoke('build_deck', { templateId, planId });
    expect(f.start).toHaveBeenCalledOnce();
    const input = f.start.mock.calls[0]?.[0];
    if (!input) throw new Error('Generation did not start');
    expect(input.outline).toMatchObject({ audience, goal });
    expect(JSON.parse(input.brief).preparation.entries).toContainEqual(
      expect.objectContaining({ key: 'desiredAction', value: goal }),
    );
    expect(JSON.parse(input.brief).userRequirements[0].text).toBe(text);
  });

  it('suspends a fake-provider turn before generation and restores the bound answer after reload', async () => {
    const f = fixture([user('Сделай презентацию сервиса')]);
    const agent = await loadChatAgent(join(import.meta.dirname, '../../../../registry/agents'));
    const toolset = f.tools();
    const model: ChatModel = {
      model: 'recording',
      step: vi.fn(async () => ({
        text: '',
        toolCalls: [
          {
            id: 'ask',
            name: 'ask_user',
            arguments: JSON.stringify({
              question: 'Какое решение должна помочь принять презентация?',
              preparationKey: 'goal',
              options: [
                { label: 'Согласовать пилот', description: 'Сфокусируемся на критериях проверки' },
                { label: 'Объяснить продукт', description: 'Покажем принцип работы' },
              ],
            }),
          },
        ],
        truncated: false,
        inputTokens: 1,
        outputTokens: 1,
      })),
    };
    const writer = new AnswerWriter(crypto.randomUUID(), () => undefined);
    f.messages.push({
      role: 'assistant',
      id: writer.messageId,
      status: 'done',
      createdAt: Date.now(),
      parts: writer.parts,
    });
    const result = await runChatTurn({
      model,
      mode: 'auto',
      instructions: 'Recorded discovery acceptance',
      history: modelHistory(f.messages.slice(0, -1)),
      tools: toolset,
      specs: toolSpecs(agent, toolset),
      writer,
      signal: new AbortController().signal,
    });
    expect(result.end).toBe('waiting');
    expect(f.start).not.toHaveBeenCalled();
    const question = writer.parts.find((part) => part.type === 'question');
    if (question?.type !== 'question') throw new Error('Missing question');
    question.answer = { optionLabels: ['Согласовать пилот'], text: '' };
    const reloaded = fixture(JSON.parse(JSON.stringify(f.messages)) as ChatMessage[]);
    expect(readPreparation(reloaded.messages).entries).toContainEqual(
      expect.objectContaining({ key: 'goal', value: 'Согласовать пилот', status: 'user' }),
    );
    expect(
      (await reloaded.invoke('ask_user', { question: 'Ещё раз?', preparationKey: 'goal' })).output,
    ).toMatchObject({ status: 'already-resolved' });
    expect(reloaded.start).not.toHaveBeenCalled();
  });

  it.each(['Не знаю', 'Пропустить'])(
    'keeps %s non-factual and does not ask the same question again',
    async (answer) => {
      const f = fixture([user('Подготовь презентацию')]);
      await f.invoke('ask_user', {
        question: 'Какой эффект пилота подтверждён?',
        preparationKey: 'pilotResult',
      });
      const q = f.messages
        .flatMap((message) => (message.role === 'assistant' ? message.parts : []))
        .find((part) => part.type === 'question');
      if (q?.type !== 'question') throw new Error('Missing question');
      q.answer = { optionLabels: [], text: answer };
      f.messages.push(user(answer));
      f.begin();
      const entry = readPreparation(f.messages).entries.find(
        (entry) => entry.key === 'pilotResult',
      );
      expect(entry).toMatchObject({
        value: null,
        status: answer === 'Не знаю' ? 'unknown' : 'declined',
      });
      expect(
        (
          await f.invoke('ask_user', {
            question: 'Укажите процент?',
            preparationKey: 'pilotResult',
          })
        ).output,
      ).toMatchObject({ status: 'already-resolved' });
    },
  );

  it('honours no-questions without replacing unknown contacts with an invented address', async () => {
    const f = fixture([user('Делай без вопросов')]);
    await f.invoke('save_preparation', {
      entries: [{ key: 'contact', value: null, status: 'unknown' }],
    });
    expect(questionsAllowed(f.messages)).toBe(false);
    expect(
      (await f.invoke('ask_user', { question: 'Куда написать?', preparationKey: 'contact' }))
        .output,
    ).toMatchObject({ status: 'skipped' });
    await f.invoke('build_deck', { templateId });
    const input = f.start.mock.calls[0]?.[0];
    if (!input) throw new Error('Generation did not start');
    expect(JSON.parse(input.brief).preparation.entries).toContainEqual(
      expect.objectContaining({ key: 'contact', value: null, status: 'unknown' }),
    );
  });

  it('invalidates an old purpose without losing confirmed product facts', async () => {
    const message = user('История решений сохраняется. Цель — объяснить продукт.');
    const f = fixture([message]);
    await f.invoke('save_preparation', {
      entries: [
        {
          key: 'fact.history',
          value: 'История решений сохраняется',
          status: 'user',
          evidence: { messageId: message.id, quote: 'История решений сохраняется' },
        },
        {
          key: 'goal',
          value: 'объяснить продукт',
          status: 'user',
          evidence: { messageId: message.id, quote: 'Цель — объяснить продукт' },
        },
      ],
    });
    await f.invoke('propose_plan', { outline });
    const firstRevision = readPreparation(f.messages).revision;
    const correction = user('Теперь цель — согласовать пилот');
    f.messages.push(correction);
    f.begin();
    await f.invoke('save_preparation', {
      entries: [
        {
          key: 'goal',
          value: 'согласовать пилот',
          status: 'user',
          evidence: { messageId: correction.id, quote: correction.text },
        },
      ],
    });
    const prepared = readPreparation(f.messages);
    expect(prepared.revision).not.toBe(firstRevision);
    expect(prepared.entries).toContainEqual(
      expect.objectContaining({ key: 'fact.history', value: 'История решений сохраняется' }),
    );
    expect(
      f.messages.flatMap((message) => (message.role === 'assistant' ? message.parts : [])),
    ).toContainEqual(expect.objectContaining({ type: 'plan', status: 'superseded' }));
    await f.invoke('propose_plan', { outline });
    expect(
      f.messages.flatMap((message) => (message.role === 'assistant' ? message.parts : [])),
    ).toContainEqual(
      expect.objectContaining({
        type: 'plan',
        status: 'proposed',
        outline: expect.objectContaining({ goal: 'согласовать пилот' }),
      }),
    );
  });

  it('never waits for a person while a generation is already active', async () => {
    const f = fixture([user('Собери')]);
    f.messages.push({
      role: 'assistant',
      id: 'running',
      status: 'done',
      createdAt: 1,
      parts: [
        {
          type: 'build',
          callId: 'b',
          buildId: crypto.randomUUID(),
          planId: null,
          planRevision: null,
          templateId,
          templateName: 'Synthetic',
          runId: 'run',
          variantRunIds: ['run'],
          startedAt: 1,
          finishedAt: null,
          status: 'running',
          error: null,
        },
      ],
    });
    expect(
      await f.invoke('ask_user', { question: 'Какой контакт?', preparationKey: 'contact' }),
    ).toMatchObject({ stop: true, output: { status: 'building' } });
    expect(
      f.messages
        .flatMap((message) => (message.role === 'assistant' ? message.parts : []))
        .some((part) => part.type === 'question'),
    ).toBe(false);
  });

  it('does not start generation while a preparation answer is still pending', async () => {
    const f = fixture([user('Подготовь презентацию')]);
    await f.invoke('ask_user', { question: 'Какое решение нужно?', preparationKey: 'goal' });
    f.begin();
    expect(await f.invoke('build_deck', { templateId })).toMatchObject({
      stop: true,
      output: { status: 'waiting' },
    });
    expect(f.start).not.toHaveBeenCalled();
  });

  it('persists a preparation revision before generation and never resumes old dependencies after a correction', async () => {
    const first = user('Цель — объяснить продукт');
    const f = fixture([first]);
    await f.invoke('save_preparation', {
      entries: [
        {
          key: 'goal',
          value: 'объяснить продукт',
          status: 'user',
          evidence: { messageId: first.id, quote: first.text },
        },
      ],
    });
    const firstRevision = readPreparation(f.messages).revision;
    await f.invoke('build_deck', { templateId });
    const firstBuildCall = f.messages
      .flatMap((message) => (message.role === 'assistant' ? message.parts : []))
      .find((part) => part.type === 'tool' && part.name === 'build_deck');
    expect(firstBuildCall).toMatchObject({
      input: expect.objectContaining({ preparationRevision: firstRevision }),
    });
    const correction = user('Теперь цель — согласовать пилот');
    f.messages.push(correction);
    f.begin();
    await f.invoke('save_preparation', {
      entries: [
        {
          key: 'goal',
          value: 'согласовать пилот',
          status: 'user',
          evidence: { messageId: correction.id, quote: correction.text },
        },
      ],
    });
    await f.invoke('build_deck', { templateId, retry: true });
    expect(f.start).toHaveBeenCalledTimes(2);
    expect(JSON.parse(f.start.mock.calls[1]?.[0].brief ?? '{}').preparation.revision).not.toBe(
      firstRevision,
    );
  });
});
