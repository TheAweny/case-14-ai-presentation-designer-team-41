import type { DeckPlan } from '@lct/contracts';
import type { LoadedAgent } from '@lct/registry';
import { describe, expect, it } from 'vitest';
import type { ModelProvider, ModelRequest } from '../models/provider.js';
import { buildContentPack } from './content-pack.js';
import { checkGrounding, normalise, repairSources } from './grounding.js';
import { planDeck } from './plan-deck.js';

const pack = buildContentPack({
  briefId: 'brief-1',
  goal: 'Show the board that the pilot worked.',
  audience: 'Board',
  language: 'en',
  documents: [
    {
      title: 'Pilot report',
      origin: 'report.md',
      text: '# Results\n\nRetention rose to 94% in the third quarter.\n\nRevenue grew by 12%.',
    },
  ],
});

function slide(id: string, intent: string, headline: string, extra: object = {}): object {
  return {
    slideId: id,
    intent,
    headline,
    subhead: '',
    blocks: [],
    speakerNotes: '',
    sources: [],
    ...extra,
  };
}

function plan(headline: string): DeckPlan {
  return {
    schemaVersion: 1,
    planId: 'plan-1',
    briefId: 'brief-1',
    title: 'Pilot',
    language: 'en',
    slides: [
      slide('s1', 'title', 'The pilot worked'),
      slide('s2', 'kpi', headline, {
        blocks: [
          {
            kind: 'kpi',
            items: [
              {
                value: '94%',
                caption: 'Retention',
                sources: [{ itemId: 'doc1-p1', quote: 'Retention rose to 94%' }],
              },
            ],
          },
        ],
      }),
      slide('s3', 'closing', 'Extend the pilot'),
    ],
  } as DeckPlan;
}

const agent: LoadedAgent = {
  config: {
    id: 'deck-planner',
    version: '1.0.0',
    description: 'Planner.',
    modelId: 'planner-default',
    generation: { temperature: 0.3, topP: 0.9, maxOutputTokens: 8192 },
    outputSchema: 'DeckPlan',
    instructionsFile: 'instructions.md',
  },
  instructions: 'Plan the deck.',
  directory: 'registry/agents/deck-planner',
};

function scripted(...answers: object[]): ModelProvider & { requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    name: 'scripted',
    requests,
    complete: (request) => {
      requests.push(request);
      return Promise.resolve(JSON.stringify(answers.shift()));
    },
  };
}

describe('buildContentPack', () => {
  it('cuts documents into citable passages under their headings', () => {
    expect(pack.items.map((item) => item.itemId)).toEqual(['brief', 'doc1-p1', 'doc1-p2']);
    expect(pack.items[1]).toMatchObject({ title: 'Results', origin: 'report.md' });
    expect(pack.items[1]?.text).toBe('Retention rose to 94% in the third quarter.');
  });
});

describe('checkGrounding', () => {
  it('accepts a plan whose figures and quotes are in the pack', () => {
    expect(checkGrounding(plan('Retention reached 94%'), pack, 3)).toEqual([]);
  });

  it('catches a figure the pack never gave', () => {
    const problems = checkGrounding(plan('Retention reached 97%'), pack, 3);
    expect(problems.map((p) => p.message).join()).toMatch(/97%/);
  });

  it('catches a figure block that holds words', () => {
    const wordy = plan('Retention reached 94%');
    const block = wordy.slides[1]?.blocks[0];
    if (block?.kind === 'kpi' && block.items[0]) {
      block.items[0].value = 'Geometry';
    }
    expect(
      checkGrounding(wordy, pack, 3)
        .map((p) => p.message)
        .join(),
    ).toMatch(/figures, not words/);
  });

  it('catches a quote that is not in its source', () => {
    const misquoted = plan('Retention reached 94%');
    const block = misquoted.slides[1]?.blocks[0];
    if (block?.kind === 'kpi' && block.items[0]) {
      block.items[0].sources = [{ itemId: 'doc1-p1', quote: 'Retention doubled' }];
    }
    expect(checkGrounding(misquoted, pack, 3)).toHaveLength(1);
  });

  it('reads a quote past markdown marks, list markers, line breaks and dashes', () => {
    const source = normalise('- **TypeScript** — продукт и\n  оркестрация: `Next.js` и ещё');
    expect(source.includes(normalise('TypeScript - продукт и оркестрация: Next.js'))).toBe(true);
  });

  it('points a source at the passage its quote is really in', () => {
    const moved = plan('Retention reached 94%');
    const block = moved.slides[1]?.blocks[0];
    if (block?.kind === 'kpi' && block.items[0]) {
      block.items[0].sources = [{ itemId: 'doc1-p2', quote: 'Retention rose to 94%' }];
    }
    const repaired = repairSources(moved, pack);
    expect(repaired.moved).toBe(1);
    expect(checkGrounding(repaired.plan, pack, 3)).toEqual([]);
  });

  it('catches the wrong number of slides and a source that does not exist', () => {
    const lost = plan('Retention reached 94%');
    lost.slides[0]?.sources.push({ itemId: 'doc9-p9', quote: 'x' });
    const messages = checkGrounding(lost, pack, 12).map((p) => p.message);
    expect(messages.some((m) => m.includes('12 were asked for'))).toBe(true);
    expect(messages.some((m) => m.includes('doc9-p9'))).toBe(true);
  });
});

describe('planDeck', () => {
  it('returns a grounded plan after one call', async () => {
    const provider = scripted(plan('Retention reached 94%'));
    const result = await planDeck({ pack, slideCount: 3, agent, provider, seed: 1 });
    expect(result).toMatchObject({ calls: 1, problems: [] });
    expect(provider.requests[0]?.input).toMatchObject({ slideCount: 3, briefId: 'brief-1' });
  });

  it('sends the problems back once and takes the repaired plan', async () => {
    const provider = scripted(plan('Retention reached 97%'), plan('Retention reached 94%'));
    const result = await planDeck({ pack, slideCount: 3, agent, provider, seed: 1 });
    expect(result.calls).toBe(2);
    expect(result.problems).toEqual([]);
    const repair = provider.requests[1]?.input as { problems: string[] };
    expect(repair.problems.join()).toMatch(/97%/);
  });

  it('reports what the repair round could not fix', async () => {
    const provider = scripted(plan('Up 97%'), plan('Still 97%'));
    const result = await planDeck({ pack, slideCount: 3, agent, provider, seed: 1 });
    expect(result.problems).toHaveLength(1);
  });
});
