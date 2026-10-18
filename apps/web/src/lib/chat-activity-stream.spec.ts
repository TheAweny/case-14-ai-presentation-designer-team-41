import { describe, expect, it } from 'vitest';
import type { ChatEvent, ChatMessage } from '@lct/contracts';
import { applyChatEvent, readChatEvents } from './chat-stream';

describe('activity metadata through the browser stream', () => {
  it('retains nested state through split UTF-8 event chunks and a later parent completion', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    const activity = {
      id: 'researcher',
      kind: 'agent' as const,
      name: 'web-researcher',
      detail: 'Проверить свежую презентацию 🚗',
      status: 'running' as const,
      startedAt: 100,
    };
    const tool = {
      type: 'tool' as const,
      callId: 'research',
      name: 'research_topic',
      input: { question: 'Новый автомобиль' },
      status: 'running' as const,
      phase: 'executing' as const,
      startedAt: 90,
      activities: [activity],
    };
    const events: ChatEvent[] = [
      {
        type: 'message',
        seq: 0,
        message: { role: 'assistant', id, createdAt: 90, status: 'streaming', parts: [] },
      },
      { type: 'part', seq: 1, messageId: id, index: 0, part: tool },
      {
        type: 'part',
        seq: 2,
        messageId: id,
        index: 0,
        part: {
          ...tool,
          status: 'done',
          finishedAt: 300,
          activities: [{ ...activity, status: 'done', finishedAt: 299 }],
        },
      },
      { type: 'turn-end', seq: 3 },
    ];
    const bytes = new TextEncoder().encode(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 7)
          controller.enqueue(bytes.slice(index, index + 7));
        controller.close();
      },
    });
    let messages: readonly ChatMessage[] = [];
    const snapshots: string[] = [];
    await readChatEvents(stream, (event) => {
      messages = applyChatEvent(messages, event);
      snapshots.push(JSON.stringify(messages));
    });
    expect(snapshots[1]).toContain('"status":"running"');
    const answer = messages[0];
    expect(answer?.role).toBe('assistant');
    if (answer?.role !== 'assistant') throw new Error('Missing answer');
    const part = answer.parts[0];
    expect(part?.type).toBe('tool');
    if (part?.type !== 'tool') throw new Error('Missing tool');
    expect(part.finishedAt).toBe(300);
    expect(part.activities).toEqual([{ ...activity, status: 'done', finishedAt: 299 }]);
  });
});
