import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { runBuild, type ChatToolScope } from './chat-tools.js';

function fixture(abortDuringStart = false) {
  const controller = new AbortController();
  const variants = [
    { variant: 'dense' as const, runId: 'dense' },
    { variant: 'balanced' as const, runId: 'balanced' },
    { variant: 'airy' as const, runId: 'airy' },
  ];
  const generation = {
    template: async () => ({ file_name: 'Template', profile: null }),
    prepare: async () => undefined,
    start: async () => {
      if (abortDuringStart) controller.abort();
      return {
        runId: 'balanced',
        variants,
        each: variants.map((variant) => Promise.resolve({ ...variant, state: 'failed' as const })),
      };
    },
    cancel: vi.fn(),
    interrupt: vi.fn(),
  } as unknown as GenerationService;
  const messages: ChatMessage[] = [
    {
      role: 'user',
      id: crypto.randomUUID(),
      text: 'Подготовь пилот',
      attachments: [],
      mode: 'plan',
      createdAt: 1,
    },
  ];
  let writes = 0;
  const scope: ChatToolScope = {
    account: { id: 'owner' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'plan',
    model: null,
    messages: () => messages,
    updatePart: () => undefined,
    addDecks: () => undefined,
    persist: async () => {
      if (!abortDuringStart && ++writes === 3) throw new Error('Persistence failed after start');
    },
  };
  const context: ToolContext = {
    callId: 'build',
    signal: controller.signal,
    show: () => 0,
    update: () => undefined,
  };
  return { generation, scope, context };
}

describe('build cancellation at persistence boundaries', () => {
  it('interrupts all variants without recording user Stop when saving the started operation fails', async () => {
    const f = fixture();
    await expect(
      runBuild(f.generation, f.scope, f.context, {
        templateId: crypto.randomUUID(),
        outline: null,
        brief: '',
        fileIds: [],
      }),
    ).rejects.toThrow(/Persistence failed/);
    expect(f.generation.interrupt).toHaveBeenCalledWith('balanced');
    expect(f.generation.cancel).not.toHaveBeenCalled();
  });

  it('cancels a build if the turn was stopped while generation.start was pending', async () => {
    const f = fixture(true);
    await expect(
      runBuild(f.generation, f.scope, f.context, {
        templateId: crypto.randomUUID(),
        outline: null,
        brief: '',
        fileIds: [],
      }),
    ).rejects.toThrow();
    expect(f.generation.cancel).toHaveBeenCalledWith('balanced');
  });
});
