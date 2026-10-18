import { describe, expect, it } from 'vitest';
import { chatPartSchema, chatToolActivitySchema } from './chat.js';

describe('chat tool activity', () => {
  it('accepts a tool part stored before lifecycle metadata existed', () => {
    expect(
      chatPartSchema.parse({
        type: 'tool',
        callId: 'legacy',
        name: 'build_deck',
        input: { planId: 'old' },
        status: 'done',
        output: { ok: true },
      }),
    ).toEqual({
      type: 'tool',
      callId: 'legacy',
      name: 'build_deck',
      input: { planId: 'old' },
      status: 'done',
      output: { ok: true },
    });
  });

  it('keeps nested steps and rejects a thirty-third one', () => {
    const activity = {
      id: 'child',
      kind: 'agent',
      name: 'research',
      detail: 'https://example.test/source',
      status: 'cancelled',
      startedAt: 1,
      finishedAt: 2,
    };
    expect(chatToolActivitySchema.parse(activity)).toEqual(activity);
    const parsed = chatPartSchema.parse({
      type: 'tool',
      callId: 'call',
      name: 'research',
      input: null,
      status: 'failed',
      phase: 'preparing',
      startedAt: 1,
      finishedAt: 3,
      activities: [activity],
    });
    expect(parsed).toMatchObject({ phase: 'preparing', activities: [activity] });
    expect(
      chatPartSchema.safeParse({
        type: 'tool',
        callId: 'call',
        name: 'research',
        input: null,
        status: 'running',
        activities: Array.from({ length: 33 }, (_, index) => ({
          id: `step-${index}`,
          kind: 'tool',
          name: 'slide',
          status: 'done',
          startedAt: index,
        })),
      }).success,
    ).toBe(false);
  });
});
