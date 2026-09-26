import { describe, expect, it } from 'vitest';
import type { AuditIssue } from '@lct/slide-audit';
import { DEMO_DECK } from '../../../mocks/demo-deck';
import { countBySlide, countIssues, fixCommits, isDeckWide, sortIssues } from './deck-audit';

function issue(fields: Partial<AuditIssue>): AuditIssue {
  return {
    issueId: fields.issueId ?? 'id',
    checkId: 'element-overlap',
    kind: 'content',
    level: 'error',
    slideId: 's1',
    elementId: 'e1',
    relatedIds: [],
    box: { x: 0, y: 0, cx: 10, cy: 10 },
    params: {},
    fixability: 'manual',
    fix: null,
    ...fields,
  };
}

describe('audit counts', () => {
  it('counts errors and warnings, per slide without deck-wide issues', () => {
    const issues = [
      issue({ issueId: 'a' }),
      issue({ issueId: 'b', level: 'warning' }),
      issue({ issueId: 'c', slideId: 's2' }),
      issue({ issueId: 'font', checkId: 'font-unavailable', kind: 'missing', level: 'warning' }),
    ];
    expect(countIssues(issues)).toEqual({ errors: 2, warnings: 2 });
    expect(countBySlide(issues)).toEqual(
      new Map([
        ['s1', { errors: 1, warnings: 1 }],
        ['s2', { errors: 1, warnings: 0 }],
      ]),
    );
    expect(issues.filter(isDeckWide).map((found) => found.issueId)).toEqual(['font']);
  });
});

describe('sortIssues', () => {
  it('orders by slide, then errors first, then top to bottom', () => {
    const sorted = sortIssues(
      [
        issue({ issueId: 'late', slideId: 's2' }),
        issue({ issueId: 'low', box: { x: 0, y: 50, cx: 1, cy: 1 } }),
        issue({ issueId: 'warn', level: 'warning', box: { x: 0, y: 0, cx: 1, cy: 1 } }),
        issue({ issueId: 'high', box: { x: 0, y: 5, cx: 1, cy: 1 } }),
      ],
      [{ slideId: 's1' }, { slideId: 's2' }],
    );
    expect(sorted.map((found) => found.issueId)).toEqual(['high', 'low', 'warn', 'late']);
  });
});

describe('fixCommits', () => {
  const deck = DEMO_DECK;
  const slide = deck.slides[0];
  const element = slide?.elements.find((candidate) => candidate.kind === 'text');

  it('turns a move into one commit that moves the element', () => {
    if (!slide || !element) throw new Error('the demo deck has no text');
    const box = { ...element.box, x: element.box.x + 12_700 };
    const commits = fixCommits(
      issue({ slideId: slide.slideId, fix: [{ op: 'move', elementId: element.elementId, box }] }),
      deck.designSystem,
    );
    expect(commits).toHaveLength(1);
    const next = commits?.[0]?.(deck.slides);
    const moved = next?.slides[0]?.elements.find((e) => e.elementId === element.elementId);
    expect(moved?.box).toEqual(box);
  });

  it('refuses an issue without a fix, or with an op the editor cannot apply', () => {
    expect(fixCommits(issue({}), deck.designSystem)).toBeNull();
    expect(
      fixCommits(issue({ fix: [{ op: 'repattern', patternId: 'other' }] }), deck.designSystem),
    ).toBeNull();
  });
});
