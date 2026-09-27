import type { ContentPack, SlideIr, SlideReview } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { describe, expect, it } from 'vitest';
import type { ModelProvider, ModelRequest } from '../models/provider.js';
import { findingsOf, runContextualAudit } from './contextual-audit.js';
import { CONTEXTUAL_CHECKS } from './contextual-checks.js';

const run = (text: string) => ({ text, font: '', sizePt: 24, bold: null, italic: null, color: '' });

function slide(id: string, index: number, headline: string, body: string): SlideIr {
  return {
    schemaVersion: 1,
    slideId: id,
    variant: 'balanced',
    index,
    patternId: 'title-body',
    slideCx: 12192000,
    slideCy: 6858000,
    elements: [
      {
        kind: 'text',
        elementId: `title-${id}`,
        role: 'title',
        box: { x: 0, y: 0, cx: 100, cy: 100 },
        sourceShapeId: null,
        paragraphs: [{ level: 0, lineSpacing: null, runs: [run(headline)] }],
        overflow: null,
      },
      {
        kind: 'text',
        elementId: `body-${id}`,
        role: 'body',
        box: { x: 0, y: 200, cx: 100, cy: 100 },
        sourceShapeId: null,
        paragraphs: [{ level: 0, lineSpacing: null, runs: [run(body)] }],
        overflow: null,
      },
    ],
  };
}

const slides = [
  slide('s1', 0, 'Retention', 'Retention rose to 94%.'),
  slide('s2', 1, 'Revenue grew by 12%', 'As an AI model I cannot verify this.'),
];

const pack: ContentPack = {
  schemaVersion: 1,
  packId: 'p',
  briefId: 'b',
  language: 'en',
  goal: 'Show the pilot worked.',
  audience: '',
  items: [
    { itemId: 'doc1-p1', kind: 'text', title: '', text: 'Retention rose to 94%.', origin: '' },
  ],
};

const agent: LoadedAgent = {
  config: {
    id: 'slide-reviewer',
    version: '1.0.0',
    description: 'Reviewer.',
    modelId: 'vision-default',
    generation: { temperature: 0, topP: 1, maxOutputTokens: 2048 },
    outputSchema: 'SlideReview',
    instructionsFile: 'instructions.md',
  },
  instructions: 'Review the slide.',
  directory: 'registry/agents/slide-reviewer',
};

function review(slideId: string, answers: SlideReview['answers']): SlideReview {
  return { schemaVersion: 1, slideId, answers };
}

const answers: Record<string, SlideReview> = {
  s1: review('s1', [
    {
      checkId: 'headline-states-conclusion',
      verdict: 'no',
      confidence: 0.9,
      evidence: 'Retention',
      suggestion: 'Retention rose to 94% in the pilot',
    },
    { checkId: 'no-typos', verdict: 'yes', confidence: 0.95, evidence: '', suggestion: '' },
  ]),
  s2: review('s2', [
    {
      checkId: 'no-service-text',
      verdict: 'no',
      confidence: 0.97,
      evidence: 'As an AI model',
      suggestion: '',
    },
    {
      checkId: 'claim-supported-by-content-pack',
      verdict: 'no',
      confidence: 0.4,
      evidence: '12%',
      suggestion: 'Remove the revenue figure: the sources do not give it.',
    },
  ]),
};

function reviewer(fail?: string): ModelProvider & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    name: 'scripted',
    requests,
    complete: (request) => {
      requests.push(request);
      const id = (request.input as { slideId: string }).slideId;
      if (id === fail) {
        return Promise.reject(new Error('runtime down'));
      }
      return Promise.resolve(JSON.stringify(answers[id]));
    },
  };
}

describe('contextual check registry', () => {
  it('asks every content validation question of the case', () => {
    expect(CONTEXTUAL_CHECKS.length).toBeGreaterThanOrEqual(11);
    for (const check of CONTEXTUAL_CHECKS) {
      expect(check.question.endsWith('?')).toBe(true);
    }
  });
});

describe('runContextualAudit', () => {
  it('turns every "no" into a contextual finding on the element it quotes', async () => {
    const result = await runContextualAudit({ slides, pack, agent, provider: reviewer(), seed: 1 });
    expect(result.failures).toEqual([]);
    const headline = result.findings.find((f) => f.checkId === 'headline-states-conclusion');
    expect(headline).toMatchObject({
      origin: 'contextual',
      severity: 'minor',
      target: { slideId: 's1', elementId: 'title-s1' },
    });
    expect(headline?.confidence).toBeLessThan(1);
    const leak = result.findings.find((f) => f.checkId === 'no-service-text');
    expect(leak).toMatchObject({ severity: 'major', target: { elementId: 'body-s2' } });
  });

  it('reports an unsure "no" as info, not as a defect', async () => {
    const result = await runContextualAudit({ slides, pack, agent, provider: reviewer(), seed: 1 });
    const claim = result.findings.find((f) => f.checkId === 'claim-supported-by-content-pack');
    expect(claim?.severity).toBe('info');
  });

  it('offers a rewrite as a patch only when the model is sure, and never applies it', async () => {
    const result = await runContextualAudit({ slides, pack, agent, provider: reviewer(), seed: 1 });
    const headline = result.findings.find((f) => f.checkId === 'headline-states-conclusion');
    expect(headline?.proposedPatch?.ops[0]).toMatchObject({
      op: 'set-text',
      elementId: 'title-s1',
    });
    expect(headline?.proposedPatch?.touchesCopy).toBe(true);
    const claim = result.findings.find((f) => f.checkId === 'claim-supported-by-content-pack');
    expect(claim?.proposedPatch).toBeNull();
    expect(slides[0]?.elements[0]).toMatchObject({
      paragraphs: [{ runs: [{ text: 'Retention' }] }],
    });
  });

  it('gives the model the neighbours, the sources and the questions', async () => {
    const provider = reviewer();
    await runContextualAudit({
      slides,
      pack,
      agent,
      provider,
      seed: 1,
      images: { s1: 'data:image/png;base64,AA' },
    });
    const first = provider.requests.find((r) => (r.input as { slideId: string }).slideId === 's1');
    expect(first?.images).toEqual(['data:image/png;base64,AA']);
    expect(first?.input).toMatchObject({
      previous: null,
      next: { headline: 'Revenue grew by 12%' },
    });
    expect((first?.input as { questions: unknown[] }).questions).toHaveLength(
      CONTEXTUAL_CHECKS.length,
    );
    const sources = (first?.input as { sources: { itemId: string }[] }).sources;
    expect(sources.map((s) => s.itemId)).toEqual(['doc1-p1']);
  });

  it('keeps auditing the deck when one slide cannot be reviewed', async () => {
    const result = await runContextualAudit({
      slides,
      pack,
      agent,
      provider: reviewer('s2'),
      seed: 1,
    });
    expect(result.failures).toEqual([{ slideId: 's2', error: 'runtime down' }]);
    expect(result.reviews).toHaveLength(1);
  });

  it('ignores answers to questions it did not ask', () => {
    const stray = review('s1', [
      { checkId: 'made-up', verdict: 'no', confidence: 1, evidence: '', suggestion: '' },
    ]);
    expect(findingsOf(slides[0] as SlideIr, stray)).toEqual([]);
  });
});
