import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatPart, DeckOutline } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

const templateId = '00000000-0000-4000-8000-000000000001';
const planId = '00000000-0000-4000-8000-000000000002';
const outline: DeckOutline = {
  title: 'Approved content',
  audience: '',
  goal: '',
  slides: Array.from({ length: 10 }, () => ({
    title: 'Fact',
    points: ['Evidence'],
    kind: 'statement',
  })),
};

function fixture(status?: 'failed' | 'cancelled' | 'running' | 'preparing') {
  const messages: ChatMessage[] = [
    {
      role: 'assistant',
      id: 'plan',
      status: 'done',
      createdAt: 1,
      parts: [
        {
          type: 'plan',
          callId: 'plan',
          planId,
          revision: 1,
          outline,
          templateId,
          status: 'approved',
          approvalSource: 'user',
        },
      ],
    },
  ];
  if (status)
    messages.push({
      role: 'assistant',
      id: 'previous',
      status: 'done',
      createdAt: 2,
      parts: [
        {
          type: 'build',
          callId: 'previous',
          buildId: 'previous-build',
          planId,
          planRevision: 1,
          templateId,
          templateName: 'Template',
          runId: 'previous-run',
          variantRunIds: ['previous-run'],
          startedAt: 1,
          finishedAt: status === 'failed' || status === 'cancelled' ? 2 : null,
          status,
          error: status === 'failed' ? 'Model API HTTP 429 for test-model' : null,
        },
      ],
    });
  const shown: ChatPart[] = [];
  messages.push({
    role: 'assistant',
    id: 'current',
    status: 'streaming',
    createdAt: 3,
    parts: shown,
  });
  const generation = {
    template: vi.fn(async () => ({ file_name: 'Template', profile: null })),
    prepare: vi.fn(async () => undefined),
    start: vi.fn(async () => ({
      runId: 'new-run',
      variants: [{ variant: 'balanced', runId: 'new-run' }],
      each: [Promise.resolve({ variant: 'balanced', runId: 'new-run', state: 'failed' })],
    })),
    directory: () => 'missing-fixture-directory',
    cancel: vi.fn(),
  };
  const scope: ChatToolScope = {
    account: { id: 'owner' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'plan',
    model: null,
    currentMessageId: 'current',
    messages: () => messages,
    updatePart: () => undefined,
    addDecks: () => undefined,
  };
  const context: ToolContext = {
    callId: 'current',
    signal: new AbortController().signal,
    show: (part) => shown.push(part) - 1,
    update: (index, part) => {
      shown[index] = part;
    },
  };
  const build = chatTools(generation as unknown as GenerationService, scope).find(
    (tool) => tool.name === 'build_deck',
  );
  if (!build) throw new Error('Missing build tool');
  const invoke = (retry = false) =>
    build.run(build.input.parse({ templateId, planId, retry }), context);
  return { invoke, generation, shown, messages };
}

describe('failed chat build recovery', () => {
  it('ends the turn when all variants fail, preventing a model retry loop', async () => {
    const f = fixture();
    expect(await f.invoke()).toMatchObject({
      failed: true,
      stop: true,
      output: { status: 'failed' },
    });
    expect(f.shown).toContainEqual(expect.objectContaining({ type: 'error' }));
  });

  it('reports a failed operation as failed without starting it or claiming it is running', async () => {
    const f = fixture('failed');
    expect(await f.invoke()).toMatchObject({
      failed: true,
      stop: true,
      output: { status: 'failed', active: false, canRetry: true },
    });
    expect(f.generation.start).not.toHaveBeenCalled();
    expect(f.shown).toContainEqual(
      expect.objectContaining({ type: 'error', message: expect.stringContaining('429') }),
    );
  });

  it.each(['running', 'preparing'] as const)(
    'reuses an actually %s operation even when retry is requested',
    async (status) => {
      const f = fixture(status);
      expect(await f.invoke(true)).toMatchObject({
        stop: true,
        output: { status, active: true, runId: 'previous-run' },
      });
      expect(f.generation.start).not.toHaveBeenCalled();
    },
  );

  it.each(['failed', 'cancelled'] as const)(
    'retries a %s operation only explicitly, preserving the approved outline',
    async (status) => {
      const f = fixture(status);
      await f.invoke(true);
      expect(f.generation.start).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ outline, outlineSource: 'user', templateId }),
        expect.anything(),
      );
      // A second call must inspect the latest attempt, not the first failure in history.
      expect(await f.invoke(true)).toMatchObject({
        output: { status: 'failed', runId: 'new-run', canRetry: false },
      });
      expect(f.generation.start).toHaveBeenCalledTimes(1);
    },
  );
});
