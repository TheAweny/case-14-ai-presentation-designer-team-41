import { describe, expect, it, vi } from 'vitest';
import type { ChatToolActivity } from '@lct/contracts';
import { activityDetail, withToolActivity } from './tool-activity.js';

describe('independent tool telemetry boundary', () => {
  it('publishes exactly one cancellation when the operation resolves after being cancelled', async () => {
    const events: ChatToolActivity[] = [];
    const controller = new AbortController();
    const context = {
      callId: 'call',
      signal: controller.signal,
      show: vi.fn(() => 0),
      update: vi.fn(),
      activity: (event: ChatToolActivity) => events.push(event),
    };
    await expect(
      withToolActivity(context, { kind: 'agent', name: 'web-researcher' }, async () => {
        controller.abort(new Error('stopped'));
        return 'late result';
      }),
    ).rejects.toThrow('stopped');
    expect(events.map((event) => event.status)).toEqual(['running', 'cancelled']);
    expect(events[0]?.id).toBe(events[1]?.id);
  });

  it('does not copy raw provider errors or credentials to an activity', async () => {
    const events: ChatToolActivity[] = [];
    const context = {
      callId: 'call',
      signal: new AbortController().signal,
      show: vi.fn(() => 0),
      update: vi.fn(),
      activity: (event: ChatToolActivity) => events.push(event),
    };
    await expect(
      withToolActivity(context, { kind: 'agent', name: 'web-researcher' }, async () => {
        throw new Error(
          'Authorization Bearer PRIVATE_KEY https://user:PRIVATE_PASS@example.org?token=PRIVATE_TOKEN',
        );
      }),
    ).rejects.toThrow('PRIVATE_KEY');
    expect(events[1]?.status).toBe('failed');
    expect(JSON.stringify(events)).not.toContain('PRIVATE_');
    expect(
      activityDetail(
        'https://user:PRIVATE_PASS@example.org/page?token=PRIVATE_TOKEN#PRIVATE_HASH',
        'url',
      ),
    ).toBe('https://example.org/page');
  });

  it('a faulty activity listener does not fail the successful tool', async () => {
    const context = {
      callId: 'call',
      signal: new AbortController().signal,
      show: vi.fn(() => 0),
      update: vi.fn(),
      activity: () => {
        throw new Error('listener');
      },
    };
    await expect(
      withToolActivity(context, { kind: 'tool', name: 'fetch_source' }, async () => 42),
    ).resolves.toBe(42);
  });
});
