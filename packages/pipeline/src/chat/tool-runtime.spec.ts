import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ChatTool, ToolContext } from './agent.js';
import { ChatToolDispatcher } from './tool-runtime.js';

function setup(mode: 'chat' | 'plan' | 'auto' = 'auto', offered = true) {
  const control = new AbortController();
  const run = vi.fn(async () => ({ output: { saved: true } }));
  const tool: ChatTool = {
    name: 'save',
    modes: ['auto'],
    input: z.object({ title: z.string() }),
    run,
  };
  const dispatcher = new ChatToolDispatcher({
    tools: [tool],
    specs: offered ? [{ name: 'save', description: 'Save.', parameters: {} }] : [],
    mode,
  });
  const context: ToolContext = {
    signal: control.signal,
    callId: 'c1',
    show: () => 0,
    update: () => undefined,
  };
  return { dispatcher, run, control, context };
}

describe('ChatToolDispatcher', () => {
  it('runs only an offered tool with valid arguments in its allowed mode', async () => {
    const { dispatcher, run, context } = setup();
    expect(await dispatcher.dispatch('save', '{"title":"Отчёт"}', context)).toEqual({
      output: { saved: true },
    });
    expect(run).toHaveBeenCalledWith({ title: 'Отчёт' }, context);
  });

  it.each(['chat', 'plan'] as const)(
    'rejects a tool forbidden in %s mode at the action boundary',
    async (mode) => {
      const { dispatcher, run, context } = setup(mode);
      expect(await dispatcher.dispatch('save', '{"title":"Отчёт"}', context)).toMatchObject({
        failed: true,
      });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('rejects a known tool that was not offered to this model step', async () => {
    const { dispatcher, run, context } = setup('auto', false);
    expect(await dispatcher.dispatch('save', '{"title":"Отчёт"}', context)).toMatchObject({
      failed: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(['{broken', '{"title":4}'])(
    'rejects invalid input before the side effect: %s',
    async (input) => {
      const { dispatcher, run, context } = setup();
      expect(await dispatcher.dispatch('save', input, context)).toMatchObject({ failed: true });
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('never runs a tool after cancellation', async () => {
    const { dispatcher, run, control, context } = setup();
    control.abort();
    await expect(dispatcher.dispatch('save', '{"title":"Отчёт"}', context)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('does not report success when the tool finishes after cancellation', async () => {
    const { dispatcher, run, control, context } = setup();
    run.mockImplementationOnce(async () => {
      control.abort();
      return { output: { saved: true } };
    });
    await expect(dispatcher.dispatch('save', '{"title":"Отчёт"}', context)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
