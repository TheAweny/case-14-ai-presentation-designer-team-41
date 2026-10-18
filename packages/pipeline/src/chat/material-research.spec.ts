import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { MaterialResearchSource } from '@lct/contracts';
import { loadAgent } from '@lct/registry';
import {
  loadMaterialResearchAgent,
  MaterialResearchError,
  researchMaterials,
} from './material-research.js';
import { AnswerWriter, loadChatAgent, runChatTurn, toolSpecs, type ChatTool } from './agent.js';
import type { ChatModel, ModelStep } from './chat-model.js';
import { OpenAICompatibleChatModel } from './chat-model.js';
import { materialResearchInputSchema } from '@lct/contracts';

const REGISTRY = join(import.meta.dirname, '../../../../registry/agents');
const source: MaterialResearchSource = {
  sourceId: '00000000-0000-4000-8000-000000000001',
  name: 'brief.txt',
  text: 'Вступление\nБюджет: 25 рублей.\nPRIVATE_TAIL',
  truncated: false,
};
const signal = () => new AbortController().signal;
const step = (answer: unknown): ModelStep => ({
  text: JSON.stringify(answer),
  toolCalls: [],
  truncated: false,
  finishReason: 'stop',
  inputTokens: 30,
  outputTokens: 20,
});
const INCOMPLETE = 'The material researcher returned an incomplete answer.';
async function incomplete(options: Awaited<ReturnType<typeof setup>>) {
  try {
    await researchMaterials(options);
  } catch (error) {
    expect(error).toBeInstanceOf(MaterialResearchError);
    if (!(error instanceof MaterialResearchError)) throw error;
    expect(error.kind).toBe('incomplete');
    expect(error.message).toBe(INCOMPLETE);
    expect(error.cause).toBeUndefined();
    return error;
  }
  throw new Error('expected material research to reject');
}
async function setup(answer: unknown) {
  const model: ChatModel = { model: 'recorded', step: vi.fn(async () => step(answer)) };
  const agent = await loadMaterialResearchAgent(REGISTRY);
  return { question: 'Какой бюджет?', sources: [source], model, agent, signal: signal(), seed: 42 };
}

describe('isolated material researcher', () => {
  it('returns only exact attributed quotes with an audit manifest, without sending parent history', async () => {
    const options = await setup({
      excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
      openQuestions: [],
    });
    const result = await researchMaterials(options);
    expect(result.summary).toBe('Бюджет: 25 рублей.');
    expect(result.evidence).toEqual([
      {
        sourceId: source.sourceId,
        name: source.name,
        quote: result.summary,
        start: 11,
        support: 'unverified',
      },
    ]);
    expect(result.manifest).toMatchObject({
      agentId: 'material-researcher',
      model: 'recorded',
      seed: 42,
      modelRevision: null,
      inputTokens: 30,
    });
    expect(result.manifest.instructionsSha256).toHaveLength(64);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_TAIL');
    expect(options.model.step).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: [],
        messages: [
          { role: 'system', content: options.agent.instructions },
          {
            role: 'user',
            content: JSON.stringify({ question: options.question, sources: options.sources }),
          },
        ],
      }),
    );
  });

  it('drops invented and misattributed quotes and never returns the model summary', async () => {
    const options = await setup({
      excerpts: [
        { sourceId: source.sourceId, quote: 'Бюджет: 99 рублей.' },
        { sourceId: '00000000-0000-4000-8000-000000000002', quote: 'Бюджет: 25 рублей.' },
        { sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' },
      ],
      summary: 'Invented extra fact',
      openQuestions: [],
    });
    const result = await researchMaterials(options);
    expect(result.evidence).toHaveLength(1);
    expect(result.summary).toBe('Бюджет: 25 рублей.');
    expect(result.openQuestions).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('99 рублей');
    expect(JSON.stringify(result)).not.toContain('Invented extra fact');
  });

  it('reports missing evidence and partial coverage', async () => {
    const options = await setup({ excerpts: [], openQuestions: ['Уточните период.'] });
    const result = await researchMaterials({
      ...options,
      sources: [{ ...source, truncated: true }],
    });
    expect(result.evidence).toEqual([]);
    expect(result.summary).toBe('');
    expect(result.openQuestions).toHaveLength(2);
    expect(result.openQuestions[1]).toBe('Исследователь не вернул проверяемую цитату для ответа.');
    expect(result.coverage[0]).toEqual({
      sourceId: source.sourceId,
      offset: 0,
      readChars: source.text.length,
      truncated: true,
      nextOffset: source.text.length,
    });
  });

  it('treats a missing source offset as zero and keeps complete coverage closed', async () => {
    const options = await setup({
      excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
      openQuestions: [],
    });
    const result = await researchMaterials(options);
    expect(result.evidence[0]?.start).toBe(11);
    expect(result.coverage[0]).toEqual({
      sourceId: source.sourceId,
      offset: 0,
      readChars: source.text.length,
      truncated: false,
      nextOffset: null,
    });
  });

  it('adds the source offset to a local quote index, including an emoji', async () => {
    const options = await setup({
      excerpts: [{ sourceId: source.sourceId, quote: 'бюджет' }],
      openQuestions: [],
    });
    const result = await researchMaterials({
      ...options,
      sources: [{ ...source, offset: 5, text: '😀 бюджет', truncated: false }],
    });
    expect(result.evidence[0]?.start).toBe(8);
    expect(result.coverage[0]?.nextOffset).toBeNull();
  });

  it('reports the next offset per file and rejects a quote outside the source text', async () => {
    const secondId = '00000000-0000-4000-8000-000000000002';
    const options = await setup({
      excerpts: [
        { sourceId: source.sourceId, quote: 'бюджет' },
        { sourceId: secondId, quote: 'вне текста' },
      ],
      openQuestions: [],
    });
    const secondText = 'хвост';
    const result = await researchMaterials({
      ...options,
      sources: [
        { ...source, offset: 5, text: '😀 бюджет', truncated: false },
        {
          sourceId: secondId,
          name: 'tail.txt',
          text: secondText,
          offset: 1_000_000,
          truncated: true,
        },
      ],
    });
    expect(result.evidence).toEqual([
      {
        sourceId: source.sourceId,
        name: source.name,
        quote: 'бюджет',
        start: 8,
        support: 'unverified',
      },
    ]);
    expect(result.coverage).toEqual([
      {
        sourceId: source.sourceId,
        offset: 5,
        readChars: '😀 бюджет'.length,
        truncated: false,
        nextOffset: null,
      },
      {
        sourceId: secondId,
        offset: 1_000_000,
        readChars: secondText.length,
        truncated: true,
        nextOffset: 1_000_000 + secondText.length,
      },
    ]);
    expect(result.openQuestions).toEqual([
      'Часть цитат исследователя не найдена в исходных материалах и отброшена.',
    ]);
  });

  it('keeps escaped output below the parent clipping boundary without breaking its structure', async () => {
    const quotes = ['a', 'b', 'c'].map((suffix) => `${'\u0001'.repeat(999)}${suffix}`);
    const options = await setup({
      excerpts: quotes.map((quote) => ({ sourceId: source.sourceId, quote })),
      openQuestions: [],
    });
    const result = await researchMaterials({
      ...options,
      sources: [{ ...source, text: quotes.join('\n') }],
    });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(10000);
    expect(result.outputTruncated).toBe(true);
    expect(result.summary).toBe(result.evidence.map((item) => item.quote).join('\n'));
  });

  it('works through the actual chat JSON transport with a recorded HTTP response', async () => {
    const options = await setup({});
    const chatAgent = await loadChatAgent(REGISTRY);
    const answer = {
      excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
      openQuestions: [],
    };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.tools).toBeUndefined();
      expect(body.model).toBe('recorded-json-researcher');
      expect(body.temperature).toBe(0.2);
      expect(body.max_tokens).toBe(2048);
      expect(body.messages[0].content).toContain(options.agent.instructions);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ say: JSON.stringify(answer), tool: '', arguments: '' }),
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 20 },
      });
    });
    const model = new OpenAICompatibleChatModel({
      baseUrl: 'https://recorded.example/v1',
      apiKey: '',
      model: 'recorded-json-researcher',
      jsonModeInstructions: chatAgent.jsonMode,
      generation: options.agent.config.generation,
      fetchImpl,
    });
    const result = await researchMaterials({ ...options, model });
    expect(result.evidence).toHaveLength(1);
    expect(result.summary).toBe(answer.excerpts[0]?.quote);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['length', 'protocol_error', 'content_filter', 'interrupted'] as const)(
    'rejects incomplete %s output',
    async (finishReason) => {
      const secret = 'RAW_' + finishReason + '_PAYLOAD';
      const answer = {
        excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
        openQuestions: [],
      };
      const options = await setup(answer);
      options.model.step = vi.fn(async () => ({
        ...step(answer),
        text: secret + JSON.stringify(answer),
        finishReason,
      }));
      const error = await incomplete(options);
      expect(error.reason).toBe(finishReason);
      expect(error.message).not.toContain(secret);
      expect(options.model.step).toHaveBeenCalledTimes(1);
    },
  );

  it('refuses tools from the child', async () => {
    const secret = 'TOOL_SECRET_PAYLOAD';
    const answer = {
      excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
      openQuestions: [],
    };
    const options = await setup(answer);
    options.model.step = vi.fn(async () => ({
      ...step(answer),
      toolCalls: [{ id: 'nested', name: 'build_deck', arguments: JSON.stringify({ x: secret }) }],
    }));
    const error = await incomplete(options);
    expect(error.reason).toBe('tool_calls');
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain('build_deck');
    expect(options.model.step).toHaveBeenCalledTimes(1);
  });

  it('rejects a tool_calls finish without executing a call', async () => {
    const answer = {
      excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
      openQuestions: [],
    };
    const options = await setup(answer);
    options.model.step = vi.fn(async () => ({
      ...step(answer),
      finishReason: 'tool_calls' as const,
    }));
    const error = await incomplete(options);
    expect(error.reason).toBe('tool_calls');
    expect(options.model.step).toHaveBeenCalledTimes(1);
  });

  it('does not accept a complete JSON object cut off by the token limit', async () => {
    const answer = {
      excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
      openQuestions: [],
    };
    const options = await setup(answer);
    options.model.step = vi.fn(async () => ({
      ...step(answer),
      truncated: true,
      finishReason: 'stop' as const,
    }));
    const error = await incomplete(options);
    expect(error.reason).toBe('length');
    expect(options.model.step).toHaveBeenCalledTimes(1);
  });

  it.each(['', '   ', '\n'])('rejects an empty answer as empty', async (text) => {
    const options = await setup({});
    options.model.step = vi.fn(async () => ({ ...step({}), text, finishReason: 'stop' as const }));
    const error = await incomplete(options);
    expect(error.reason).toBe('empty');
    expect(options.model.step).toHaveBeenCalledTimes(1);
  });

  it.each([
    'not-json RAW_PROTOCOL_PAYLOAD',
    '{"excerpts":"RAW_PROTOCOL_PAYLOAD"}',
    '{"openQuestions":["RAW_PROTOCOL_PAYLOAD"]}',
  ])('rejects an unusable answer as protocol_error without the raw text', async (text) => {
    const options = await setup({});
    options.model.step = vi.fn(async () => ({ ...step({}), text, finishReason: 'stop' as const }));
    const error = await incomplete(options);
    expect(error.reason).toBe('protocol_error');
    expect(error.message).not.toContain('RAW_PROTOCOL_PAYLOAD');
    expect(options.model.step).toHaveBeenCalledTimes(1);
  });

  it('honours parent cancellation even when the child ignores its signal', async () => {
    const options = await setup({});
    const controller = new AbortController();
    options.model.step = async () => new Promise<never>(() => undefined);
    const running = researchMaterials({ ...options, signal: controller.signal });
    controller.abort(new Error('Stopped by user'));
    await expect(running).rejects.toThrow('Stopped by user');
    await expect(running).rejects.not.toBeInstanceOf(MaterialResearchError);
  });

  it('stops a stuck child at the deadline', async () => {
    const options = await setup({});
    vi.useFakeTimers();
    try {
      options.model.step = async () => new Promise<never>(() => undefined);
      const running = researchMaterials(options);
      const rejected = expect(running).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(30001);
      await rejected;
      await expect(running).rejects.not.toBeInstanceOf(MaterialResearchError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses recursive research', async () => {
    const options = await setup({});
    options.model.step = async () => {
      await researchMaterials(options);
      return step({});
    };
    await expect(researchMaterials(options)).rejects.toThrow(/Nested/);
  });

  it('keeps one inner JSON and a conditional transport wrapper', async () => {
    const agent = await loadAgent(join(REGISTRY, 'web-researcher'));
    expect(agent.config.version).toBe('1.1.0');
    expect(agent.config.generation.maxOutputTokens).toBe(4096);
    expect(agent.instructions).toContain('около 300 символов');
    expect(agent.instructions).toContain(
      'Если транспорт требует say/tool/arguments, помести JSON excerpts/openQuestions в say, ' +
        'tool/arguments оставь пустыми.',
    );
    expect(agent.instructions).not.toContain('Без второго формата');
    expect(agent.instructions).not.toContain('Верни только JSON');
  });

  it('runs parent -> researcher -> parent using recorded responses and stores the verified tool output', async () => {
    const options = await setup({
      excerpts: [{ sourceId: source.sourceId, quote: 'Бюджет: 25 рублей.' }],
      openQuestions: [],
    });
    const agent = await loadChatAgent(REGISTRY);
    const tool: ChatTool = {
      name: 'research_materials',
      input: materialResearchInputSchema,
      modes: ['chat', 'plan', 'auto'],
      async run(input, context) {
        const request = materialResearchInputSchema.parse(input);
        return {
          output: await researchMaterials({
            ...options,
            question: request.question,
            signal: context.signal,
          }),
        };
      },
    };
    const writer = new AnswerWriter('answer', () => undefined);
    let calls = 0;
    const parent: ChatModel = {
      model: 'parent',
      async step(request) {
        if (calls++ === 0)
          return {
            ...step({}),
            text: '',
            toolCalls: [
              {
                id: 'research',
                name: tool.name,
                arguments: JSON.stringify({
                  question: options.question,
                  fileIds: [source.sourceId],
                }),
              },
            ],
          };
        const observation = request.messages.findLast((message) => message.role === 'tool');
        expect(observation?.content).toContain('Бюджет: 25 рублей.');
        expect(observation?.content).not.toContain('PRIVATE_TAIL');
        return { ...step({}), text: 'В материале указан бюджет 25 рублей.' };
      },
    };
    const result = await runChatTurn({
      model: parent,
      mode: 'plan',
      instructions: 'recorded',
      history: [{ role: 'user', content: 'Какой бюджет?' }],
      tools: [tool],
      specs: toolSpecs(agent, [tool]),
      writer,
      signal: signal(),
    });
    expect(result.end).toBe('answer');
    expect(writer.parts.find((part) => part.type === 'tool')).toMatchObject({
      status: 'done',
      output: {
        evidence: [{ support: 'unverified' }],
        manifest: { agentId: 'material-researcher' },
      },
    });
  });
});
