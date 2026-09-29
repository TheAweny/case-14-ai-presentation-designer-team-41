import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ChatMessage, ChatPart } from '@lct/contracts';
import {
  AnswerWriter,
  chatInstructions,
  loadChatAgent,
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
      specs: [],
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    expect(result).toMatchObject({ steps: 2, end: 'answer' });
    expect(answer.parts).toEqual<ChatPart[]>([
      { type: 'text', text: 'Проверю.' },
      {
        type: 'tool',
        callId: 'c1',
        name: 'echo',
        input: { word: 'да' },
        status: 'done',
        output: { heard: 'да' },
      },
      { type: 'text', text: 'Услышал «да».' },
    ]);
    expect(model.requests[1]?.messages.at(-1)).toEqual({
      role: 'tool',
      callId: 'c1',
      content: '{"heard":"да"}',
    });
    expect(events.filter((event) => event.type === 'text-delta')).toHaveLength(2);
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
      specs: [],
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
      specs: [],
      writer: answer,
      signal: AbortSignal.timeout(5000),
    });
    expect(result.end).toBe('waiting');
    expect(answer.parts.map((part) => part.type)).toEqual(['tool', 'question', 'tool']);
    expect(answer.parts[2]).toMatchObject({ output: { skipped: expect.any(String) } });
  });

  it('stops after the step limit when the model keeps calling tools', async () => {
    const call = { toolCalls: [{ id: 'c', name: 'echo', arguments: '{"word":"ещё"}' }] };
    const { writer: answer } = writer();
    const result = await runChatTurn({
      model: scripted([call, call, call]),
      instructions: 'system',
      history: [],
      tools: [echo],
      specs: [],
      writer: answer,
      signal: AbortSignal.timeout(5000),
      maxSteps: 3,
    });
    expect(result).toMatchObject({ steps: 3, end: 'limit' });
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
  });
});
