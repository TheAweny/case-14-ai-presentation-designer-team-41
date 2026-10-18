import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generationRequestSchema, type ChatMessage } from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import { canonicalPlanHash } from './deck-inspection.js';
import { inspectionTools, type InspectionGeneration } from './inspection-tools.js';

const DECK = 'run-00000000-0000-4000-8000-0000000000b1';
const TEMPLATE = '00000000-0000-4000-8000-000000000011';
const BUILD = '00000000-0000-4000-8000-0000000000c1';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

function context(): ToolContext {
  return {
    callId: 'c',
    signal: new AbortController().signal,
    show: () => 0,
    update: () => undefined,
  };
}

function profile() {
  const fixturePath = join(
    import.meta.dirname,
    '../../../../packages/contracts/fixtures/GenerationProfile.json',
  );
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    valid: Array<{ payload: unknown }>;
  };
  const payload = fixture.valid[0]?.payload;
  if (!payload) throw new Error('fixture has no payload');
  return payload;
}

function messages(deck = true): ChatMessage[] {
  const parts: ChatMessage[] = [];
  if (deck) {
    parts.push({
      role: 'assistant',
      id: 'result',
      status: 'done',
      createdAt: 1,
      parts: [
        {
          type: 'result',
          buildId: BUILD,
          variants: [{ variant: 'balanced', deckId: DECK }],
          reviews: null,
          recommended: 'balanced',
          elapsedMs: 1,
        },
      ],
    });
  }
  return parts;
}

function buildMessage(variantRunIds: string[]): ChatMessage {
  return {
    role: 'assistant',
    id: 'build',
    status: 'done',
    createdAt: 2,
    parts: [
      {
        type: 'build',
        callId: 'build',
        buildId: BUILD,
        planId: null,
        planRevision: null,
        templateId: TEMPLATE,
        templateName: 'Template',
        runId: variantRunIds[0] ?? null,
        variantRunIds,
        startedAt: 1,
        finishedAt: 2,
        status: 'failed',
        error: 'engine down',
      },
    ],
  };
}

function generation(options?: {
  visible?: (id: string) => boolean;
  state?: string | null;
  running?: boolean;
  findings?: unknown[];
}): InspectionGeneration & { start: ReturnType<typeof vi.fn> } {
  const visible = options?.visible ?? (() => true);
  const check = vi.fn(async () => ({ schemaVersion: 1, findings: options?.findings ?? [] }));
  return {
    directory: (id: string) => join(roots[0] ?? '', id),
    isRunning: () => options?.running ?? false,
    library: { visible: vi.fn(async (id: string) => visible(id)) },
    repository: {
      get: vi.fn(async () =>
        options?.state === null || options?.state === undefined
          ? { state: options?.state ?? 'done' }
          : { state: options.state },
      ),
    },
    template: vi.fn(async () => ({
      storage_path: 'C:/templates/deck.pptx',
      profile: { generation: profile() },
    })),
    engine: { checkCompositions: check },
    start: vi.fn(),
  };
}

async function savedDeck() {
  const root = await mkdtemp(join(tmpdir(), 'inspection-tools-'));
  roots.push(root);
  const directory = join(root, DECK);
  await mkdir(join(directory, 'previews'), { recursive: true });
  const slide = {
    patternId: 'layout',
    texts: [{ slotId: 'body', text: 'Fact one is on the slide' }],
    speakerNotes: '',
  };
  const plan = [{ index: 0, slide }];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const manifestFixtures = JSON.parse(
    await readFile(
      join(import.meta.dirname, '../../../../packages/contracts/fixtures/ArtifactManifest.json'),
      'utf8',
    ),
  ) as { valid: Array<{ payload: Record<string, unknown> }> };
  const payload = manifestFixtures.valid[0]?.payload;
  if (!payload) throw new Error('Missing manifest fixture');
  await writeFile(join(directory, 'plan.json'), JSON.stringify(plan));
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      ...payload,
      runId: DECK,
      contentHash: canonicalPlanHash(plan),
      artifacts: [
        {
          kind: 'preview',
          variant: 'balanced',
          path: 'previews/slide-01.png',
          bytes: png.length,
          sha256: createHash('sha256').update(png).digest('hex'),
        },
      ],
    }),
  );
  await writeFile(join(directory, 'previews/slide-01.png'), png);
  const request = generationRequestSchema.parse({
    templateId: TEMPLATE,
    brief: 'Approved brief for inspection.',
    outline: null,
  });
  await writeFile(join(directory, 'request.json'), JSON.stringify(request));
  return { root, directory, plan };
}

function tools(gen: InspectionGeneration, chat: ChatMessage[]) {
  return inspectionTools(gen, {
    account: { id: 'owner', role: 'user' } as Account,
    chatId: 'chat',
    projectId: null,
    mode: 'chat',
    model: null,
    messages: () => chat,
    updatePart: () => undefined,
    addDecks: () => undefined,
  });
}

describe('inspection tools', () => {
  it('does not read a deck that is not in this chat or not finished', async () => {
    const hidden = generation();
    const denied = tools(hidden, []).find((tool) => tool.name === 'preview_slide');
    await expect(denied?.run({ deckId: DECK, slideIndex: 1 }, context())).rejects.toThrow(/chat/);
    expect(hidden.repository.get).not.toHaveBeenCalled();
    expect(hidden.start).not.toHaveBeenCalled();

    await savedDeck();
    const unfinished = generation({ state: 'running' });
    const preview = tools(unfinished, messages()).find((tool) => tool.name === 'preview_slide');
    await expect(preview?.run({ deckId: DECK, slideIndex: 1 }, context())).rejects.toThrow(
      /finished/,
    );
    expect(unfinished.start).not.toHaveBeenCalled();
  });

  it('returns saved preview metadata only after the run is done', async () => {
    await savedDeck();
    const gen = generation({ state: 'done' });
    const preview = tools(gen, messages()).find((tool) => tool.name === 'preview_slide');
    const result = await preview?.run({ deckId: DECK, slideIndex: 1 }, context());
    expect(result?.output).toMatchObject({
      fileName: 'slide-01.png',
      savedBuild: true,
      liveEditorDraft: false,
      visionAssessment: false,
    });
    expect(gen.start).not.toHaveBeenCalled();
  });

  it('pages composition findings without writing a deck or starting a build', async () => {
    const saved = await savedDeck();
    const findings = Array.from({ length: 7 }, (_, index) => ({
      slideIndex: 0,
      slotId: 'body',
      code: 'overflow',
      severity: 'warning',
      lines: 4,
      maxLines: 2,
      maxChars: 40,
      message: 'row ' + String(index),
    }));
    const gen = generation({ findings });
    const before = await readFile(join(saved.directory, 'plan.json'), 'utf8');
    const fit = tools(gen, messages()).find((tool) => tool.name === 'check_slide_fit');
    const result = await fit?.run({ deckId: DECK, slideIndex: 1 }, context());
    expect(gen.engine.checkCompositions).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: 1,
        templatePath: 'C:/templates/deck.pptx',
        outputPath: join(saved.directory, 'inspection-unused.pptx'),
        slides: [expect.objectContaining({ patternId: 'layout' })],
      }),
      expect.anything(),
    );
    expect(result?.output).toMatchObject({
      contentHash: canonicalPlanHash(JSON.parse(before)),
      savedBuild: true,
      liveEditorDraft: false,
      slideIndex: 1,
      offset: 0,
      nextOffset: 5,
      totalFindings: 7,
    });
    const page = (result?.output as { findings: Array<{ slideIndex: number }> }).findings;
    expect(page).toHaveLength(5);
    expect(page.every((finding) => finding.slideIndex === 0)).toBe(true);
    const next = await fit?.run({ deckId: DECK, slideIndex: 1, offset: 5 }, context());
    expect(next?.output).toMatchObject({ offset: 5, nextOffset: null, totalFindings: 7 });
    expect((next?.output as { findings: unknown[] }).findings).toHaveLength(2);
    expect(await readFile(join(saved.directory, 'plan.json'), 'utf8')).toBe(before);
    await expect(readFile(join(saved.directory, 'inspection-unused.pptx'))).rejects.toThrow();
    expect(gen.start).not.toHaveBeenCalled();
  });

  it('reports the second saved slide as finding index 1', async () => {
    const saved = await savedDeck();
    const plan = JSON.parse(await readFile(join(saved.directory, 'plan.json'), 'utf8')) as Array<{
      index: number;
      slide: unknown;
    }>;
    plan.push({ index: 1, slide: plan[0]?.slide });
    await writeFile(join(saved.directory, 'plan.json'), JSON.stringify(plan));
    const gen = generation({
      findings: [
        {
          slideIndex: 0,
          slotId: 'body',
          code: 'overflow',
          severity: 'warning',
          lines: 2,
          maxLines: 1,
          maxChars: 10,
          message: 'second',
        },
      ],
    });
    const fit = tools(gen, messages()).find((tool) => tool.name === 'check_slide_fit');
    const result = await fit?.run({ deckId: DECK, slideIndex: 2, limit: 1 }, context());
    expect(result?.output).toMatchObject({
      slideIndex: 2,
      offset: 0,
      nextOffset: null,
      totalFindings: 1,
      findings: [expect.objectContaining({ slideIndex: 1 })],
    });
    expect(gen.start).not.toHaveBeenCalled();
  });

  it('rejects a finding row that does not fit in the result', async () => {
    await savedDeck();
    const gen = generation({
      findings: [
        {
          slideIndex: 0,
          slotId: 'body',
          code: 'overflow',
          severity: 'error',
          lines: 1,
          maxLines: 1,
          maxChars: 1,
          message: 'x'.repeat(11_000),
        },
      ],
    });
    const fit = tools(gen, messages()).find((tool) => tool.name === 'check_slide_fit');
    await expect(fit?.run({ deckId: DECK, slideIndex: 1, limit: 1 }, context())).rejects.toThrow(
      /10000/,
    );
    expect(gen.start).not.toHaveBeenCalled();
  });

  it('reports unknown coverage when the outline is not an approved user outline', async () => {
    const saved = await savedDeck();
    const model = generationRequestSchema.parse({
      templateId: TEMPLATE,
      brief: 'Approved brief for inspection.',
      outlineSource: 'model',
      outline: {
        title: 'Story',
        audience: '',
        goal: '',
        slides: Array.from({ length: 10 }, () => ({
          title: 'Fact one',
          points: ['Fact one'],
          kind: 'other',
        })),
      },
    });
    await writeFile(join(saved.directory, 'request.json'), JSON.stringify(model));
    const gen = generation();
    const coverage = tools(gen, messages()).find((tool) => tool.name === 'check_content_coverage');
    const result = await coverage?.run({ deckId: DECK, slideIndex: 1 }, context());
    expect(result?.output).toMatchObject({
      status: 'unknown',
      reason: 'no approved requirements',
      sourceFactChecking: false,
      contentHash: canonicalPlanHash(saved.plan),
      contentRevision: null,
      savedBuild: true,
      liveEditorDraft: false,
    });
    expect(gen.start).not.toHaveBeenCalled();
  });

  it('checks user outline facts against the saved slide', async () => {
    const saved = await savedDeck();
    const user = generationRequestSchema.parse({
      templateId: TEMPLATE,
      brief: 'Approved brief for inspection.',
      outlineSource: 'user',
      outline: {
        title: 'Story',
        audience: '',
        goal: '',
        slides: Array.from({ length: 10 }, (_, index) => ({
          title: index === 0 ? 'Fact one' : 'Later',
          points: ['Fact one'],
          kind: 'other',
        })),
      },
    });
    await writeFile(join(saved.directory, 'request.json'), JSON.stringify(user));
    const gen = generation();
    const coverage = tools(gen, messages()).find((tool) => tool.name === 'check_content_coverage');
    const result = await coverage?.run({ deckId: DECK, slideIndex: 1 }, context());
    expect(result?.output).toMatchObject({
      status: 'covered',
      sourceFactChecking: false,
      contentRevision: null,
      savedBuild: true,
      liveEditorDraft: false,
    });
    expect(gen.start).not.toHaveBeenCalled();
  });

  it('reads build status only for a build in this chat and never starts one', async () => {
    const missing = generation();
    const absent = tools(missing, [buildMessage([DECK])]).find(
      (tool) => tool.name === 'read_build_status',
    );
    await expect(
      absent?.run({ buildId: '00000000-0000-4000-8000-0000000000ff' }, context()),
    ).rejects.toThrow(/chat/);
    expect(missing.repository.get).not.toHaveBeenCalled();

    const crowded = generation();
    const tooMany = tools(crowded, [buildMessage(['a', 'b', 'c', 'd'])]).find(
      (tool) => tool.name === 'read_build_status',
    );
    await expect(tooMany?.run({ buildId: BUILD }, context())).rejects.toThrow(/three/);
    expect(crowded.repository.get).not.toHaveBeenCalled();
    expect(crowded.library.visible).not.toHaveBeenCalled();

    const foreign = generation({ visible: () => false });
    const denied = tools(foreign, [buildMessage([DECK])]).find(
      (tool) => tool.name === 'read_build_status',
    );
    await expect(denied?.run({ buildId: BUILD }, context())).rejects.toThrow(/chat/);
    expect(foreign.repository.get).not.toHaveBeenCalled();
    expect(foreign.start).not.toHaveBeenCalled();

    const owned = generation({ state: 'failed', running: true });
    const status = tools(owned, [buildMessage([DECK])]).find(
      (tool) => tool.name === 'read_build_status',
    );
    const result = await status?.run({ buildId: BUILD }, context());
    expect(result?.output).toEqual({
      buildId: BUILD,
      status: 'failed',
      error: 'engine down',
      variants: [{ runId: DECK, state: 'failed', running: true }],
    });
    expect(result?.output).not.toHaveProperty('events');
    expect(owned.start).not.toHaveBeenCalled();
  });

  it('does not touch the repository when the turn is already aborted', async () => {
    const gen = generation();
    const aborted = new AbortController();
    aborted.abort();
    const ctx = { ...context(), signal: aborted.signal };
    const ready = tools(gen, messages());
    for (const name of [
      'preview_slide',
      'check_slide_fit',
      'check_content_coverage',
      'read_build_status',
    ]) {
      const tool = ready.find((item) => item.name === name);
      const input =
        name === 'read_build_status' ? { buildId: BUILD } : { deckId: DECK, slideIndex: 1 };
      await expect(tool?.run(input, ctx)).rejects.toThrow(/abort/i);
    }
    expect(gen.repository.get).not.toHaveBeenCalled();
    expect(gen.library.visible).not.toHaveBeenCalled();
    expect(gen.engine.checkCompositions).not.toHaveBeenCalled();
    expect(gen.start).not.toHaveBeenCalled();
  });
});
