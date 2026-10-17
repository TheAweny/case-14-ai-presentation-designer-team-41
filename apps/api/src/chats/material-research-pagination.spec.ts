import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  materialResearchResultSchema,
  type ChatMessage,
  type MaterialResearchResult,
} from '@lct/contracts';
import {
  ChatToolDispatcher,
  loadChatAgent,
  loadMaterialResearchAgent,
  researchMaterials,
  toolSpecs,
  type ChatModel,
  type ToolContext,
} from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

const fileId = '00000000-0000-4000-8000-000000000001';
const otherId = '00000000-0000-4000-8000-000000000002';
const foreignId = '00000000-0000-4000-8000-000000000003';
const directories: string[] = [];
const registry = join(import.meta.dirname, '../../../../registry/agents');

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function textFile(name: string, text: string) {
  const directory = await mkdtemp(join(tmpdir(), 'material-page-'));
  directories.push(directory);
  const path = join(directory, name);
  await writeFile(path, text);
  return path;
}

function scriptedModel(mode: 'quotes' | 'invalid' | 'invented' = 'quotes'): {
  model: ChatModel;
  steps: number;
} {
  const state = { steps: 0 };
  const model: ChatModel = {
    model: 'recorded',
    async step(request) {
      state.steps += 1;
      if (mode === 'invalid' && state.steps === 1) {
        return {
          text: 'not-json',
          toolCalls: [],
          truncated: false,
          finishReason: 'stop' as const,
          inputTokens: 1,
          outputTokens: 1,
        };
      }
      const user = request.messages.find((message) => message.role === 'user');
      const content = user && 'content' in user ? user.content : '{}';
      const payload = JSON.parse(content) as { sources?: { sourceId: string; text: string }[] };
      const excerpts =
        mode === 'invented' && state.steps === 1
          ? [
              {
                sourceId: payload.sources?.[0]?.sourceId ?? fileId,
                quote: 'этой цитаты нет в файле',
              },
            ]
          : (payload.sources ?? []).slice(0, 3).flatMap((source) => {
              const marker = source.text.match(/[\u0410-\u044F\u0401\u0451][^"]{0,80}/);
              const quote = (marker?.[0] ?? '').trim();
              return quote ? [{ sourceId: source.sourceId, quote }] : [];
            });
      return {
        text: JSON.stringify({ excerpts, openQuestions: [] }),
        toolCalls: [],
        truncated: false,
        finishReason: 'stop' as const,
        inputTokens: 1,
        outputTokens: 1,
      };
    },
  };
  return {
    model,
    get steps() {
      return state.steps;
    },
  };
}

async function harness(
  files: ReadonlyMap<string, { name: string; path: string }>,
  attached = [...files.keys()],
  mode: 'quotes' | 'invalid' | 'invented' = 'quotes',
) {
  const child = scriptedModel(mode);
  const agent = await loadMaterialResearchAgent(registry);
  const chatAgent = await loadChatAgent(registry);
  const query = vi.fn(async (_sql: string, values: unknown[]) => {
    const row = files.get(String(values[0]));
    return { rows: row ? [{ file_name: row.name, storage_path: row.path }] : [] };
  });
  const generation = { pool: { query } } as unknown as GenerationService;
  const messages: ChatMessage[] = [
    {
      role: 'user',
      id: 'user',
      createdAt: 1,
      mode: 'plan',
      text: '\u0418\u0441\u0441\u043b\u0435\u0434\u0443\u0439 \u043c\u0430\u0442\u0435\u0440\u0438\u0430\u043b\u044b',
      attachments: attached.map((id) => ({
        kind: 'file' as const,
        fileId: id,
        name: files.get(id)?.name ?? 'missing.txt',
        size: 100,
      })),
    },
  ];
  const scope: ChatToolScope = {
    account: { id: 'owner' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'plan',
    model: null,
    messages: () => messages,
    updatePart: () => undefined,
    addDecks: () => undefined,
  };
  const tools = chatTools(generation, scope, {
    run: (question, sources, signal) =>
      researchMaterials({ question, sources, model: child.model, agent, signal, seed: 42 }),
  });
  const dispatcher = new ChatToolDispatcher({
    tools,
    specs: toolSpecs(chatAgent, tools),
    mode: 'plan',
  });
  const context: ToolContext = {
    callId: 'research',
    signal: new AbortController().signal,
    show: () => 0,
    update: () => undefined,
  };
  return { child, dispatcher, context, query };
}

function resultOf(outcome: { output: unknown }): MaterialResearchResult {
  return materialResearchResultSchema.parse(outcome.output);
}

describe('material research pagination', () => {
  it('pages past 21000 characters and attributes the later quote absolutely', async () => {
    const original =
      'x'.repeat(21000) +
      '\u0411\u044e\u0434\u0436\u0435\u0442: 25 \u0440\u0443\u0431\u043b\u0435\u0439.';
    const path = await textFile('brief.txt', original);
    const { dispatcher, context, child } = await harness(
      new Map([[fileId, { name: 'brief.txt', path }]]),
    );
    const first = await dispatcher.dispatch(
      'research_materials',
      JSON.stringify({
        question: '\u041a\u0430\u043a\u043e\u0439 \u0431\u044e\u0434\u0436\u0435\u0442?',
        fileIds: [fileId],
      }),
      context,
    );
    expect(first.failed).not.toBe(true);
    const nextOffset = resultOf(first).coverage.find(
      (item) => item.sourceId === fileId,
    )?.nextOffset;
    expect(nextOffset).toBe(12000);
    const second = await dispatcher.dispatch(
      'research_materials',
      JSON.stringify({
        question: '\u041a\u0430\u043a\u043e\u0439 \u0431\u044e\u0434\u0436\u0435\u0442?',
        fileIds: [fileId],
        offsets: { [fileId]: nextOffset },
      }),
      context,
    );
    expect(second.failed).not.toBe(true);
    const hit = resultOf(second).evidence.find((item) =>
      item.quote.includes('\u0411\u044e\u0434\u0436\u0435\u0442'),
    );
    expect(hit?.start).toBe(21000);
    expect(hit?.support).toBe('unverified');
    expect(original.slice(hit?.start ?? 0, (hit?.start ?? 0) + (hit?.quote.length ?? 0))).toBe(
      hit?.quote,
    );
    expect(child.steps).toBe(2);
  });

  it('keeps absolute positions of two offset files on their own sources', async () => {
    const left =
      'a'.repeat(100) +
      '\u041c\u0435\u0442\u043a\u0430-\u043e\u0434\u0438\u043d \u043a\u043e\u043d\u0435\u0446.';
    const right =
      'b'.repeat(15000) +
      '\u041c\u0435\u0442\u043a\u0430-\u0434\u0432\u0430 \u043a\u043e\u043d\u0435\u0446.';
    const { dispatcher, context } = await harness(
      new Map([
        [fileId, { name: 'left.txt', path: await textFile('left.txt', left) }],
        [otherId, { name: 'right.txt', path: await textFile('right.txt', right) }],
      ]),
    );
    const outcome = await dispatcher.dispatch(
      'research_materials',
      JSON.stringify({
        question: '\u0413\u0434\u0435 \u043c\u0435\u0442\u043a\u0438?',
        fileIds: [fileId, otherId],
        offsets: { [fileId]: 0, [otherId]: 12000 },
      }),
      context,
    );
    expect(outcome.failed).not.toBe(true);
    const result = resultOf(outcome);
    const leftHit = result.evidence.find((item) => item.sourceId === fileId);
    const rightHit = result.evidence.find((item) => item.sourceId === otherId);
    expect(
      left.slice(leftHit?.start ?? -1, (leftHit?.start ?? 0) + (leftHit?.quote.length ?? 0)),
    ).toBe(leftHit?.quote);
    expect(
      right.slice(rightHit?.start ?? -1, (rightHit?.start ?? 0) + (rightHit?.quote.length ?? 0)),
    ).toBe(rightHit?.quote);
    expect(leftHit?.start).toBe(100);
    expect(leftHit?.support).toBe('unverified');
    expect(rightHit?.start).toBe(15000);
    expect(rightHit?.support).toBe('unverified');
    expect(result.coverage.map((item) => item.sourceId)).toEqual([fileId, otherId]);
    expect(result.coverage.find((item) => item.sourceId === otherId)?.offset).toBe(12000);
  });

  it('does not call the model for an unattached file or a foreign offset key', async () => {
    const path = await textFile(
      'brief.txt',
      '\u0411\u044e\u0434\u0436\u0435\u0442: 25 \u0440\u0443\u0431\u043b\u0435\u0439.',
    );
    const { dispatcher, context, child, query } = await harness(
      new Map([[fileId, { name: 'brief.txt', path }]]),
    );
    const unattached = await dispatcher.dispatch(
      'research_materials',
      JSON.stringify({ question: '\u0412\u043e\u043f\u0440\u043e\u0441', fileIds: [otherId] }),
      context,
    );
    const foreignOffset = await dispatcher.dispatch(
      'research_materials',
      JSON.stringify({
        question: '\u0412\u043e\u043f\u0440\u043e\u0441',
        fileIds: [fileId],
        offsets: { [foreignId]: 1 },
      }),
      context,
    );
    expect(unattached.failed).toBe(true);
    expect(foreignOffset.failed).toBe(true);
    expect(child.steps).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects the third research call after two model steps', async () => {
    const path = await textFile(
      'brief.txt',
      '\u0411\u044e\u0434\u0436\u0435\u0442: 25 \u0440\u0443\u0431\u043b\u0435\u0439.',
    );
    const { dispatcher, context, child } = await harness(
      new Map([[fileId, { name: 'brief.txt', path }]]),
    );
    const input = JSON.stringify({
      question: '\u041a\u0430\u043a\u043e\u0439 \u0431\u044e\u0434\u0436\u0435\u0442?',
      fileIds: [fileId],
    });
    await dispatcher.dispatch('research_materials', input, context);
    await dispatcher.dispatch('research_materials', input, context);
    const third = await dispatcher.dispatch('research_materials', input, context);
    expect(third.failed).toBe(true);
    expect(child.steps).toBe(2);
  });

  it('spends the invalid first call and recovers on the same dispatcher', async () => {
    const path = await textFile(
      'brief.txt',
      '\u0411\u044e\u0434\u0436\u0435\u0442: 25 \u0440\u0443\u0431\u043b\u0435\u0439.',
    );
    const broken = await harness(
      new Map([[fileId, { name: 'brief.txt', path }]]),
      [fileId],
      'invalid',
    );
    const input = JSON.stringify({
      question: '\u041a\u0430\u043a\u043e\u0439 \u0431\u044e\u0434\u0436\u0435\u0442?',
      fileIds: [fileId],
    });
    const failed = await broken.dispatcher.dispatch('research_materials', input, broken.context);
    expect(failed.failed).toBe(true);
    expect(broken.child.steps).toBe(1);
    const recovered = await broken.dispatcher.dispatch('research_materials', input, broken.context);
    expect(recovered.failed).not.toBe(true);
    expect(resultOf(recovered).evidence[0]?.quote).toContain(
      '\u0411\u044e\u0434\u0436\u0435\u0442',
    );
    expect(broken.child.steps).toBe(2);
    const third = await broken.dispatcher.dispatch('research_materials', input, broken.context);
    expect(third.failed).toBe(true);
    expect(broken.child.steps).toBe(2);
  });

  it('drops an invented quote and still accepts the next real one', async () => {
    const path = await textFile(
      'brief.txt',
      '\u0411\u044e\u0434\u0436\u0435\u0442: 25 \u0440\u0443\u0431\u043b\u0435\u0439.',
    );
    const invented = await harness(
      new Map([[fileId, { name: 'brief.txt', path }]]),
      [fileId],
      'invented',
    );
    const input = JSON.stringify({
      question: '\u041a\u0430\u043a\u043e\u0439 \u0431\u044e\u0434\u0436\u0435\u0442?',
      fileIds: [fileId],
    });
    const empty = await invented.dispatcher.dispatch('research_materials', input, invented.context);
    expect(empty.failed).not.toBe(true);
    expect(resultOf(empty).evidence).toEqual([]);
    const recovered = await invented.dispatcher.dispatch(
      'research_materials',
      input,
      invented.context,
    );
    expect(resultOf(recovered).evidence[0]?.quote).toContain(
      '\u0411\u044e\u0434\u0436\u0435\u0442',
    );
    expect(invented.child.steps).toBe(2);
  });
});
