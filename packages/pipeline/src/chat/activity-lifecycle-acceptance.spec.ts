import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnswerWriter, runChatTurn, type ChatTool, type ToolContext } from './agent.js';
import type { ChatModel } from './chat-model.js';

async function run(tool: ChatTool) {
  let called = false;
  const model: ChatModel = {
    model: 'recorded',
    async step() {
      if (!called) {
        called = true;
        return {
          text: '',
          toolCalls: [{ id: 'call', name: tool.name, arguments: '{}' }],
          truncated: false,
          inputTokens: 1,
          outputTokens: 1,
        };
      }
      return {
        text: 'Finished.',
        toolCalls: [],
        truncated: false,
        inputTokens: 1,
        outputTokens: 1,
      };
    },
  };
  const writer = new AnswerWriter('00000000-0000-4000-8000-000000000002', () => undefined);
  await runChatTurn({
    mode: 'plan',
    model,
    tools: [tool],
    instructions: 'Recorded fixture',
    history: [],
    specs: [
      { name: tool.name, description: 'Fixture', parameters: { type: 'object', properties: {} } },
    ],
    writer,
    signal: new AbortController().signal,
  });
  return writer;
}

describe('independent activity lifecycle acceptance', () => {
  it('does not invent success for a child that never reported completion', async () => {
    let late: ToolContext['activity'];
    const writer = await run({
      name: 'fixture',
      modes: ['plan'],
      input: z.object({}),
      async run(_input, context) {
        late = context.activity;
        context.activity?.({
          id: 'orphan',
          kind: 'agent',
          name: 'researcher',
          status: 'running',
          startedAt: 1,
        });
        return { output: { ok: true } };
      },
    });
    const part = writer.parts.find((candidate) => candidate.type === 'tool');
    expect(part?.activities?.[0]?.status).toBe('cancelled');
    const before = JSON.stringify(writer.parts);
    late?.({
      id: 'orphan',
      kind: 'agent',
      name: 'researcher',
      status: 'done',
      startedAt: 1,
      finishedAt: 10,
    });
    expect(JSON.stringify(writer.parts)).toBe(before);
  });

  it('keeps a completed child terminal while forty later steps pass through the rolling history', async () => {
    const writer = await run({
      name: 'fixture',
      modes: ['plan'],
      input: z.object({}),
      async run(_input, context) {
        const done = { id: 'early', kind: 'agent' as const, name: 'researcher', startedAt: 1 };
        context.activity?.({ ...done, status: 'running' });
        context.activity?.({ ...done, status: 'done', finishedAt: 2 });
        context.activity?.({ ...done, status: 'failed', finishedAt: 3 });
        for (let index = 0; index < 40; index += 1) {
          const base = {
            id: `later-${index}`,
            kind: 'tool' as const,
            name: 'fetch_source',
            startedAt: index + 4,
          };
          context.activity?.({ ...base, status: 'running' });
          context.activity?.({ ...base, status: 'done', finishedAt: index + 5 });
        }
        return { output: { ok: true } };
      },
    });
    const part = writer.parts.find((candidate) => candidate.type === 'tool');
    expect(part?.activities).toHaveLength(32);
    expect(part?.activities?.every((activity) => activity.status === 'done')).toBe(true);
    expect(part?.activities?.at(-1)?.id).toBe('later-39');
  });

  it('ignores a late failure after the same child already succeeded', async () => {
    const writer = await run({
      name: 'fixture',
      modes: ['plan'],
      input: z.object({}),
      async run(_input, context) {
        const base = { id: 'early', kind: 'agent' as const, name: 'researcher', startedAt: 1 };
        context.activity?.({ ...base, status: 'running' });
        context.activity?.({ ...base, status: 'done', finishedAt: 2 });
        context.activity?.({ ...base, status: 'failed', finishedAt: 3 });
        return { output: { ok: true } };
      },
    });
    const part = writer.parts.find((candidate) => candidate.type === 'tool');
    expect(part?.activities?.[0]?.status).toBe('done');
    expect(part?.activities?.[0]?.finishedAt).toBe(2);
  });
});
