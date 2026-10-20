import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationProfileSchema } from '@lct/contracts';
import { z } from 'zod';
import { CheckpointTextProvider, TaskCheckpoints } from './checkpoints.js';
import { boundedGenerationProvider } from './runner.js';
import type { TextProvider } from './provider.js';
import {
  createGenerationWorkflow,
  createRepairWorkflow,
  SharedContent,
  SharedPlan,
  writerSlots,
} from './workflow.js';

const original = generationProfileSchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/fixtures/GenerationProfile.json', import.meta.url),
      'utf8',
    ),
  ).valid[0].payload,
);
const pattern = (() => {
  const value = original.compositions[0];
  if (!value) throw new Error('Missing fixture composition');
  return value;
})();
const profile = { ...original, compositions: [pattern] };
const brief = 'Рост 18 % за 2026 год. Пилот, без экстраполяции.';
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
type DeckInput = { variant: string; slides: { index: number }[] };
const copy = (index: number, variant: string) => ({
  patternId: pattern.patternId,
  textsBySlot: Object.fromEntries(
    writerSlots(pattern).map((slot) => [
      slot.slotId,
      `Рост 18 % за 2026 год: ${index + 1}. ${variant}`,
    ]),
  ),
  speakerNotes: 'Пилот, без экстраполяции.',
});
function response(agent: string, input: unknown, schema: z.ZodType) {
  if (agent === 'planner')
    return schema.parse({
      title: 'Пилот',
      slides: Array.from({ length: 15 }, () => ({
        patternId: pattern.patternId,
        purpose: brief,
        imageQuery: '',
        requiredClaims: [
          {
            id: 'growth',
            text: 'Рост 18 % за 2026 год',
            source: { sourceId: 'brief', quote: 'Рост 18 % за 2026 год' },
          },
        ],
      })),
    });
  if (agent !== 'writer') throw new Error(`Unexpected speculative role ${agent}`);
  const deck = input as DeckInput;
  return schema.parse({
    slides: Object.fromEntries(
      deck.slides.map(({ index }) => [String(index), copy(index, deck.variant)]),
    ),
  });
}
async function variants(
  provider: TextProvider,
  variantCopyMode: 'independent' | 'shared' = 'independent',
) {
  const sharedPlan = new SharedPlan();
  const sharedContent = new SharedContent();
  return Promise.all(
    (['dense', 'balanced', 'airy'] as const).map(async (variant) => {
      const workflow = createGenerationWorkflow({
        provider,
        sharedPlan,
        sharedContent,
        variantCopyMode,
        variant,
        plannerInstructions: 'planner-fixture',
        writerInstructions: 'slot-fixture',
        deckWriterInstructions: 'deck-fixture',
        signal: new AbortController().signal,
      });
      return (await workflow.createRun()).start({ inputData: { brief, slideCount: 15, profile } });
    }),
  );
}

describe('one agent per complete variant', () => {
  it('runs one shared planner and three concurrent whole-deck writers for 45 slides', async () => {
    const sends: { agent: string; input: unknown }[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider: TextProvider = {
      model: 'offline',
      async generate(agent, _instructions, input, schema) {
        sends.push({ agent, input });
        if (agent === 'writer') await gate;
        return schema.parse(response(agent, input, schema));
      },
    };
    const pending = variants(provider);
    await vi.waitFor(() => expect(sends.filter((send) => send.agent === 'writer')).toHaveLength(3));
    release();
    const results = await pending;
    expect(sends.filter((send) => send.agent === 'planner')).toHaveLength(1);
    expect(sends).toHaveLength(4);
    for (const send of sends.filter((send) => send.agent === 'writer')) {
      expect((send.input as DeckInput).slides).toHaveLength(15);
      expect(send.input).toMatchObject({ brief, outlineIsSource: true });
    }
    for (const result of results) {
      expect(result.status).toBe('success');
      if (result.status !== 'success') throw new Error('Variant failed');
      expect(result.result.map((slide) => slide.index)).toEqual(
        Array.from({ length: 15 }, (_, i) => i),
      );
      for (const slide of result.result)
        expect(slide.slide.texts.map((text) => text.text).join(' ')).toContain('18 % за 2026 год');
    }
  });

  it('shares one complete balanced variant only when shared copy is requested', async () => {
    const sends: string[] = [];
    const provider: TextProvider = {
      model: 'offline',
      async generate(agent, _instructions, input, schema) {
        sends.push(agent);
        if (agent === 'writer') expect((input as DeckInput).variant).toBe('balanced');
        return schema.parse(response(agent, input, schema));
      },
    };
    const results = await variants(provider, 'shared');
    expect(results.every((result) => result.status === 'success')).toBe(true);
    expect(sends).toEqual(['planner', 'writer']);
  });

  it('selects layouts once for an approved plan and restores every claim without model repetition', async () => {
    const outline = {
      title: 'Пилот',
      audience: 'Совет директоров',
      goal: 'Согласовать пилот',
      slides: Array.from({ length: 15 }, (_, index) => ({
        title: `Слайд ${index + 1}`,
        points: [brief],
        kind: 'statement' as const,
      })),
    };
    let plans = 0;
    const provider: TextProvider = {
      model: 'offline',
      async generate(agent, _instructions, input, schema) {
        if (agent === 'planner') {
          plans++;
          expect(input).toMatchObject({ outlineLayoutOnly: true });
          const fields = z.toJSONSchema(schema) as {
            properties?: { slides?: { items?: { properties?: Record<string, unknown> } } };
          };
          expect(fields.properties?.slides?.items?.properties).not.toHaveProperty('purpose');
          expect(fields.properties?.slides?.items?.properties).not.toHaveProperty('requiredClaims');
        } else if (agent === 'writer') {
          const slide = (
            input as { slides: { requiredClaims: { text: string }[]; purpose: string }[] }
          ).slides[7];
          expect(slide?.purpose).toBe('Слайд 8');
          expect(slide?.requiredClaims.map((claim) => claim.text)).toEqual(['Слайд 8', brief]);
        }
        return schema.parse(response(agent, input, schema));
      },
    };
    const workflow = createGenerationWorkflow({
      provider,
      variant: 'balanced',
      plannerInstructions: 'planner',
      writerInstructions: 'slide',
      deckWriterInstructions: 'deck',
      signal: new AbortController().signal,
    });
    const result = await (
      await workflow.createRun()
    ).start({ inputData: { brief, slideCount: 15, profile, outline } });
    expect(result.status).toBe('success');
    expect(plans).toBe(1);
  });

  it.each(['missing', 'extra'])(
    'rejects a whole-deck response with %s slide indices',
    async (kind) => {
      let writers = 0;
      const provider: TextProvider = {
        model: 'offline',
        async generate(agent, _instructions, input, schema) {
          if (agent !== 'writer') return schema.parse(response(agent, input, schema));
          writers++;
          const deck = input as DeckInput;
          const slides = Object.fromEntries(
            deck.slides.map(({ index }) => [String(index), copy(index, deck.variant)]),
          );
          if (kind === 'missing') delete slides['7'];
          else slides['15'] = copy(15, deck.variant);
          return schema.parse({ slides });
        },
      };
      const results = await variants(provider);
      expect(results.every((result) => result.status === 'failed')).toBe(true);
      expect(writers).toBe(3);
    },
  );

  it('resumes only the failed variant and reuses the accepted planner and full variants', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'deck-writer-recovery-'));
    roots.push(directory);
    const sends: string[] = [];
    let fail = true;
    const inner: TextProvider = {
      model: 'offline',
      async generate(agent, _instructions, input, schema) {
        const variant = (input as DeckInput).variant;
        sends.push(`${agent}:${variant ?? ''}`);
        if (agent === 'writer' && variant === 'airy' && fail) throw new Error('worker lost');
        return schema.parse(response(agent, input, schema));
      },
    };
    const execute = () =>
      variants(new CheckpointTextProvider(inner, new TaskCheckpoints(directory, 'immutable')));
    const first = await execute();
    expect(first.map((item) => item.status).sort()).toEqual(['failed', 'success', 'success']);
    fail = false;
    expect((await execute()).every((item) => item.status === 'success')).toBe(true);
    expect(sends.filter((send) => send.startsWith('planner:'))).toHaveLength(1);
    expect(sends.filter((send) => send === 'writer:dense')).toHaveLength(1);
    expect(sends.filter((send) => send === 'writer:balanced')).toHaveLength(1);
    expect(sends.filter((send) => send === 'writer:airy')).toHaveLength(2);
  });

  it('keeps a fitting repair when another alternative exceeds the slot limit', async () => {
    const slot = writerSlots(pattern)[0];
    if (!slot) throw new Error('Missing fixture slot');
    let checked = false;
    const provider: TextProvider = {
      model: 'offline',
      async generate(_agent, _instructions, _input, schema) {
        const answer = (text: string) => ({
          slides: { '0': { rewrites: { [slot.slotId]: [text, 'Рост', text] } } },
        });
        checked = true;
        return schema.parse(answer('а'.repeat(slot.maxChars + 1)));
      },
    };
    const workflow = createRepairWorkflow({
      provider,
      plannerInstructions: '',
      writerInstructions: '',
      deckRepairInstructions: 'repair-fixture',
      signal: new AbortController().signal,
    });
    const result = await (
      await workflow.createRun()
    ).start({
      inputData: [
        {
          index: 0,
          brief,
          composition: pattern,
          requiredClaims: [],
          previous: {
            patternId: pattern.patternId,
            speakerNotes: '',
            texts: pattern.slots.map((s) => ({ slotId: s.slotId, text: 'Рост' })),
          },
          corrections: [{ slotId: slot.slotId, message: 'text-overflow' }],
        },
      ],
    });
    expect(checked).toBe(true);
    expect(result.status).toBe('success');
    if (result.status === 'success')
      expect(result.result[0]?.slide.texts.find((s) => s.slotId === slot.slotId)?.text).toBe(
        'Рост',
      );
  });

  it('repairs all affected slides in one request and enforces two rounds per variant', async () => {
    const slot = writerSlots(pattern)[0];
    if (!slot) throw new Error('Missing fixture slot');
    const sends: unknown[] = [];
    const inner: TextProvider = {
      model: 'offline',
      async generate(agent, _instructions, input, schema) {
        expect(agent).toBe('rewriter');
        sends.push(input);
        const deck = input as DeckInput;
        return schema.parse({
          slides: Object.fromEntries(
            deck.slides.map(({ index }) => [
              String(index),
              {
                rewrites: { [slot.slotId]: ['Рост 18 %', 'Рост 18 %', 'Рост 18 %'] },
              },
            ]),
          ),
        });
      },
    };
    const provider = boundedGenerationProvider(inner);
    const execute = async () => {
      const workflow = createRepairWorkflow({
        provider,
        variant: 'dense',
        plannerInstructions: '',
        writerInstructions: '',
        deckRepairInstructions: 'repair-fixture',
        signal: new AbortController().signal,
      });
      return (await workflow.createRun()).start({
        inputData: [2, 8, 14].map((index) => ({
          index,
          brief,
          purpose: 'Рост',
          requiredClaims: [],
          composition: pattern,
          previous: {
            patternId: pattern.patternId,
            speakerNotes: 'Preserve notes',
            texts: pattern.slots.map((item) => ({ slotId: item.slotId, text: 'Original' })),
          },
          corrections: [{ slotId: slot.slotId, message: 'text-overflow' }],
        })),
      });
    };
    const first = await execute();
    expect(first.status).toBe('success');
    expect(sends).toHaveLength(1);
    expect((sends[0] as DeckInput).slides.map((slide) => slide.index)).toEqual([2, 8, 14]);
    if (first.status === 'success')
      for (const result of first.result) {
        expect(result.slide.speakerNotes).toBe('Preserve notes');
        for (const text of result.slide.texts)
          if (text.slotId !== slot.slotId) expect(text.text).toBe('Original');
      }
    expect((await execute()).status).toBe('success');
    expect((await execute()).status).toBe('failed');
    expect(sends).toHaveLength(2);
  });
});
