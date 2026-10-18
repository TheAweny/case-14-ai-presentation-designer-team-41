import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ChatToolDispatcher, loadChatAgent, toolSpecs, type ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import type { GenerationService } from '../generation/generation.service.js';
import { chatTools, type ChatToolScope } from './chat-tools.js';

const BUILD = '00000000-0000-4000-8000-000000000001';
const RUN = 'run-00000000-0000-4000-8000-000000000002';
async function harness(buildAttached: boolean) {
  const get = vi.fn(async () => ({ state: 'running' }));
  const visible = vi.fn(async () => true);
  const start = vi.fn();
  const scope: ChatToolScope = {
    account: { id: 'owner' } as Account,
    chatId: 'chat',
    projectId: null,
    model: null,
    mode: 'chat',
    messages: () =>
      buildAttached
        ? [
            {
              role: 'assistant',
              id: 'assistant',
              status: 'streaming',
              createdAt: 1,
              parts: [
                {
                  type: 'build',
                  callId: 'build',
                  buildId: BUILD,
                  planId: null,
                  planRevision: null,
                  templateId: BUILD,
                  templateName: 'Template',
                  runId: RUN,
                  variantRunIds: [RUN],
                  startedAt: 1,
                  finishedAt: null,
                  status: 'running',
                  error: null,
                },
              ],
            },
          ]
        : [],
    updatePart: vi.fn(),
    addDecks: vi.fn(),
  };
  const tools = chatTools(
    {
      repository: { get },
      library: { visible },
      start,
      isRunning: () => true,
    } as unknown as GenerationService,
    scope,
    undefined,
    { search: null, fetchSource: vi.fn() },
  );
  expect(tools.map((tool) => tool.name)).toEqual(
    expect.arrayContaining([
      'preview_slide',
      'check_slide_fit',
      'check_content_coverage',
      'read_build_status',
    ]),
  );
  const agent = await loadChatAgent(join(import.meta.dirname, '../../../../registry/agents'));
  const dispatcher = new ChatToolDispatcher({
    tools,
    specs: toolSpecs(agent, tools),
    mode: 'chat',
  });
  const context: ToolContext = {
    callId: 'acceptance',
    signal: new AbortController().signal,
    show: vi.fn(() => 0),
    update: vi.fn(),
  };
  return { dispatcher, context, get, visible, start };
}

describe('independent saved deck inspection authorization through chat', () => {
  it('refuses a deck or build from another chat before consulting owner or repository', async () => {
    const { dispatcher, context, get, visible, start } = await harness(false);
    for (const name of ['preview_slide', 'check_slide_fit', 'check_content_coverage']) {
      expect(
        (await dispatcher.dispatch(name, JSON.stringify({ deckId: RUN, slideIndex: 1 }), context))
          .failed,
      ).toBe(true);
    }
    expect(
      (await dispatcher.dispatch('read_build_status', JSON.stringify({ buildId: BUILD }), context))
        .failed,
    ).toBe(true);
    expect(get).not.toHaveBeenCalled();
    expect(visible).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('reads a running build referenced by its build card without requiring a finished result or starting it again', async () => {
    const { dispatcher, context, get, visible, start } = await harness(true);
    const result = await dispatcher.dispatch(
      'read_build_status',
      JSON.stringify({ buildId: BUILD }),
      context,
    );
    expect(result.failed).not.toBe(true);
    expect(result.output).toMatchObject({
      buildId: BUILD,
      status: 'running',
      variants: [{ runId: RUN, state: 'running', running: true }],
    });
    expect(visible).toHaveBeenCalledWith(RUN, 'owner');
    expect(get).toHaveBeenCalledWith(RUN);
    expect(start).not.toHaveBeenCalled();
  });
});
