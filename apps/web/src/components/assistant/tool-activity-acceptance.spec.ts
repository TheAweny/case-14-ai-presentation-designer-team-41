import { describe, expect, it } from 'vitest';
import type { ChatToolActivity } from '@lct/contracts';
import {
  activeAgentCount,
  groupState,
  groupGlyphState,
  toolChip,
  toolGroupHeadline,
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
  it('prefers a recognised web failure over raw provider text and keeps nested codes', () => {
    const direct = toolChip(
      {
        ...part,
        name: 'fetch_source',
        status: 'failed',
        output: { code: 'web_http_403', error: 'PRIVATE_PROVIDER_BODY' },
      },
      'done',
    );
    expect(direct.error).toBe('web_http_403');
    expect(JSON.stringify(direct)).not.toContain('PRIVATE_PROVIDER_BODY');
    const nested = toolChip(
      {
        ...part,
        status: 'done',
        activities: [
          {
            ...activity,
            status: 'failed',
            error: 'web_http_401',
            finishedAt: 20,
          },
        ],
      },
      'done',
    );
    expect(nested.activities[0]?.error).toBe('web_http_401');
  });

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
    expect(
      groupGlyphState(
        [
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
        ],
        'done',
      ),
    ).toBe('partial');
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

const fetchFailure: ChatToolActivity = {
  id: 'page',
  kind: 'tool',
  name: 'fetch_source',
  detail: 'https://example.org/roadster',
  status: 'failed',
  startedAt: 12,
  finishedAt: 20,
  error: 'web_http_403',
};
const agentFailure: ChatToolActivity = {
  id: 'researcher',
  kind: 'agent',
  name: 'web-researcher',
  status: 'failed',
  startedAt: 20,
  finishedAt: 30,
  error: 'operation_failed',
};

function research(status: ToolPart['status'], activities: ChatToolActivity[]): ToolPart {
  return {
    ...part,
    status,
    ...(status === 'failed' ? { output: { error: 'operation_failed' }, finishedAt: 30 } : {}),
    activities,
  };
}

describe('finished tool errors stay separate from an interrupted turn', () => {
  it('counts a failed research root once when it only repeats the nested agent, plus the HTTP fetch', () => {
    expect(toolGroupHeadline([research('failed', [fetchFailure, agentFailure])], 'done')).toEqual({
      kind: 'completedWithErrors',
      count: 2,
    });
    expect(
      toolGroupHeadline(
        [research('failed', [{ ...agentFailure, error: 'operation_failed' }])],
        'streaming',
      ),
    ).toEqual({ kind: 'completedWithErrors', count: 1 });
  });

  it('keeps a lone HTTP failure as one finished error while the answer continues', () => {
    const fetch: ToolPart = {
      ...part,
      callId: 'fetch',
      name: 'fetch_source',
      status: 'failed',
      finishedAt: 20,
      output: { code: 'web_http_403', error: 'PRIVATE_PROVIDER_BODY' },
      activities: [],
    };
    expect(toolGroupHeadline([fetch], 'done')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
    expect(toolGroupHeadline([fetch], 'failed')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
    expect(toolGroupHeadline([fetch], 'cancelled')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
    expect(JSON.stringify(toolChip(fetch, 'done'))).not.toContain('PRIVATE_PROVIDER_BODY');
  });

  it('reads a sealed cutoff on a cancelled answer as cancellation, not a tool error', () => {
    for (const error of ['Interrupted.', 'The call was cut off.']) {
      const sealed: ToolPart = {
        ...part,
        status: 'failed',
        finishedAt: 40,
        output: { error },
        activities: [
          {
            id: 'page',
            kind: 'tool',
            name: 'fetch_source',
            status: 'cancelled',
            startedAt: 12,
            finishedAt: 40,
          },
        ],
      };
      expect(toolGroupHeadline([sealed], 'cancelled')).toEqual({ kind: 'cancelled' });
    }
    const unrelated: ToolPart = {
      ...part,
      status: 'failed',
      output: { error: 'Interrupted' },
      activities: [],
    };
    expect(toolGroupHeadline([unrelated], 'cancelled')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
  });

  it('reads a sealed cutoff on a failed answer as an interruption, not a tool error', () => {
    for (const error of ['Interrupted.', 'The call was cut off.']) {
      const sealed: ToolPart = {
        ...part,
        status: 'failed',
        finishedAt: 40,
        output: { error },
        activities: [
          {
            id: 'page',
            kind: 'tool',
            name: 'fetch_source',
            status: 'failed',
            startedAt: 12,
            finishedAt: 40,
          },
        ],
      };
      expect(toolGroupHeadline([sealed], 'failed')).toEqual({ kind: 'interrupted' });
    }
    const http: ToolPart = {
      ...part,
      callId: 'fetch',
      name: 'fetch_source',
      status: 'failed',
      output: { error: 'web_http_403' },
      activities: [],
    };
    const sealed: ToolPart = {
      ...part,
      callId: 'cut',
      status: 'failed',
      output: { error: 'Interrupted.' },
      activities: [],
    };
    expect(toolGroupHeadline([http, sealed], 'failed')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
    expect(toolGroupHeadline([http, sealed], 'cancelled')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
  });

  it('does not count a root twice when its error text is already on a nested step', () => {
    const echoed: ToolPart = {
      ...part,
      name: 'fetch_source',
      status: 'failed',
      output: { error: 'web_http_403' },
      activities: [fetchFailure],
    };
    expect(toolGroupHeadline([echoed], 'done')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
  });

  it('still counts a web error that the failed agent does not already carry', () => {
    const distinct = research('failed', [agentFailure]);
    distinct.output = { error: 'web_http_403' };
    expect(toolGroupHeadline([distinct], 'done')).toEqual({
      kind: 'completedWithErrors',
      count: 2,
    });
  });

  it('sums terminal failures in one finished group and leaves a clean group completed', () => {
    const second: ToolPart = {
      ...part,
      callId: 'calc',
      name: 'calculate',
      status: 'failed',
      output: { error: 'The expression was rejected' },
      activities: [],
    };
    expect(
      toolGroupHeadline([research('failed', [fetchFailure, agentFailure]), second], 'done'),
    ).toEqual({ kind: 'completedWithErrors', count: 3 });
    expect(toolGroupHeadline([{ ...part, status: 'done', activities: [] }], 'done')).toEqual({
      kind: 'completed',
    });
  });

  it('calls an unfinished tool on a failed answer an interruption, not an HTTP failure', () => {
    expect(toolGroupHeadline([research('running', [fetchFailure])], 'failed')).toEqual({
      kind: 'interrupted',
    });
    expect(
      toolGroupHeadline([research('running', [fetchFailure, agentFailure])], 'failed'),
    ).toEqual({ kind: 'interrupted' });
  });

  it('keeps cancellation on its own outcome, including beside an already failed nested step', () => {
    expect(toolGroupHeadline([research('running', [fetchFailure])], 'cancelled')).toEqual({
      kind: 'cancelled',
    });
    expect(toolGroupHeadline([research('running', [])], 'done')).toEqual({ kind: 'cancelled' });
  });

  it('lets a still running call win over a finished sibling failure', () => {
    const live: ToolPart = {
      ...part,
      callId: 'search',
      name: 'search_web',
      status: 'running',
      activities: [],
    };
    expect(
      toolGroupHeadline([research('failed', [fetchFailure, agentFailure]), live], 'streaming'),
    ).toEqual({ kind: 'running' });
  });

  it('keeps an unsealed running call on a failed answer out of partial', () => {
    const doneFetch: ToolPart = {
      ...part,
      callId: 'fetch',
      name: 'fetch_source',
      status: 'done',
      finishedAt: 20,
      activities: [],
    };
    expect(groupGlyphState([doneFetch, research('running', [])], 'failed')).toBe('failed');
    expect(toolGroupHeadline([doneFetch, research('running', [])], 'failed')).toEqual({
      kind: 'interrupted',
    });
  });
});

describe('group glyph partial success', () => {
  const doneSearch = (): ToolPart => ({
    ...part,
    callId: 'search-ok',
    name: 'search_web',
    status: 'done',
    finishedAt: 20,
    activities: [],
  });
  const failedSearch = (): ToolPart => ({
    ...part,
    callId: 'search-bad',
    name: 'search_web',
    status: 'failed',
    finishedAt: 20,
    output: { error: 'web_http_403' },
    activities: [],
  });

  it('stays red when every settled call failed', () => {
    expect(groupGlyphState([failedSearch(), research('failed', [fetchFailure])], 'done')).toBe(
      'failed',
    );
  });

  it('uses partial for a mix of settled success and failure', () => {
    expect(groupGlyphState([doneSearch(), failedSearch()], 'done')).toBe('partial');
    expect(toolGroupHeadline([doneSearch(), failedSearch()], 'done')).toEqual({
      kind: 'completedWithErrors',
      count: 1,
    });
  });

  it('uses partial when a done root still has a failed descendant', () => {
    expect(groupGlyphState([research('done', [fetchFailure])], 'done')).toBe('partial');
  });

  it('uses partial when a done root skipped a nested step', () => {
    const skipped: ChatToolActivity = {
      id: 'page-skip',
      kind: 'tool',
      name: 'fetch_source',
      status: 'cancelled',
      startedAt: 12,
      finishedAt: 20,
    };
    expect(groupGlyphState([research('done', [skipped])], 'done')).toBe('partial');
    expect(groupGlyphState([failedSearch()], 'done')).toBe('failed');
    expect(groupGlyphState([doneSearch(), failedSearch()], 'done')).toBe('partial');
    expect(groupGlyphState([research('running', [])], 'cancelled')).toBe('cancelled');
  });

  it('stays running while a call is open', () => {
    expect(groupGlyphState([doneSearch(), { ...part, status: 'running' }], 'streaming')).toBe(
      'running',
    );
  });

  it('does not turn a cancelled turn into partial', () => {
    const open: ToolPart = { ...part, callId: 'cut', status: 'running', activities: [] };
    expect(groupGlyphState([doneSearch(), failedSearch(), open], 'cancelled')).toBe('cancelled');
    expect(groupGlyphState([doneSearch(), open], 'cancelled')).toBe('cancelled');
    expect(groupGlyphState([research('running', [])], 'cancelled')).toBe('cancelled');
    expect(groupGlyphState([doneSearch(), failedSearch(), open], 'failed')).toBe('failed');
    const sealed: ToolPart = {
      ...part,
      callId: 'sealed',
      status: 'failed',
      finishedAt: 40,
      output: { error: 'Interrupted.' },
      activities: [],
    };
    expect(groupGlyphState([doneSearch(), sealed], 'cancelled')).toBe('cancelled');
    expect(groupGlyphState([doneSearch(), failedSearch(), sealed], 'cancelled')).toBe('cancelled');
    expect(groupGlyphState([doneSearch(), sealed], 'failed')).toBe('failed');
    expect(groupGlyphState([doneSearch(), failedSearch(), sealed], 'failed')).toBe('failed');
  });
});
