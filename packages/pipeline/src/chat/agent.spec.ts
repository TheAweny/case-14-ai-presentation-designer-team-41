import { join } from 'node:path';
import { mkdtemp, cp, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatMessage } from '@lct/contracts';
import type { ToolContext } from './agent.js';
import {
  AnswerWriter,
  chatInstructions,
  loadChatAgent,
  lenientJson,
  looping,
  mendedArguments,
  modelHistory,
  runChatTurn,
  toolSpecs,
  type ChatEventBody,
  type ChatTool,
} from './agent.js';
import type { ChatModel, ModelStep, ModelStepRequest } from './chat-model.js';

const REGISTRY = join(import.meta.dirname, '../../../../registry/agents');

/** A model that answers from a script and remembers what it was asked. */
function scripted(steps: Partial<ModelStep>[]): ChatModel & { requests: ModelStepRequest[] } {
  const requests: ModelStepRequest[] = [];
  return {
    model: 'scripted',
    requests,
    async step(request) {
      requests.push({ ...request, messages: [...request.messages] });
      const step = steps.shift();
      if (!step) throw new Error('The script ran out.');
      if (step.text) request.onText?.(step.text);
      // A streamed call is announced by name before its arguments are written.
      for (const call of step.toolCalls ?? []) request.onToolCall?.(call.name);
      return {
        text: '',
        toolCalls: [],
        truncated: false,
        inputTokens: 1,
        outputTokens: 1,
        ...step,
      };
    },
  };
}

function writer() {
  const events: ChatEventBody[] = [];
  return { writer: new AnswerWriter(crypto.randomUUID(), (event) => events.push(event)), events };
}

const echo: ChatTool = {
  name: 'echo',
  input: z.object({ word: z.string() }),
  modes: ['chat', 'plan', 'auto'],
  async run(input) {
    return { output: { heard: (input as { word: string }).word } };
  },
};

const ask: ChatTool = {
  name: 'ask_user',
  input: z.object({ question: z.string() }),
  modes: ['plan', 'auto'],
  async run(input, context) {
    context.show({
      type: 'question',
      callId: context.callId,
      questionId: crypto.randomUUID(),
      question: (input as { question: string }).question,
      options: [],
      multiSelect: false,
      answer: null,
    });
    return { output: { asked: true }, stop: true };
  },
};

describe('runChatTurn', () => {
  it('ends a terminal tool failure before the model can invent a running build or retry it', async () => {
    const model = scripted([
      { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"build"}' }] },
      { text: 'Сборка уже запущена.' },
    ]);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [
        {
          ...echo,
          async run(_input, context) {
            context.show({ type: 'error', message: 'Сборка остановлена: HTTP 429.' });
            return { output: { status: 'failed', active: false }, failed: true, stop: true };
          },
        },
      ],
      specs: [{ name: 'echo', description: 'Build.', parameters: {} }],
      mode: 'auto',
      writer: answer,
      signal: new AbortController().signal,
    });
    expect(result.end).toBe('failed');
    expect(model.requests).toHaveLength(1);
    expect(answer.parts).not.toContainEqual(
      expect.objectContaining({ type: 'text', text: 'Сборка уже запущена.' }),
    );
  });

  it('never dispatches a tool from a truncated model step', async () => {
    const run = vi.fn(echo.run);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model: scripted([
        { truncated: true, toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
      ]),
      instructions: 'system',
      history: [],
      tools: [{ ...echo, run }],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    expect(run).not.toHaveBeenCalled();
    expect(result.end).toBe('incomplete');
    expect(answer.parts.filter((part) => part.type === 'tool')).toEqual([
      expect.objectContaining({ status: 'failed' }),
    ]);
  });

  it('treats an empty answer as incomplete', async () => {
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model: scripted([{}]),
      instructions: 'system',
      history: [],
      tools: [],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    expect(result.end).toBe('incomplete');
  });

  it('checks cancellation immediately before dispatch, even if the model ignores abort', async () => {
    const control = new AbortController();
    const run = vi.fn(echo.run);
    const { writer: answer } = writer();
    const pending = runChatTurn({
      model: {
        model: 'ignores-abort',
        async step() {
          control.abort();
          return {
            text: '',
            toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }],
            truncated: false,
            inputTokens: 0,
            outputTokens: 0,
          };
        },
      },
      instructions: 'system',
      history: [],
      tools: [{ ...echo, run }],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: control.signal,
    });
    await expect(pending).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('runs the tools the model calls and gives it their results', async () => {
    const model = scripted([
      { text: 'Проверю.', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
      { text: 'Услышал «да».' },
    ]);
    const { writer: answer, events } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [{ role: 'user', content: 'Скажи да' }],
      tools: [echo],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    expect(result).toMatchObject({ steps: 2, end: 'answer' });
    expect(answer.parts.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
    expect(answer.parts[0]).toEqual({ type: 'text', text: 'Проверю.' });
    expect(answer.parts[2]).toEqual({ type: 'text', text: 'Услышал «да».' });
    expect(answer.parts[1]).toMatchObject({
      type: 'tool',
      callId: 'c1',
      name: 'echo',
      input: { word: 'да' },
      status: 'done',
      phase: 'executing',
      output: { heard: 'да' },
    });
    expect(model.requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      callId: 'c1',
      content: '{"heard":"да"}',
    });
    expect(events.filter((event) => event.type === 'text-delta')).toHaveLength(2);
  });

  it('reports tokens as they stream and settles on the usage the server reports', async () => {
    const answers: Partial<ModelStep>[] = [
      { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }], inputTokens: 40 },
      { text: 'Готово.', inputTokens: 0, outputTokens: 0 },
    ];
    const model: ChatModel = {
      model: 'streaming',
      async step(request) {
        const step = answers.shift();
        if (!step) throw new Error('The script ran out.');
        request.onGenerated?.(30);
        request.onGenerated?.(30);
        if (step.text) request.onText?.(step.text);
        return {
          text: '',
          toolCalls: [],
          truncated: false,
          inputTokens: 1,
          outputTokens: 1,
          ...step,
        };
      },
    };
    const usage: { inputTokens: number; outputTokens: number }[] = [];
    const { writer: answer } = writer();
    await runChatTurn({
      model,
      instructions: 'system',
      history: [{ role: 'user', content: 'Скажи да' }],
      tools: [echo],
      specs: [{ name: 'echo', description: 'Echo.', parameters: {} }],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      onUsage: (update) => usage.push(update),
    });
    const [estimate, firstChunk, secondChunk, firstStep] = usage;
    expect(estimate?.inputTokens).toBeGreaterThan(0);
    expect(firstChunk?.outputTokens).toBe(10);
    expect(secondChunk?.outputTokens).toBe(20);
    // The first step's own numbers replace its estimate.
    expect(firstStep).toEqual({ inputTokens: 40, outputTokens: 1 });
    // The second step reported nothing, so its estimate stays in the total.
    const last = usage.at(-1);
    expect(last?.outputTokens).toBe(21);
    expect(last?.inputTokens).toBeGreaterThan(40);
  });

  it('lets the model read a bad call as an error instead of ending the turn', async () => {
    const model = scripted([
      { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":1}' }] },
      { toolCalls: [{ id: 'c2', name: 'missing', arguments: '{}' }] },
      { text: 'Не вышло.' },
    ]);
    const { writer: answer } = writer();
    await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    const tools = answer.parts.filter((part) => part.type === 'tool');
    expect(tools.map((part) => part.status)).toEqual(['failed', 'failed']);
    expect(JSON.stringify(tools[0]?.output)).toContain('Invalid arguments');
  });

  it('ends the turn when a tool waits for the person, skipping the calls after it', async () => {
    const model = scripted([
      {
        toolCalls: [
          { id: 'c1', name: 'ask_user', arguments: '{"question":"Какой шаблон?"}' },
          { id: 'c2', name: 'echo', arguments: '{"word":"рано"}' },
        ],
      },
    ]);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo, ask],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    expect(result.end).toBe('waiting');
    // Both calls show as they begin; the question card follows them.
    expect(answer.parts.map((part) => part.type)).toEqual(['tool', 'tool', 'question']);
    expect(answer.parts[1]).toMatchObject({
      name: 'echo',
      output: { skipped: expect.any(String) },
    });
  });

  it('shows a call as soon as it begins and fills the same part in afterwards', async () => {
    const model = scripted([
      { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
      { text: 'Готово.' },
    ]);
    const { writer: answer, events } = writer();
    await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    const tools = answer.parts.filter((part) => part.type === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ callId: 'c1', status: 'done' });
    const first = events.find((event) => event.type === 'part');
    expect(first).toMatchObject({
      part: { type: 'tool', status: 'running', phase: 'preparing', input: null },
    });
  });

  it('keeps a child that finished before the parent and does not reopen it', async () => {
    let report: ToolContext['activity'];
    const model = scripted([
      { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
      { text: 'Готово.' },
    ]);
    const { writer: answer } = writer();
    await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [
        {
          ...echo,
          async run(_input, context) {
            report = context.activity;
            context.activity?.({
              id: 'child-1',
              kind: 'agent',
              name: 'research',
              detail: 'https://example.test/a',
              status: 'done',
              startedAt: 10,
              finishedAt: 20,
            });
            context.activity?.({
              id: 'child-1',
              kind: 'agent',
              name: 'research',
              status: 'running',
              startedAt: 10,
            });
            context.activity?.({
              id: '',
              kind: 'tool',
              name: 'x',
              status: 'running',
              startedAt: 1,
            });
            return { output: { heard: 'да' } };
          },
        },
      ],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    const tool = answer.parts.find((part) => part.type === 'tool');
    expect(tool).toMatchObject({
      status: 'done',
      phase: 'executing',
      activities: [{ id: 'child-1', status: 'done', finishedAt: 20 }],
    });
    if (tool?.type !== 'tool') throw new Error('missing tool');
    expect(tool.startedAt).toEqual(expect.any(Number));
    expect(tool.finishedAt).toBeGreaterThanOrEqual(tool.startedAt ?? 0);
    report?.({
      id: 'child-1',
      kind: 'agent',
      name: 'research',
      status: 'running',
      startedAt: 10,
    });
    expect(answer.parts.find((part) => part.type === 'tool')).toMatchObject({
      activities: [{ id: 'child-1', status: 'done' }],
    });
    const history = modelHistory([
      {
        role: 'assistant',
        id: crypto.randomUUID(),
        status: 'done',
        createdAt: 1,
        parts: answer.parts,
      },
    ]);
    expect(history.filter((message) => message.role === 'tool')).toHaveLength(1);
    expect(history.find((message) => message.role === 'tool')?.content).toBe('{"heard":"да"}');
  });

  it('keeps the latest 32 finished activities and seals a call whose arguments never arrived', async () => {
    const { writer: answer } = writer();
    await runChatTurn({
      model: scripted([
        { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
        { text: 'Готово.' },
      ]),
      instructions: 'system',
      history: [],
      tools: [
        {
          ...echo,
          async run(_input, context) {
            for (let job = 0; job < 40; job += 1) {
              context.activity?.({
                id: `job-${job}`,
                kind: 'tool',
                name: 'slide',
                status: 'running',
                startedAt: job,
              });
              context.activity?.({
                id: `job-${job}`,
                kind: 'tool',
                name: 'slide',
                status: 'done',
                startedAt: job,
                finishedAt: job + 1,
              });
            }
            context.activity?.({
              id: 'live',
              kind: 'agent',
              name: 'writer',
              status: 'running',
              startedAt: 100,
            });
            context.activity?.({
              id: 'extra',
              kind: 'tool',
              name: 'slide',
              status: 'done',
              startedAt: 101,
              finishedAt: 102,
            });
            context.activity?.({
              id: 'live',
              kind: 'agent',
              name: 'writer',
              status: 'done',
              startedAt: 100,
              finishedAt: 103,
            });
            return { output: { heard: 'да' } };
          },
        },
      ],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    const capped = answer.parts.find((part) => part.type === 'tool');
    if (capped?.type !== 'tool') throw new Error('missing tool');
    expect(capped.activities).toHaveLength(32);
    expect(capped.activities?.filter((item) => item.status === 'running')).toHaveLength(0);
    expect(capped.activities?.map((item) => item.id)).toEqual([
      ...Array.from({ length: 30 }, (_, index) => `job-${index + 10}`),
      'live',
      'extra',
    ]);

    const broken = writer();
    await expect(
      runChatTurn({
        model: {
          model: 'breaks',
          async step(request) {
            request.onToolCall?.('echo');
            throw new Error('stream broke');
          },
        },
        instructions: 'system',
        history: [],
        tools: [echo],
        specs: [
          { name: 'echo', description: 'Echo.', parameters: {} },
          { name: 'ask_user', description: 'Ask.', parameters: {} },
        ],
        mode: 'auto',
        writer: broken.writer,
        signal: AbortSignal.timeout(5000),
      }),
    ).rejects.toThrow('stream broke');
    const preparing = broken.writer.parts.find((part) => part.type === 'tool');
    expect(preparing).toMatchObject({ status: 'failed', phase: 'preparing' });
    if (preparing?.type !== 'tool') throw new Error('missing preparing tool');
    expect(preparing.finishedAt).toEqual(expect.any(Number));
    expect(preparing.finishedAt).toBeGreaterThanOrEqual(preparing.startedAt ?? 0);
  });

  it('cuts off an answer that loops, hides it, and nudges the model once to act', async () => {
    const paragraph =
      'Пользователь хочет четыре изображения на разных слайдах, но в шаблоне только один макет ' +
      'с фото. Возможно, стоит выбрать другие макеты. Давайте перечитаю инструкции. ';
    const requests: ModelStepRequest[] = [];
    const model: ChatModel = {
      model: 'looping',
      async step(request) {
        requests.push({ ...request, messages: [...request.messages] });
        if (requests.length === 1) {
          // Reasoning aloud, round and round, until the stream is stopped.
          for (let round = 0; round < 50; round++) {
            if (request.signal.aborted) throw request.signal.reason;
            request.onText?.(paragraph);
          }
          throw new Error('The loop was never cut off.');
        }
        request.onText?.('Собираю план.');
        return {
          text: 'Собираю план.',
          toolCalls: [],
          truncated: false,
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      loopNudge: 'Сделай следующий шаг.',
    });
    expect(result.end).toBe('answer');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: 'user',
      content: 'Сделай следующий шаг.',
    });
    const text = answer.parts.flatMap((part) => (part.type === 'text' ? [part.text] : []));
    expect(text.join('')).toBe('Собираю план.');
  });

  it('keeps an answer that says different things, however long', () => {
    const varied = Array.from({ length: 40 }, (_, index) => `Пункт ${index}: своё содержание.`);
    expect(looping(varied.join(' '))).toBe(false);
    expect(looping('Одно и то же предложение повторяется снова. '.repeat(12))).toBe(true);
  });

  it('stops after the step limit when the model keeps calling tools', async () => {
    const call = { toolCalls: [{ id: 'c', name: 'echo', arguments: '{"word":"ещё"}' }] };
    const model = scripted([call, call, call]);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      maxSteps: 3,
    });
    expect(result).toMatchObject({ steps: 3, end: 'limit' });
    expect(model.requests).toHaveLength(3);
    expect(model.requests.every((request) => request.tools.length > 0)).toBe(true);
  });

  it('uses the last step to summarize without tools', async () => {
    const model = scripted([
      { text: 'Ищу.', toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
      { text: 'Нашёл только «да».' },
    ]);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      maxSteps: 2,
      finalizeNudge: 'Подведи итог.',
    });
    expect(result).toMatchObject({ steps: 2, end: 'answer' });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual(['echo', 'ask_user']);
    expect(model.requests[1]?.tools).toEqual([]);
    expect(model.requests[1]?.messages.at(-1)).toEqual({
      role: 'system',
      content: 'Подведи итог.',
    });
    expect(answer.parts.map((part) => part.type)).toEqual(['text', 'tool', 'text']);
  });

  it('does not run a tool the model calls on the reserved final step', async () => {
    const run = vi.fn(echo.run);
    const model = scripted([
      { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
      {
        text: 'Ещё проверю.',
        toolCalls: [{ id: 'c2', name: 'echo', arguments: '{"word":"нет"}' }],
      },
    ]);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [{ ...echo, run }],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      maxSteps: 2,
      finalizeNudge: 'Подведи итог.',
    });
    expect(result).toMatchObject({ steps: 2, end: 'limit' });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]?.tools).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
    const tools = answer.parts.filter((part) => part.type === 'tool');
    expect(tools.map((part) => part.status)).toEqual(['done']);
  });

  it('ends a tool call on the reserved final step as the limit, however the server ended it', async () => {
    const model = scripted([
      { toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }] },
      {
        toolCalls: [{ id: 'c2', name: 'echo', arguments: '{"word":"нет"}' }],
        finishReason: 'protocol_error',
      },
    ]);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [{ name: 'echo', description: 'Echo.', parameters: {} }],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      maxSteps: 2,
      finalizeNudge: 'Подведи итог.',
    });
    expect(result).toMatchObject({ steps: 2, end: 'limit' });
  });

  it('does not dispatch a tool when the reserved final step is cancelled', async () => {
    const control = new AbortController();
    const run = vi.fn(echo.run);
    const { writer: answer } = writer();
    const pending = runChatTurn({
      model: {
        model: 'cancel-final',
        async step(request) {
          if (request.tools.length > 0) {
            request.onToolCall?.('echo');
            return {
              text: '',
              toolCalls: [{ id: 'c1', name: 'echo', arguments: '{"word":"да"}' }],
              truncated: false,
              inputTokens: 1,
              outputTokens: 1,
            };
          }
          control.abort();
          request.onToolCall?.('echo');
          return {
            text: 'Итог',
            toolCalls: [{ id: 'c2', name: 'echo', arguments: '{"word":"нет"}' }],
            truncated: false,
            inputTokens: 1,
            outputTokens: 1,
          };
        },
      },
      instructions: 'system',
      history: [],
      tools: [{ ...echo, run }],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: control.signal,
      maxSteps: 2,
      finalizeNudge: 'Подведи итог.',
    });
    await expect(pending).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stops at a waiting tool without spending the reserved final step', async () => {
    const model = scripted([
      {
        toolCalls: [{ id: 'c1', name: 'ask_user', arguments: '{"question":"Какой шаблон?"}' }],
      },
      { text: 'Лишний итог.' },
    ]);
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model,
      instructions: 'system',
      history: [],
      tools: [echo, ask],
      specs: [
        { name: 'echo', description: 'Echo.', parameters: {} },
        { name: 'ask_user', description: 'Ask.', parameters: {} },
      ],
      mode: 'auto',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      maxSteps: 2,
      finalizeNudge: 'Подведи итог.',
    });
    expect(result.end).toBe('waiting');
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.tools.length).toBeGreaterThan(0);
  });
});

describe('modelHistory', () => {
  it('replays text, tool calls and their results in order', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        id: crypto.randomUUID(),
        text: 'Собери колоду',
        attachments: [{ kind: 'template', templateId: crypto.randomUUID(), name: 'ЦУ.pptx' }],
        mode: 'plan',
        createdAt: 1,
      },
      {
        role: 'assistant',
        id: crypto.randomUUID(),
        status: 'done',
        createdAt: 2,
        parts: [
          { type: 'text', text: 'Смотрю.' },
          {
            type: 'tool',
            callId: 'c1',
            name: 'echo',
            input: { word: 'a' },
            status: 'done',
            output: 1,
          },
          { type: 'tool', callId: 'c2', name: 'echo', input: { word: 'b' }, status: 'running' },
          { type: 'text', text: 'Готово.' },
        ],
      },
    ];
    const history = modelHistory(messages);
    expect(history.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(history[0]?.content).toContain('ЦУ.pptx');
    expect(history[1]).toMatchObject({
      content: 'Смотрю.',
      toolCalls: [{ id: 'c1' }, { id: 'c2' }],
    });
    expect(history[3]?.content).toContain('Interrupted');
    expect(history[4]).toEqual({ role: 'assistant', content: 'Готово.' });
  });
});

describe('the chat agent in the registry', () => {
  it('fingerprints changes in mode and tool modules reproducibly', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chat-prompts-'));
    try {
      await cp(join(REGISTRY, 'chat-assistant'), join(root, 'chat-assistant'), { recursive: true });
      const original = await loadChatAgent(root);
      expect(original.promptsSha256).toMatch(/^[a-f0-9]{64}$/);
      expect((await loadChatAgent(root)).promptsSha256).toBe(original.promptsSha256);
      await appendFile(join(root, 'chat-assistant/modes/auto.md'), '\nAdditional mode rule.\n');
      const changedMode = await loadChatAgent(root);
      expect(changedMode.promptsSha256).not.toBe(original.promptsSha256);
      await appendFile(join(root, 'chat-assistant/tools/ask_user.md'), '\nAdditional tool rule.\n');
      expect((await loadChatAgent(root)).promptsSha256).not.toBe(changedMode.promptsSha256);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it('has a prompt for every mode and a description for every tool it is given', async () => {
    const agent = await loadChatAgent(REGISTRY);
    expect(agent.agent.config.id).toBe('chat-assistant');
    for (const mode of ['chat', 'plan', 'auto'] as const) {
      expect(chatInstructions(agent, mode, { today: '2026-09-29' })).toContain(`## Mode: ${mode}`);
    }
    const named = (name: string): ChatTool => ({ ...echo, name });
    const specs = toolSpecs(
      agent,
      [
        'list_templates',
        'describe_template',
        'read_file',
        'read_deck',
        'read_audit',
        'ask_user',
        'propose_plan',
        'build_deck',
      ].map(named),
    );
    expect(specs.every((spec) => spec.description.length > 40)).toBe(true);
    expect(() => toolSpecs(agent, [named('unknown_tool')])).toThrow(/unknown_tool/);
    expect(agent.finalizeNudge).toContain('Do not call any tool');
  });
});

describe('mendedArguments', () => {
  const schema = z.object({
    outline: z.object({ title: z.string(), slides: z.array(z.string()).min(1) }),
    templateId: z.string().nullable(),
  });
  const meant = { outline: { title: 'Умный квартал', slides: ['Пилот'] }, templateId: null };

  it('reads a nested object sent as a string of JSON or spread over the top level', () => {
    const asString = { outline: JSON.stringify(meant.outline), templateId: null };
    expect(schema.parse(mendedArguments(schema, asString))).toEqual(meant);
    const spread = { title: 'Умный квартал', slides: ['Пилот'], templateId: null };
    expect(schema.parse(mendedArguments(schema, spread))).toEqual(meant);
  });

  it('leaves arguments it cannot read for the schema to reject', () => {
    const broken = { outline: '{"title": ', templateId: null };
    expect(mendedArguments(schema, broken)).toEqual(broken);
    expect(schema.safeParse(mendedArguments(schema, broken)).success).toBe(false);
  });
});

describe('lenientJson', () => {
  it('closes the brackets a model left open, and gives up on anything else', () => {
    expect(lenientJson('{"slides": [{"title": "Итог", "points": ["a]"]}]')).toEqual({
      slides: [{ title: 'Итог', points: ['a]'] }],
    });
    expect(lenientJson('{"title": "Итог", ')).toBeNull();
  });
});

describe('buffered retry text replacement', () => {
  it('retracts provisional text even after an early tool announcement closed its part', async () => {
    const { writer: answer, events } = writer();
    const chat: ChatModel = {
      model: 'buffered',
      async step(request) {
        request.onText?.('Provisional');
        request.onToolCall?.('echo');
        request.onTextReset?.();
        request.onText?.('Verified');
        return {
          text: 'Verified',
          toolCalls: [],
          finishReason: 'stop',
          truncated: false,
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const result = await runChatTurn({
      model: chat,
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [],
      mode: 'chat',
      writer: answer,
      signal: AbortSignal.timeout(5000),
      loopNudge: 'continue',
    });
    expect(result.end).toBe('answer');
    expect(
      answer.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    ).toBe('Verified');
    expect(
      events.some(
        (event) => event.type === 'part' && event.part.type === 'text' && event.part.text === '',
      ),
    ).toBe(true);
  });
});
