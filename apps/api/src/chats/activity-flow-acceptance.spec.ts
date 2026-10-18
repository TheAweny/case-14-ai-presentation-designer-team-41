import { describe, expect, it, vi } from 'vitest';
import { AnswerWriter, runChatTurn, type ChatModel } from '@lct/pipeline';
import {
  chatMessageSchema,
  type MaterialResearchResult,
  type MaterialResearchSource,
} from '@lct/contracts';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

const scope: ChatToolScope = {
  account: {
    id: 'owner',
    role: 'user',
    email: 'owner@example.org',
    name: 'Owner',
    disabled: false,
    createdAt: '',
  },
  chatId: 'chat',
  projectId: null,
  mode: 'plan',
  model: null,
  messages: () => [],
  updatePart: vi.fn(),
  addDecks: vi.fn(),
};
const url = 'https://example.org/roadster';
const quote = 'The reveal happened on October 15.';

describe('independent activity flow acceptance', () => {
  it('streams the real search, page read and delegated model task and preserves them on the completed part', async () => {
    const requests: string[] = [];
    const events: unknown[] = [];
    const writer = new AnswerWriter('00000000-0000-4000-8000-000000000002', (event) =>
      events.push(structuredClone(event)),
    );
    const assertRunning = (name: string, kind: string) => {
      const part = writer.parts.find((candidate) => candidate.type === 'tool');
      expect(part?.type).toBe('tool');
      if (part?.type !== 'tool') throw new Error('No running tool');
      expect(part.phase).toBe('executing');
      expect(
        part.activities?.some(
          (activity) =>
            activity.name === name && activity.kind === kind && activity.status === 'running',
        ),
      ).toBe(true);
    };
    const search = vi.fn(async () => {
      assertRunning('search_web', 'tool');
      requests.push('search');
      return {
        query: 'Roadster',
        results: [{ url, title: 'Reveal', snippet: 'Read the source', publishedAt: null }],
        searchedAt: '2026-10-18T00:00:00Z',
        complete: true,
        unresponsiveEngines: [],
        trust: 'search-results-not-evidence' as const,
      };
    });
    const fetchSource = vi.fn(async () => {
      assertRunning('fetch_source', 'tool');
      requests.push('fetch');
      return {
        requestedUrl: url,
        url,
        title: 'Reveal',
        text: quote,
        fetchedAt: '2026-10-18T00:00:00Z',
        contentHash: 'a'.repeat(64),
        offset: 0,
        nextOffset: null,
        truncated: false,
        trust: 'unverified' as const,
      };
    });
    const research = vi.fn(
      async (
        _question: string,
        sources: readonly MaterialResearchSource[],
      ): Promise<MaterialResearchResult> => {
        assertRunning('web-researcher', 'agent');
        requests.push('delegate');
        const source = sources[0];
        if (!source) throw new Error('Missing research source');
        return {
          summary: quote,
          outputTruncated: false,
          evidence: [
            {
              sourceId: source.sourceId,
              name: 'Reveal',
              quote,
              start: 0,
              support: 'unverified',
            },
          ],
          openQuestions: [],
          coverage: [],
          manifest: {
            agentId: 'web-researcher',
            agentVersion: '1.0.0',
            instructionsSha256: 'b'.repeat(64),
            model: 'recorded',
            modelRevision: null,
            seed: 42,
            inputTokens: 1,
            outputTokens: 1,
          },
        };
      },
    );
    const tools = chatTools({} as GenerationService, scope, undefined, {
      search: { search },
      fetchSource,
      research: { run: research },
    });
    let step = 0;
    const model: ChatModel = {
      model: 'recorded-activity',
      async step(request) {
        step += 1;
        if (step < 3) {
          request.onToolCall?.('research_topic');
          return {
            text: '',
            toolCalls: [
              {
                id: `research-${step}`,
                name: 'research_topic',
                arguments: '{"question":"Roadster"}',
              },
            ],
            truncated: false,
            inputTokens: 1,
            outputTokens: 1,
          };
        }
        return {
          text: 'Checked the source.',
          toolCalls: [],
          truncated: false,
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    await runChatTurn({
      mode: 'plan',
      model,
      instructions: 'Recorded fixture',
      history: [],
      tools,
      specs: [
        {
          name: 'research_topic',
          description: 'Research fixture',
          parameters: {
            type: 'object',
            properties: { question: { type: 'string' } },
            required: ['question'],
          },
        },
      ],
      writer,
      signal: new AbortController().signal,
    });
    expect(requests).toEqual(['search', 'fetch', 'delegate']);
    const parts = writer.parts.filter((part) => part.type === 'tool');
    expect(parts).toHaveLength(2);
    expect(
      parts[0]?.activities?.map((activity) => [activity.kind, activity.name, activity.status]),
    ).toEqual([
      ['tool', 'search_web', 'done'],
      ['tool', 'fetch_source', 'done'],
      ['agent', 'web-researcher', 'done'],
    ]);
    expect(parts[1]?.activities ?? []).toEqual([]);
    for (const part of parts) {
      expect(part.status).toBe('done');
      expect(part.startedAt).toBeTypeOf('number');
      if (part.startedAt === undefined) throw new Error('Missing start time');
      expect(part.finishedAt).toBeGreaterThanOrEqual(part.startedAt);
    }
    expect(JSON.stringify(events)).toContain('"status":"running"');
    const saved = chatMessageSchema.parse({
      role: 'assistant',
      id: writer.messageId,
      status: 'done',
      createdAt: 1,
      parts: writer.parts,
    });
    expect(saved.role).toBe('assistant');
    if (saved.role !== 'assistant') throw new Error('Missing assistant message');
    expect(saved.parts).toEqual(writer.parts);
  });
});
