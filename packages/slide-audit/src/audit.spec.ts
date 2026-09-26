import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import type { AuditContext, AuditIssue } from './types.js';
import { auditDeck, auditSlide } from './audit.js';
import { CHECKS, CHECK_IDS } from './checks.js';
import { toAuditFinding } from './finding.js';
import { DEFAULT_AUDIT_PROFILE } from './profile.js';
import { box, designSystem, image, pt, shape, slide, text } from './__fixtures__/deck.js';
import { auditFindingSchema, type SlideIr } from '@lct/contracts';

const context: AuditContext = { designSystem: designSystem() };

/** The slide after the moves a fix proposes, as the editor applies them. */
function applyFix(target: SlideIr, found: AuditIssue | undefined): SlideIr {
  const moves = new Map(
    (found?.fix ?? []).flatMap((op) => (op.op === 'move' ? [[op.elementId, op.box] as const] : [])),
  );
  return {
    ...target,
    elements: target.elements.map((element) => {
      const moved = moves.get(element.elementId);
      return moved ? { ...element, box: moved } : element;
    }),
  };
}

const errorsOf = (issues: readonly AuditIssue[]) =>
  issues.filter((found) => found.level === 'error');

function ofCheck(issues: readonly AuditIssue[], checkId: string): AuditIssue[] {
  return issues.filter((found) => found.checkId === checkId);
}

describe('text-overflow', () => {
  it('flags text measured taller than its box', () => {
    const issues = auditSlide(slide([text('t', box(60, 60, 400, 40), 'Words')]), {
      ...context,
      textHeight: () => pt(70),
    });
    const [found] = ofCheck(issues, 'text-overflow');
    expect(found).toMatchObject({ level: 'error', elementId: 't', params: { overflowPt: 30 } });
  });

  it('passes text that fits, and falls back on the overflow the layout recorded', () => {
    const fits = auditSlide(slide([text('t', box(60, 60, 400, 40), 'Words')]), {
      ...context,
      textHeight: () => pt(38),
    });
    expect(ofCheck(fits, 'text-overflow')).toEqual([]);

    // A line box of 32 pt type 4 pt past the frame is leading under the last line, not letters.
    const leading = auditSlide(slide([text('t', box(60, 60, 400, 72), 'Title', { sizePt: 32 })]), {
      ...context,
      textHeight: () => pt(76),
    });
    expect(ofCheck(leading, 'text-overflow')).toEqual([]);

    const recorded = {
      ...text('t', box(60, 60, 400, 40), 'Words'),
      overflow: { lines: 1, emu: pt(20) },
    };
    expect(ofCheck(auditSlide(slide([recorded]), context), 'text-overflow')).toHaveLength(1);
  });
});

describe('element-overlap', () => {
  it('flags two text boxes on top of each other', () => {
    const issues = auditSlide(
      slide([text('a', box(60, 60, 400, 100), 'One'), text('b', box(200, 100, 400, 100), 'Two')]),
      context,
    );
    const [found] = ofCheck(issues, 'element-overlap');
    expect(found).toMatchObject({
      kind: 'content',
      level: 'error',
      elementId: 'b',
      relatedIds: ['a'],
    });
  });

  it('flags a filled shape painted over text', () => {
    const issues = auditSlide(
      slide([
        text('a', box(60, 60, 400, 100), 'One'),
        shape('card', box(60, 60, 200, 100), 'surface'),
      ]),
      context,
    );
    expect(ofCheck(issues, 'element-overlap')).toMatchObject([
      { kind: 'covered', elementId: 'card' },
    ]);
  });

  it('flags a caption hanging off the edge of a picture', () => {
    const issues = auditSlide(
      slide([
        image('photo', box(60, 60, 400, 300)),
        text('cap', box(300, 300, 300, 40), 'Caption'),
      ]),
      context,
    );
    expect(ofCheck(issues, 'element-overlap')).toMatchObject([{ kind: 'picture-edge' }]);
  });

  it('passes a caption wholly on a picture, a panel under text and grouped elements', () => {
    const onPicture = slide([
      image('photo', box(60, 60, 400, 300)),
      text('cap', box(80, 300, 300, 40), 'Caption'),
    ]);
    const onPanel = slide([
      shape('panel', box(40, 40, 500, 200), 'surface'),
      text('a', box(60, 60, 400, 100), 'One'),
    ]);
    const grouped = slide([
      { ...text('a', box(60, 60, 400, 100), 'One'), groupIds: ['g'] },
      { ...text('b', box(200, 100, 400, 100), 'Two'), groupIds: ['g'] },
    ]);
    for (const clean of [onPicture, onPanel, grouped]) {
      expect(ofCheck(auditSlide(clean, context), 'element-overlap')).toEqual([]);
    }
  });

  it('judges text by the height of its words when they were measured', () => {
    // The boxes overlap, but the words of the upper one take only its top 30 pt.
    const boxes = slide([
      text('a', box(60, 60, 400, 200), 'One'),
      text('b', box(60, 150, 400, 100), 'Two'),
    ]);
    const measured = { ...context, textHeight: () => pt(30) };
    expect(ofCheck(auditSlide(boxes, measured), 'element-overlap')).toEqual([]);
    expect(ofCheck(auditSlide(boxes, context), 'element-overlap')).toHaveLength(1);
  });

  it('respects rotation: a turned box that clears its neighbour is not an overlap', () => {
    // A tall thin box beside a wide one: upright they meet, turned 90° it clears.
    const tall = { ...text('a', box(200, 60, 40, 300), 'One'), rotation: 90 };
    const wide = text('b', box(60, 60, 400, 40), 'Two');
    expect(ofCheck(auditSlide(slide([tall, wide]), context), 'element-overlap')).toEqual([]);
  });

  it('leaves alone an overlap the template layout has itself', () => {
    const a = { ...text('a', box(60, 60, 400, 100), 'One'), sourceShapeId: 2 };
    const b = { ...text('b', box(200, 100, 400, 100), 'Two'), sourceShapeId: 3 };
    const layout = slide([a, b], { slideId: 'layout' });
    const issues = auditSlide(slide([a, b]), { ...context, layoutFor: () => layout });
    expect(ofCheck(issues, 'element-overlap')).toEqual([]);
  });
});

describe('off-slide', () => {
  it('flags text crossing the slide edge and offers to move it back within the margins', () => {
    const issues = auditSlide(slide([text('t', box(800, 100, 300, 40), 'Words')]), context);
    const [found] = ofCheck(issues, 'off-slide');
    expect(found).toMatchObject({ kind: 'edge', level: 'error', fixability: 'auto' });
    // Back inside the template margins, not merely inside the edge: 960 − 48 − 300.
    expect(found?.fix).toEqual([{ op: 'move', elementId: 't', box: box(612, 100, 300, 40) }]);
  });

  it('flags anything lying wholly off the slide, and passes a full-bleed picture', () => {
    const gone = auditSlide(slide([image('photo', box(1000, 100, 200, 100))]), context);
    expect(ofCheck(gone, 'off-slide')).toMatchObject([{ kind: 'outside', level: 'warning' }]);

    const bleed = auditSlide(slide([image('photo', box(-20, -20, 1000, 580))]), context);
    expect(ofCheck(bleed, 'off-slide')).toEqual([]);
  });
});

describe('safe-margins', () => {
  it('warns about content past the template margins', () => {
    const issues = auditSlide(slide([text('t', box(10, 100, 300, 40), 'Words')]), context);
    expect(ofCheck(issues, 'safe-margins')).toMatchObject([
      {
        level: 'warning',
        params: { pastPt: 38 },
        fix: [{ op: 'move', box: box(48, 100, 300, 40) }],
      },
    ]);
  });

  it('passes content inside the margins and footers at the edge', () => {
    const issues = auditSlide(
      slide([
        text('t', box(48, 36, 400, 40), 'Words'),
        text('f', box(10, 520, 200, 16), 'Footer', { role: 'footer' }),
      ]),
      context,
    );
    expect(ofCheck(issues, 'safe-margins')).toEqual([]);
  });
});

describe('fixes', () => {
  it('bring an element back on the slide past a neighbour, not onto it', () => {
    // The nearest place inside the margins is taken by the neighbour.
    const broken = slide([
      text('neighbour', box(560, 90, 352, 60), 'Taken'),
      text('t', box(800, 100, 300, 40), 'Words'),
    ]);
    const [found] = ofCheck(auditSlide(broken, context), 'off-slide');
    expect(found?.fixability).toBe('auto');
    const fixed = auditSlide(applyFix(broken, found), context);
    expect(errorsOf(fixed)).toEqual([]);
    expect(ofCheck(fixed, 'safe-margins')).toEqual([]);
  });

  it('move the upper of two overlapping elements aside', () => {
    const broken = slide([
      text('a', box(60, 60, 400, 100), 'One'),
      text('b', box(200, 100, 400, 100), 'Two'),
    ]);
    const [found] = ofCheck(auditSlide(broken, context), 'element-overlap');
    expect(found?.fix).toMatchObject([{ op: 'move', elementId: 'b' }]);
    expect(errorsOf(auditSlide(applyFix(broken, found), context))).toEqual([]);
  });

  it('offer nothing when no free place is left, instead of a half fix', () => {
    const full = slide([
      { ...text('t', box(800, 100, 300, 40), 'Words') },
      {
        kind: 'table',
        elementId: 'table',
        role: 'table',
        box: box(48, 36, 864, 468),
        sourceShapeId: null,
        headers: ['A'],
        rows: [['1']],
      },
    ]);
    const [found] = ofCheck(auditSlide(full, context), 'off-slide');
    expect(found).toMatchObject({ fix: null, fixability: 'manual' });
  });

  it('leave a shape over content to the author', () => {
    const covered = slide([
      text('a', box(60, 60, 400, 100), 'One'),
      shape('card', box(60, 60, 200, 100), 'surface'),
    ]);
    expect(ofCheck(auditSlide(covered, context), 'element-overlap')).toMatchObject([
      { kind: 'covered', fix: null, fixability: 'manual' },
    ]);
  });
});

describe('placeholder-text', () => {
  it('flags filler from the profile and empty text boxes', () => {
    const issues = auditSlide(
      slide([
        text('filler', box(60, 60, 400, 40), 'Some FILLER here'),
        text('empty', box(60, 200, 400, 40), '  '),
      ]),
      { ...context, profile: { forbiddenPatterns: ['filler'] } },
    );
    expect(ofCheck(issues, 'placeholder-text')).toMatchObject([
      { elementId: 'filler', kind: 'filler', level: 'error', params: { pattern: 'filler' } },
      {
        elementId: 'empty',
        kind: 'empty',
        level: 'warning',
        fix: [{ op: 'remove', elementId: 'empty' }],
      },
    ]);
  });

  it('passes finished text', () => {
    const issues = auditSlide(
      slide([text('t', box(60, 60, 400, 40), 'Quarterly results')]),
      context,
    );
    expect(ofCheck(issues, 'placeholder-text')).toEqual([]);
  });
});

describe('contrast', () => {
  it('flags light text on a light slide as an error and offers the text role', () => {
    const issues = auditSlide(
      slide([text('t', box(60, 60, 400, 40), 'Faint', { color: 'EEEEEE' })]),
      context,
    );
    expect(ofCheck(issues, 'contrast')).toMatchObject([
      { level: 'error', fix: [{ op: 'set-color', elementId: 't', colorRole: 'text' }] },
    ]);
  });

  it('warns about normal text between 3:1 and the profile threshold, but not large text', () => {
    // #808080 on white is about 3.9:1.
    const small = auditSlide(
      slide([text('t', box(60, 60, 400, 40), 'Grey', { color: '808080' })]),
      context,
    );
    expect(ofCheck(small, 'contrast')).toMatchObject([{ level: 'warning' }]);

    const large = auditSlide(
      slide([text('t', box(60, 60, 400, 60), 'Grey', { color: '808080', sizePt: 24 })]),
      context,
    );
    expect(ofCheck(large, 'contrast')).toEqual([]);
  });

  it('judges text against the filled shape under it, and skips text on a picture', () => {
    const onAccent = auditSlide(
      slide([
        shape('band', box(0, 0, 960, 200), 'accent'),
        text('t', box(60, 60, 400, 40), 'On blue', { color: '1A1A1A' }),
      ]),
      context,
    );
    expect(ofCheck(onAccent, 'contrast')).toMatchObject([
      { params: { background: '0055FF' }, fix: [{ colorRole: 'text-on-accent' }] },
    ]);

    const onPhoto = auditSlide(
      slide([
        image('photo', box(0, 0, 960, 540)),
        text('t', box(60, 60, 400, 40), 'Faint', { color: 'EEEEEE' }),
      ]),
      context,
    );
    expect(ofCheck(onPhoto, 'contrast')).toEqual([]);
  });

  it('passes dark text on a light slide', () => {
    const issues = auditSlide(slide([text('t', box(60, 60, 400, 40), 'Readable')]), context);
    expect(ofCheck(issues, 'contrast')).toEqual([]);
  });
});

describe('font-unavailable', () => {
  const deck = [
    slide([text('a', box(60, 60, 400, 40), 'One'), text('b', box(60, 160, 400, 40), 'Two')]),
    slide([text('c', box(60, 60, 400, 40), 'Three', { font: 'Arial' })], {
      slideId: 's2',
      index: 1,
    }),
  ];

  it('reports a missing typeface once, with how widely it is used', () => {
    const issues = auditDeck(deck, { ...context, isFontMissing: (font) => font === 'Inter' });
    expect(ofCheck(issues, 'font-unavailable')).toEqual([
      expect.objectContaining({
        issueId: 'font-unavailable:Inter',
        level: 'warning',
        slideId: 's1',
        elementId: 'a',
        params: { font: 'Inter', slides: 1, elements: 2 },
      }),
    ]);
  });

  it('reports nothing when every typeface is there', () => {
    expect(
      ofCheck(auditDeck(deck, { ...context, isFontMissing: () => false }), 'font-unavailable'),
    ).toEqual([]);
    expect(ofCheck(auditDeck(deck, context), 'font-unavailable')).toEqual([]);
  });
});

describe('audit as a whole', () => {
  it('finds nothing on a clean slide', () => {
    const clean = slide([
      shape('panel', box(40, 40, 880, 460), 'surface'),
      text('title', box(60, 60, 600, 50), 'Quarterly results', { role: 'title' }),
      text('body', box(60, 140, 600, 200), 'Revenue grew in every region.'),
    ]);
    expect(auditSlide(clean, { ...context, textHeight: () => pt(40) })).toEqual([]);
  });

  it('writes findings the contract accepts', () => {
    const issues = auditSlide(
      slide([text('t', box(800, 100, 300, 40), 'Words', { color: 'EEEEEE' })]),
      context,
    );
    expect(issues.length).toBeGreaterThan(0);
    for (const found of issues) {
      expect(() => auditFindingSchema.parse(toAuditFinding(found, 'balanced'))).not.toThrow();
    }
  });

  it('describes every check it runs', () => {
    expect(CHECKS.map((check) => check.id)).toEqual([...CHECK_IDS]);
    for (const check of CHECKS) {
      expect(check.title.length).toBeGreaterThan(0);
      expect(check.description.length).toBeGreaterThan(0);
      expect(['error', 'warning']).toContain(check.severity);
    }
  });

  it('keeps the default profile in step with configs/audit.yaml', () => {
    const config = parse(
      readFileSync(new URL('../../../configs/audit.yaml', import.meta.url), 'utf8'),
    );
    const checks = config.profiles.default.deterministic;
    expect(DEFAULT_AUDIT_PROFILE).toEqual({
      minContrastRatio: checks.contrast.minContrastRatio,
      minMarginPt: checks['safe-margins'].minMarginPt,
      forbiddenPatterns: checks['placeholder-text'].forbiddenPatterns,
    });
  });
});
