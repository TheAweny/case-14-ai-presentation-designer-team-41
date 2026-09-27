import type { DeckPlan, SlideIr } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { describe, expect, it } from 'vitest';
import type { ModelProvider } from '../models/provider.js';
import { findOverflows, fitCopy } from './fit-copy.js';

const headline = 'Retention held above 90% in every customer segment we serve';

const plan: DeckPlan = {
  schemaVersion: 1,
  planId: 'p',
  briefId: 'b',
  title: 'T',
  language: 'en',
  slides: [
    {
      slideId: 's1',
      intent: 'bullets',
      headline,
      subhead: '',
      blocks: [{ kind: 'bullets', items: ['Small business retention reached 91%', 'Short'] }],
      speakerNotes: '',
      sources: [],
    },
  ],
};

const run = (text: string) => ({ text, font: '', sizePt: 40, bold: null, italic: null, color: '' });

const slide: SlideIr = {
  schemaVersion: 1,
  slideId: 's1',
  variant: 'balanced',
  index: 0,
  patternId: 'p',
  slideCx: 100,
  slideCy: 100,
  elements: [
    {
      kind: 'text',
      elementId: 'title-s1',
      role: 'title',
      box: { x: 0, y: 0, cx: 10, cy: 10 },
      sourceShapeId: null,
      paragraphs: [{ level: 0, lineSpacing: null, runs: [run(headline)] }],
      overflow: { lines: 2, emu: 100 },
    },
  ],
};

const agent: LoadedAgent = {
  config: {
    id: 'copy-fitter',
    version: '1.0.0',
    description: 'Fitter.',
    modelId: 'writer-default',
    generation: { temperature: 0.2, topP: 0.9, maxOutputTokens: 512 },
    outputSchema: 'CopyEdits',
    instructionsFile: 'instructions.md',
  },
  instructions: 'Shorten.',
  directory: 'registry/agents/copy-fitter',
};

const answering = (edits: object[]): ModelProvider => ({
  name: 'scripted',
  complete: () => Promise.resolve(JSON.stringify({ schemaVersion: 1, edits })),
});

describe('findOverflows', () => {
  it('maps an overflowing element back to its plan part with a target length', () => {
    const [target] = findOverflows(plan, [{ slides: [slide] }]);
    expect(target).toMatchObject({ slideId: 's1', path: 'headline' });
    expect(target?.maxChars).toBeLessThan(headline.length / 2);
  });

  it('finds nothing when everything fits', () => {
    const fits = { ...slide, elements: slide.elements.map((e) => ({ ...e, overflow: null })) };
    expect(findOverflows(plan, [{ slides: [fits as SlideIr] }])).toEqual([]);
  });
});

describe('fitCopy', () => {
  const targets = findOverflows(plan, [{ slides: [slide] }]);

  it('applies a shorter rewrite that keeps its figures, on a copy of the plan', async () => {
    const result = await fitCopy({
      plan,
      targets,
      agent,
      provider: answering([
        { slideId: 's1', path: 'headline', text: 'Retention above 90% everywhere' },
      ]),
      seed: 1,
    });
    expect(result.applied).toBe(1);
    expect(result.plan.slides[0]?.headline).toBe('Retention above 90% everywhere');
    expect(plan.slides[0]?.headline).toMatch(/^Retention held/);
  });

  it('refuses a rewrite that brings a new figure or is not shorter', async () => {
    const result = await fitCopy({
      plan,
      targets,
      agent,
      provider: answering([{ slideId: 's1', path: 'headline', text: 'Retention at 95%' }]),
      seed: 1,
    });
    expect(result.applied).toBe(0);
    expect(result.rejected.join()).toMatch(/95/);
  });
});
