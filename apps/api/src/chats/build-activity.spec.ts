import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ChatPart } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService, VariantEnd } from '../generation/generation.service.js';
import { runBuild, VARIANT_GRACE_MS, type ChatToolScope } from './chat-tools.js';

function deferred(): { promise: Promise<VariantEnd>; resolve: (end: VariantEnd) => void } {
  let resolve: (end: VariantEnd) => void = () => undefined;
  const promise = new Promise<VariantEnd>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('build activity', () => {
  it('passes the callback as the fourth start argument and waits for every variant', async () => {
    const dense = deferred();
    const airy = deferred();
    const balanced: VariantEnd = { variant: 'balanced', runId: 'balanced', state: 'done' };
    const variants = [
      { variant: 'dense' as const, runId: 'dense' },
      { variant: 'balanced' as const, runId: 'balanced' },
      { variant: 'airy' as const, runId: 'airy' },
    ];
    const each = [dense.promise, Promise.resolve(balanced), airy.promise];
    let retry: Parameters<GenerationService['start']>[2];
    let forwarded: Parameters<GenerationService['start']>[3];
    const start = vi.fn(async (...args: Parameters<GenerationService['start']>) => {
      retry = args[2];
      forwarded = args[3];
      return {
        runId: 'balanced',
        variants,
        each,
        settled: Promise.all(each),
      };
    });
    const generation = {
      template: async () => ({ file_name: 'Template', profile: null }),
      prepare: async () => undefined,
      start,
      cancel: vi.fn(),
      directory: () => 'missing',
    } as unknown as GenerationService;
    const messages: ChatMessage[] = [
      {
        role: 'user',
        id: crypto.randomUUID(),
        text: 'Собери',
        attachments: [],
        mode: 'plan',
        createdAt: 1,
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
    const parts: ChatPart[] = [];
    const activity = vi.fn();
    const context = {
      callId: 'build',
      signal: new AbortController().signal,
      show: (part: ChatPart) => {
        parts.push(part);
        return 0;
      },
      update: (_index: number, part: ChatPart) => {
        parts.push(part);
      },
      activity,
    } as ToolContext;
    vi.useFakeTimers();
    try {
      let finished = false;
      const pending = runBuild(generation, scope, context, {
        templateId: crypto.randomUUID(),
        outline: null,
        brief: '',
        fileIds: [],
      }).finally(() => {
        finished = true;
      });
      await vi.advanceTimersByTimeAsync(VARIANT_GRACE_MS + 1);
      expect(finished).toBe(false);
      expect(start).toHaveBeenCalledTimes(1);
      expect(retry).toBeUndefined();
      expect(forwarded).toBe(activity);
      const running = parts.filter((part) => part.type === 'build');
      expect(running.at(-1)).toMatchObject({ status: 'running' });
      expect(running.some((part) => part.status === 'done' || part.status === 'cancelled')).toBe(
        false,
      );
      dense.resolve({ variant: 'dense', runId: 'dense', state: 'done' });
      airy.resolve({ variant: 'airy', runId: 'airy', state: 'done' });
      await expect(pending).resolves.toMatchObject({ output: { status: 'done' } });
      expect(parts.filter((part) => part.type === 'build').at(-1)).toMatchObject({
        status: 'done',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
