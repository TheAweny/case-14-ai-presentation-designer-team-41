import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  compositionCritiqueSchema,
  compositionNoteSchema,
  generationProfileSchema,
  generationRequestSchema,
  generationSpecSchema,
  type Composition,
  type CompositionNote,
  type RequiredSlideClaim,
} from '@lct/contracts';
import { CheckpointTextProvider, TaskCheckpoints } from './checkpoints.js';
import {
  createGenerationWorkflow,
  createRepairWorkflow,
  SharedContent,
  SharedPlan,
  fitChars,
  minChars,
  bestFittingAlternative,
  remapPlan,
  slotBriefs,
} from './workflow.js';
import { compositionSemantics, semanticSlotMap } from './semantics.js';
import { loadWriterModules, writerPrompt } from './writer-prompt.js';
import { SemanticTextProvider } from './semantic-provider.js';
import { approvedCoverage } from './final-review.js';
import { retainsClaimDetails } from './claim-details.js';
import { AttemptBudget } from './attempt-budget.js';
import type { TextProvider } from './provider.js';

const registry = resolve('../../registry/agents');
const facts = [
  ['Заявка', 'Сотрудник направляет заявку в единую очередь.'],
  ['Согласование', 'Руководитель согласует заявку в том же сервисе.'],
  ['История', 'История решений сохраняется в карточке заявки.'],
  ['Ограничение', 'При сбое заявка не отправляется; повтор возможен через 15 минут.'],
] as const;
const brief = facts.map((entry) => entry[1]).join('\n');
const claims: RequiredSlideClaim[] = facts.map((entry, index) => ({
  id: `claim-${index}`,
  text: entry[1],
  source: { sourceId: 'brief', quote: entry[1] },
}));
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Missing fixture value');
  return value;
}
const limitedClaim = required(claims[3]);
const slot = (slotId: string, role: 'title' | 'body', maxChars = 400) => ({
  slotId,
  role,
  maxChars,
  maxLines: role === 'title' ? 2 : 6,
  sample: '',
  font: 'Fixture',
  fontSize: role === 'title' ? 28 : 18,
  capacity: { safeChars: maxChars, basis: 'obstacle-aware' as const },
});
const pattern: Composition = {
  patternId: 'steps',
  sourceIndex: 0,
  name: 'Four steps',
  imageCount: 0,
  slots: [
    slot('title', 'title', 120),
    ...facts.flatMap((_, i) => [slot(`h${i}`, 'body', 60), slot(`b${i}`, 'body', 160)]),
  ],
};
const note: CompositionNote = compositionNoteSchema.parse({
  patternId: pattern.patternId,
  kind: 'process',
  items: 4,
  useFor: 'Four ordered steps',
  skip: false,
  groups: facts.map((_, index) => ({
    id: `step-${index}`,
    kind: 'step',
    slotIds: [`h${index}`, `b${index}`],
  })),
  slotSemantics: [
    { slotId: 'title', role: 'slide-title' },
    ...facts.flatMap((_, i) => [
      { slotId: `h${i}`, role: 'card-heading', groupId: `step-${i}` },
      { slotId: `b${i}`, role: 'body', groupId: `step-${i}` },
    ]),
  ],
});
const rootDirs: string[] = [];
afterEach(async () => {
  await Promise.all(rootDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'content-quality-'));
  rootDirs.push(path);
  return path;
}
async function profile() {
  const fixture = JSON.parse(
    await readFile(resolve('../contracts/fixtures/GenerationProfile.json'), 'utf8'),
  );
  return generationProfileSchema.parse({ ...fixture.valid[0].payload, compositions: [pattern] });
}
const planned = () => ({
  title: 'Заявки',
  audience: 'Команда',
  goal: 'Объяснить процесс',
  slides: Array.from({ length: 5 }, () => ({
    patternId: pattern.patternId,
    purpose: 'Порядок обработки заявки',
    imageQuery: '',
    requiredClaims: claims,
  })),
});
const copy = (index: number, variant: string) => ({
  patternId: pattern.patternId,
  textsBySlot: Object.fromEntries([
    ['title', `Порядок обработки заявки ${index + 1}`],
    ...facts.flatMap(([heading, body], i) => [
      [`h${i}`, heading],
      [
        `b${i}`,
        variant === 'airy'
          ? body
          : variant === 'dense'
            ? `${body} ${
                [
                  'На этом шаге сотрудник отправляет заявку; для неё предусмотрена единая очередь.',
                  'Согласование выполняет руководитель внутри сервиса, куда поступила заявка.',
                  'Карточка заявки содержит историю принятых решений.',
                  'Условие относится к отправке: после сбоя повтор возможен через указанный интервал.',
                ][i]
              }`
            : `${body} Это часть обработки заявки.`,
      ],
    ]),
  ]),
  speakerNotes: '',
  visual: null,
});

describe('content policy through the actual Mastra workflow', () => {
  it('requires source claims on a new plan before starting writers', async () => {
    let calls = 0;
    const modules = await loadWriterModules(join(registry, 'slide-writer'));
    const raw: TextProvider = {
      model: 'fake',
      async generate(agent, _instructions, _input, schema) {
        expect(agent).toBe('planner');
        calls++;
        return schema.parse({
          ...planned(),
          slides: planned().slides.map((slide) => ({ ...slide, requiredClaims: [] })),
        });
      },
    };
    const workflow = createGenerationWorkflow({
      provider: raw,
      writerModules: modules,
      plannerInstructions: '',
      writerInstructions: '',
      signal: new AbortController().signal,
    });
    expect(
      (
        await (
          await workflow.createRun()
        ).start({ inputData: { brief, slideCount: 5, profile: await profile() } })
      ).status,
    ).toBe('failed');
    expect(calls).toBe(2);
  });

  it.each(['independent', 'shared'] as const)(
    'one planner, distinct variant jobs only in %s mode',
    async (variantCopyMode) => {
      const directory = await temporary();
      const modules = await loadWriterModules(join(registry, 'slide-writer'));
      const basePrompt = await readFile(join(registry, 'slide-writer/instructions.md'), 'utf8');
      const calls: { agent: string; input: unknown; instructions: string; schema: unknown }[] = [];
      const raw: TextProvider = {
        model: 'offline-recording',
        async generate(agent, instructions, input, schema) {
          calls.push({
            agent,
            input: structuredClone(input),
            instructions,
            schema: z.toJSONSchema(schema),
          });
          if (agent === 'planner') return schema.parse(planned());
          if (agent === 'rewriter') {
            const repair = input as { slots: { slotId: string; text: string }[] };
            return schema.parse({
              rewrites: Object.fromEntries(
                repair.slots.map((s) => [s.slotId, [s.text, s.text, s.text]]),
              ),
            });
          }
          const task = input as { index: number; variant: string };
          return schema.parse(copy(task.index, task.variant));
        },
      };
      const execute = async (
        writerInstructions = basePrompt,
        source = brief,
        mode = variantCopyMode,
      ) => {
        const durable = new CheckpointTextProvider(
          raw,
          new TaskCheckpoints(directory, 'immutable'),
        );
        const sharedPlan = new SharedPlan();
        const sharedContent = new SharedContent();
        return Promise.all(
          (['dense', 'balanced', 'airy'] as const).map(async (variant) => {
            const workflow = createGenerationWorkflow({
              provider: durable,
              sharedPlan,
              sharedContent,
              variant,
              variantCopyMode: mode,
              writerModules: modules,
              notes: [note],
              plannerInstructions: 'planner-v1',
              writerInstructions,
              signal: new AbortController().signal,
            });
            return (await workflow.createRun()).start({
              inputData: { brief: source, slideCount: 5, profile: await profile() },
            });
          }),
        );
      };
      const result = await execute();
      expect(result.every((item) => item.status === 'success')).toBe(true);
      const lengths = result.map((item) =>
        item.status === 'success'
          ? (item.result[0]?.slide.texts.reduce((sum, text) => sum + text.text.length, 0) ?? 0)
          : 0,
      );
      if (variantCopyMode === 'independent') {
        expect(required(lengths[0])).toBeGreaterThan(required(lengths[1]));
        expect(required(lengths[1])).toBeGreaterThan(required(lengths[2]));
      }
      for (const item of result)
        if (item.status === 'success')
          for (const slide of item.result) {
            const visible = slide.slide.texts.map((text) => text.text).join('\n');
            for (const claim of claims) expect(visible).toContain(claim.text);
            for (const text of slide.slide.texts) {
              const bound = pattern.slots.find((slot) => slot.slotId === text.slotId);
              expect(text.text.length).toBeLessThanOrEqual(required(bound).maxChars);
            }
          }
      expect(calls.filter((call) => call.agent === 'planner')).toHaveLength(1);
      const writers = calls.filter((call) => call.agent === 'writer');
      expect(writers).toHaveLength(variantCopyMode === 'independent' ? 15 : 5);
      expect(new Set(writers.map((call) => (call.input as { variant: string }).variant)).size).toBe(
        variantCopyMode === 'independent' ? 3 : 1,
      );
      for (const call of writers) {
        const task = call.input as {
          variant: string;
          requiredClaims: unknown[];
          composition: {
            groups: unknown[];
            slots: {
              slotId: string;
              semanticRole: string;
              groupId?: string;
              fitChars: number;
              targetMaxChars: number;
            }[];
          };
        };
        expect(task.requiredClaims).toHaveLength(4);
        expect(task.composition.groups).toHaveLength(4);
        expect(task.composition.slots.find((s) => s.slotId === 'b2')).toMatchObject({
          semanticRole: 'body',
          groupId: 'step-2',
          fitChars: 160,
        });
        expect(call.instructions.match(/Стратегия:/g)).toHaveLength(1);
        expect(call.instructions.match(/Плотность:/g)).toHaveLength(1);
        expect(call.instructions).not.toContain('Стратегия: customer');
        expect(call.instructions).toContain(`Плотность: ${task.variant}`);
        expect(JSON.stringify(call.input)).not.toContain('slotNativeSchema');
        expect(JSON.stringify(call.schema)).not.toContain('chartType');
      }
      const accepted = calls.length;
      await execute();
      expect(calls).toHaveLength(accepted);
      await execute(`${basePrompt}\nrevision-2`);
      expect(calls.filter((call) => call.agent === 'writer')).toHaveLength(writers.length * 2);
      await execute(`${basePrompt}\nrevision-2`, `${brief}\nПодтверждён новый контекст.`);
      expect(calls.filter((call) => call.agent === 'planner')).toHaveLength(2);
      const beforePolicyChange = calls.filter((call) => call.agent === 'writer').length;
      await execute(basePrompt, brief, variantCopyMode === 'shared' ? 'independent' : 'shared');
      expect(calls.filter((call) => call.agent === 'writer')).toHaveLength(
        beforePolicyChange + (variantCopyMode === 'shared' ? 15 : 5),
      );
    },
  );

  it('does not accept source evidence from a model-proposed outline', async () => {
    const raw: TextProvider = {
      model: 'fake',
      async generate(_agent, _instructions, _input, schema) {
        const plan = planned();
        required(plan.slides[0]).requiredClaims = [
          { id: 'invented', text: 'Рост 90 %', source: { sourceId: 'brief', quote: 'Рост 90 %' } },
        ];
        return schema.parse(plan);
      },
    };
    const workflow = createGenerationWorkflow({
      provider: raw,
      notes: [note],
      outlineIsSource: false,
      plannerInstructions: '',
      writerInstructions: '',
      signal: new AbortController().signal,
    });
    const result = await (
      await workflow.createRun()
    ).start({
      inputData: {
        brief,
        slideCount: 5,
        profile: await profile(),
        outline: {
          title: 'Draft',
          audience: '',
          goal: '',
          slides: Array.from({ length: 5 }, () => ({
            title: 'Рост 90 %',
            points: [],
            kind: 'statement' as const,
          })),
        },
      },
    });
    expect(result.status).toBe('failed');
  });
});

describe('group compatibility and safe density', () => {
  it('moves heading/body together even when XML slot order differs', () => {
    const target = { ...pattern, patternId: 'other', slots: [...pattern.slots].reverse() };
    const mapping = semanticSlotMap(pattern, target, note, { ...note, patternId: 'other' });
    expect(mapping?.get('h2')).toBe('h2');
    expect(mapping?.get('b2')).toBe('b2');
  });
  it('rejects equally many slots with incompatible group structure', () => {
    const target = { ...pattern, patternId: 'columns' };
    const other = {
      ...note,
      patternId: 'columns',
      groups: required(note.groups).map((g) => ({ ...g, kind: 'column' as const })),
    };
    expect(semanticSlotMap(pattern, target, note, other)).toBeUndefined();
    expect(
      remapPlan(
        ['steps', 'steps'],
        [pattern, target],
        [target],
        'dense',
        [],
        new Map([
          ['steps', note],
          ['columns', other],
        ]),
      ),
    ).toEqual(['steps', 'steps']);
  });
  it('keeps ambiguous legacy multi-field layouts and marks semantics unknown', () => {
    expect(semanticSlotMap(pattern, { ...pattern, patternId: 'unknown' })).toBeUndefined();
    expect(compositionSemantics(pattern).groups).toEqual([]);
    expect(compositionSemantics(pattern).slots.every((s) => s.semanticRole === 'unknown')).toBe(
      true,
    );
    const bad = { ...note, groups: [...required(note.groups), required(note.groups?.[0])] };
    expect(compositionSemantics(pattern, bad).groups).toEqual([]);
  });
  it('uses measured safe room for large fields but retains decoration protection for old profiles', () => {
    const measured = { ...slot('body', 'body'), sample: 'Кратко' };
    const { capacity: _capacity, ...legacy } = measured;
    expect(fitChars(measured)).toBe(400);
    expect(minChars(measured, 'dense')).toBe(200);
    expect(fitChars(legacy)).toBeLessThan(20);
    expect(slotBriefs([measured], 'airy')[0]?.targetMaxChars).toBe(180);
    expect(slotBriefs([measured], 'dense')[0]?.targetMinChars).toBe(260);
    const alternatives = ['а'.repeat(120), 'б'.repeat(240), 'в'.repeat(350)];
    expect(bestFittingAlternative(measured, alternatives, 'airy')).toBe(alternatives[0]);
    expect(bestFittingAlternative(measured, alternatives, 'dense')).toBe(alternatives[2]);
  });
  it('assembles one audience, one density and the text output branch', async () => {
    const modules = await loadWriterModules(join(registry, 'slide-writer'));
    const prompt = writerPrompt('base', modules, {
      audience: 'Клиент',
      goal: 'Выбрать пилот',
      variant: 'airy',
      output: 'text',
    });
    expect(prompt).toContain('Стратегия: customer');
    expect(prompt).not.toContain('Стратегия: team');
    expect(prompt).not.toContain('block.kind');
    expect(prompt).toContain('visual:null');
  });
});

describe('claim detail and per-variant coverage', () => {
  it('preserves number, unit, negation and condition in a short paraphrase', () => {
    const original = facts[3][1];
    expect(
      retainsClaimDetails(original, 'Если сбой, отправки нет; повтор — через 15 минут.', [
        limitedClaim,
      ]),
    ).toBe(true);
    expect(
      retainsClaimDetails(original, 'Заявка отправляется; повтор через 15 минут.', [limitedClaim]),
    ).toBe(false);
    expect(
      retainsClaimDetails(original, 'При сбое отправки нет; повтор через 15 секунд.', [
        limitedClaim,
      ]),
    ).toBe(false);
  });
  it('keeps a critic-backed paraphrase unconfirmed without independent entailment evidence', () => {
    const visible = 'Если сбой, отправки нет; повтор — через 15 минут.';
    const written = [
      { index: 0, requiredClaims: [limitedClaim], slide: { texts: [{ text: visible }] } },
    ];
    expect(
      approvedCoverage(null, written, [{ slideIndex: 0, claimIndex: 0, quote: visible }]).covered,
    ).toBe(0);
    expect(
      approvedCoverage(
        null,
        [{ ...required(written[0]), slide: { texts: [{ text: 'Заявка отправляется' }] } }],
        [],
      ).missing,
    ).toHaveLength(1);
  });
  it('shares the repair budget and never spends it on cancellation', async () => {
    let calls = 0;
    const budget = new AttemptBudget(1);
    const provider: TextProvider = {
      model: 'fake',
      async generate(_agent, _instructions, _input, schema) {
        calls++;
        return schema.parse({
          rewrites: { b3: ['Заявка отправляется', 'Повтор через 15 секунд', 'Нет сбоя'] },
        });
      },
    };
    const workflow = createRepairWorkflow({
      provider,
      attemptBudget: budget,
      variant: 'airy',
      notes: [note],
      plannerInstructions: '',
      writerInstructions: '',
      signal: new AbortController().signal,
    });
    const previous = {
      patternId: pattern.patternId,
      texts: [{ slotId: 'b3', text: facts[3][1] }],
      speakerNotes: '',
    };
    const tasks = [0, 1].map((index) => ({
      index,
      brief,
      composition: pattern,
      previous,
      requiredClaims: [limitedClaim],
      corrections: [{ slotId: 'b3', message: 'Shorten' }],
    }));
    const result = await (await workflow.createRun()).start({ inputData: tasks });
    expect(result.status).toBe('success');
    expect(calls).toBe(1);
    expect(budget.remaining).toBe(0);
    if (result.status === 'success')
      for (const slide of result.result) expect(slide.slide.texts[0]?.text).toBe(facts[3][1]);
    const controller = new AbortController();
    controller.abort();
    const cancelled = createRepairWorkflow({
      provider,
      attemptBudget: new AttemptBudget(1),
      plannerInstructions: '',
      writerInstructions: '',
      signal: controller.signal,
    });
    expect((await (await cancelled.createRun()).start({ inputData: tasks })).status).toBe('failed');
    expect(calls).toBe(1);
  });
  it('defaults new requests to independent and old immutable specs to shared', async () => {
    const request = generationRequestSchema.parse({
      templateId: '00000000-0000-4000-8000-000000000001',
      brief,
    });
    expect(request.variantCopyMode).toBe('independent');
    const { variantCopyMode: _mode, ...oldRequest } = request;
    expect(
      generationSpecSchema.parse({
        schemaVersion: 1,
        request: oldRequest,
        brief,
        profile: await profile(),
        registryHash: 'a'.repeat(64),
        modelPolicy: [],
        today: '2026-10-19T00:00:00.000Z',
      }).request.variantCopyMode,
    ).toBe('shared');
  });

  it.each(['429 Retry-After: 10', 'deadline', 'cancelled'])(
    'does not multiply provider failure %s with a repair loop',
    async (message) => {
      let calls = 0;
      const provider: TextProvider = {
        model: 'fake',
        async generate() {
          calls++;
          throw new Error(message);
        },
      };
      const workflow = createRepairWorkflow({
        provider,
        attemptBudget: new AttemptBudget(3),
        plannerInstructions: '',
        writerInstructions: '',
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
            requiredClaims: claims,
            previous: {
              patternId: pattern.patternId,
              texts: [{ slotId: 'b3', text: facts[3][1] }],
              speakerNotes: '',
            },
            corrections: [{ slotId: 'b3', message: 'Shorten' }],
          },
        ],
      });
      expect(result.status).toBe('failed');
      expect(calls).toBe(1);
    },
  );
});

describe('semantic checkpoints preserve card relationships', () => {
  it('distinguishes four correct steps from swapped headings and bodies with the same strings', async () => {
    const directory = await temporary();
    let sends = 0;
    const raw: TextProvider = {
      model: 'recorded-critic',
      async generate(_agent, _instructions, input, schema) {
        sends++;
        const payload = input as {
          slides: {
            slideIndex: number;
            groups: { slotIds: string[] }[];
            texts: { slotId: string; text: string; semanticRole: string }[];
          }[];
        };
        const issues = payload.slides.flatMap((slide) =>
          slide.groups.flatMap((group) => {
            const members = slide.texts.filter((text) => group.slotIds.includes(text.slotId));
            const heading = members.find((text) => text.semanticRole === 'card-heading');
            const body = members.find((text) => text.semanticRole === 'body');
            const expected = facts.find((entry) => entry[0] === heading?.text)?.[1];
            return body && body.text !== expected
              ? [
                  {
                    slideIndex: slide.slideIndex,
                    slotId: body.slotId,
                    category: 'factual-error',
                    message: 'Пояснение принадлежит другому шагу: ' + body.text,
                  },
                ]
              : [];
          }),
        );
        return schema.parse({ issues, coverage: [] });
      },
    };
    const provider = () =>
      new SemanticTextProvider(
        new CheckpointTextProvider(raw, new TaskCheckpoints(directory, 'immutable')),
      );
    const semantics = compositionSemantics(pattern, note);
    const input = (swapped = false) => ({
      brief,
      approvedOutline: null,
      proposedOutline: null,
      slides: [
        {
          slideIndex: 0,
          approvedSlide: null,
          requiredClaims: claims,
          groups: semantics.groups,
          speakerNotes: '',
          visual: null,
          texts: facts.flatMap(([heading, body], index) => [
            {
              ...semantics.slots.find((slot) => slot.slotId === `h${index}`),
              slotId: `h${index}`,
              text: swapped && index >= 2 ? required(facts[index === 2 ? 3 : 2])[0] : heading,
            },
            {
              ...semantics.slots.find((slot) => slot.slotId === `b${index}`),
              slotId: `b${index}`,
              text: swapped && index <= 1 ? required(facts[index === 0 ? 1 : 0])[1] : body,
            },
          ]),
        },
      ],
    });
    const generate = (
      data: unknown,
      instructions = 'critic-v1',
      schema = compositionCritiqueSchema,
    ) => provider().generate('critic', instructions, data, schema, new AbortController().signal);
    expect((await generate(input())).issues).toEqual([]);
    const broken = await generate(input(true));
    expect(broken.issues).toHaveLength(4);
    expect(sends).toBe(2);
    expect(broken.issues.map((issue) => issue.slotId).sort()).toEqual(['b0', 'b1', 'b2', 'b3']);
    expect((await generate(input())).issues).toEqual([]);
    expect(sends).toBe(2);
    await generate(input(), 'critic-v2');
    expect(sends).toBe(3);
    const changedSource = input();
    changedSource.brief += '\nНовое условие.';
    await generate(changedSource);
    expect(sends).toBe(4);
    await provider().generate(
      'critic',
      'critic-v1',
      input(),
      compositionCritiqueSchema.extend({ marker: z.string().default('v2') }),
      new AbortController().signal,
    );
    expect(sends).toBe(5);
  });
});
