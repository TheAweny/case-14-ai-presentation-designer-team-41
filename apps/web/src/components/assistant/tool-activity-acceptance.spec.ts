import { describe, expect, it } from 'vitest';
import type { ChatToolActivity } from '@lct/contracts';
import {
  activeAgentCount,
  groupState,
  toolChip,
  toolLineVisible,
  type ToolPart,
} from './tool-activity';

const activity: ChatToolActivity = {
  id: 'researcher',
  kind: 'agent',
  name: 'web-researcher',
  status: 'running',
  startedAt: 10,
};
const part: ToolPart = {
  type: 'tool',
  callId: 'call',
  name: 'research_topic',
  input: { question: 'Check a new model' },
  status: 'running',
  startedAt: 10,
  activities: [activity],
};

describe('independent tool presentation acceptance', () => {
  it('counts actual agent jobs only while their parent and message remain open', () => {
    expect(activeAgentCount([part], 'streaming')).toBe(1);
    expect(activeAgentCount([{ ...part, status: 'done', finishedAt: 20 }], 'streaming')).toBe(0);
    expect(activeAgentCount([part], 'cancelled')).toBe(0);
    expect(
      activeAgentCount([{ ...part, activities: [{ ...activity, kind: 'tool' }] }], 'streaming'),
    ).toBe(0);
  });

  it('retains an error before a card exists and surfaces a nested page failure in the summary', () => {
    expect(
      toolLineVisible({ ...part, name: 'build_deck', status: 'failed' }, new Set(), 'failed'),
    ).toBe(true);
    const view = toolChip(
      {
        ...part,
        status: 'done',
        activities: [
          {
            ...activity,
            kind: 'tool',
            name: 'fetch_source',
            status: 'failed',
            error: 'operation_failed',
            finishedAt: 20,
          },
        ],
      },
      'done',
    );
    expect(view.state).toBe('done');
    expect(groupState([view])).toBe('failed');
  });

  it('does not leak URL credentials through nested string details or raw unknown input', () => {
    const view = toolChip(
      {
        ...part,
        activities: [
          {
            ...activity,
            name: 'fetch_source',
            kind: 'tool',
            detail: 'https://alice:PRIVATE_PASSWORD@example.org/page?token=PRIVATE_TOKEN',
          },
        ],
      },
      'streaming',
    );
    expect(JSON.stringify(view)).not.toContain('PRIVATE_');
    const unknown = toolChip(
      { ...part, name: 'unknown_tool', input: 'PRIVATE_RAW_INPUT', activities: [] },
      'streaming',
    );
    expect(unknown.detail).toBeNull();
    expect(unknown.fullDetail).toBeNull();
  });

  it('does not discard a cyclic saved activity graph entirely', () => {
    const view = toolChip(
      {
        ...part,
        activities: [
          { ...activity, id: 'a', parentId: 'b' },
          { ...activity, id: 'b', parentId: 'a' },
        ],
      },
      'streaming',
    );
    expect(view.activities.length).toBeGreaterThan(0);
    expect(JSON.stringify(view).length).toBeLessThan(10000);
  });
});
