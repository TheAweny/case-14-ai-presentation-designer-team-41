import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generationRequestSchema,
  slideIrSchema,
  type EditorSnapshot,
  type ChatMessage,
} from '@lct/contracts';
import type { ToolContext } from '@lct/pipeline';
import type { Account } from '../accounts/account-rules.js';
import { canonicalPlanHash } from './deck-inspection.js';
import {
  inspectionTools,
  type InspectionGeneration,
  type InspectionDependency,
} from './inspection-tools.js';

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
    texts: [{ slotId: 'body', text: 'Fact one' }],
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

function tools(
  gen: InspectionGeneration,
  chat: ChatMessage[],
  inspection: InspectionDependency = {
    loadSnapshot: async () => ({ schemaVersion: 1, snapshot: null }),
  },
) {
  return inspectionTools(
    gen,
    {
      account: { id: 'owner', role: 'user' } as Account,
      chatId: 'chat',
      projectId: null,
      mode: 'chat',
      model: null,
      messages: () => chat,
      updatePart: () => undefined,
      addDecks: () => undefined,
    },
    inspection,
  );
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

function snapshot(text: string, revision = 1): EditorSnapshot {
  const slide = slideIrSchema.parse({
    schemaVersion: 1,
    slideId: 'imported-1',
    variant: 'balanced',
    index: 0,
    patternId: 'unfamiliar-layout',
    slideCx: 12192000,
    slideCy: 6858000,
    notes: 'Fact one only in notes does not count',
    elements: [
      {
        kind: 'text',
        elementId: 'body',
        role: 'body',
        box: { x: 1000000, y: 1000000, cx: 5000000, cy: 1000000 },
        sourceShapeId: null,
        paragraphs: [
          {
            level: 0,
            lineSpacing: null,
            runs: [
              {
                text,
                font: '',
                sizePt: null,
                bold: null,
                italic: null,
                color: '',
              },
            ],
          },
        ],
        overflow: { lines: 99, emu: 1000000 },
      },
    ],
  });
  return {
    schemaVersion: 1,
    deckId: DECK,
    revision,
    base: 'original-base',
    savedAt: '2026-10-20T10:00:00.000Z',
    contentSha256: canonicalPlanHash([slide]),
    slides: [slide],
    media: [],
  };
}

async function approvedRequest(directory: string) {
  await writeFile(
    join(directory, 'request.json'),
    JSON.stringify(
      generationRequestSchema.parse({
        templateId: TEMPLATE,
        brief: 'Approved brief for inspection.',
        outlineSource: 'user',
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
      }),
    ),
  );
}

describe('saved editor revision inspection', () => {
  it('reads saved text changes for coverage and audits the current IR without stale overflow', async () => {
    const saved = await savedDeck();
    await approvedRequest(saved.directory);
    let head = snapshot('Fact one');
    const loadSnapshot = vi.fn(async (_deckId: string, account: Account) => {
      expect(account.id).toBe('owner');
      return { schemaVersion: 1 as const, snapshot: head };
    });
    const gen = generation();
    const ready = tools(gen, messages(), { loadSnapshot });
    const coverage = ready.find((tool) => tool.name === 'check_content_coverage');
    const fit = ready.find((tool) => tool.name === 'check_slide_fit');
    const input = { deckId: DECK, slideIndex: 1 };
    const before = await coverage?.run(input, context());
    expect(before?.output).toMatchObject({
      status: 'covered',
      source: 'server-snapshot',
      contentRevision: 1,
    });
    const clean = await fit?.run(input, context());
    expect(clean?.output).toMatchObject({ textFit: 'unknown', contentRevision: 1 });
    expect(
      (clean?.output as { findings: { checkId: string }[] }).findings.some(
        (f) => f.checkId === 'text-overflow',
      ),
    ).toBe(false);
    head = snapshot('Different current saved text', 2);
    const after = await coverage?.run(input, context());
    expect(after?.output).toMatchObject({
      status: 'requires-review',
      coveredCount: 0,
      contentRevision: 2,
      contentHash: head.contentSha256,
    });
    expect((after?.output as { cacheKey: string }).cacheKey).not.toBe(
      (before?.output as { cacheKey: string }).cacheKey,
    );
    // Blank current copy changes audit findings, even though the original plan is unchanged.
    head = snapshot(' ', 3);
    const editedFit = await fit?.run(input, context());
    expect(editedFit?.output).toMatchObject({
      textFit: 'unknown',
      contentRevision: 3,
      findings: expect.arrayContaining([expect.objectContaining({ checkId: 'placeholder-text' })]),
    });
    expect(gen.engine.checkCompositions).not.toHaveBeenCalled();
    expect(gen.start).not.toHaveBeenCalled();
  });

  it('rejects stale expected revision/hash and a revision changed while checking', async () => {
    await savedDeck();
    const head = snapshot('Saved', 2);
    const loadSnapshot = vi.fn(async () => ({ schemaVersion: 1 as const, snapshot: head }));
    const gen = generation();
    for (const name of ['preview_slide', 'check_slide_fit', 'check_content_coverage']) {
      const tool = tools(gen, messages(), { loadSnapshot }).find((tool) => tool.name === name);
      await expect(
        tool?.run({ deckId: DECK, slideIndex: 1, expectedRevision: 1 }, context()),
      ).rejects.toMatchObject({ code: 'stale_revision' });
      await expect(
        tool?.run({ deckId: DECK, slideIndex: 1, expectedContentHash: '0'.repeat(64) }, context()),
      ).rejects.toMatchObject({ code: 'stale_revision' });
      const raced = vi
        .fn()
        .mockResolvedValueOnce({ schemaVersion: 1, snapshot: head })
        .mockResolvedValue({ schemaVersion: 1, snapshot: snapshot('New head', 3) });
      const racingTool = tools(gen, messages(), { loadSnapshot: raced }).find(
        (tool) => tool.name === name,
      );
      await expect(
        racingTool?.run({ deckId: DECK, slideIndex: 1 }, context()),
      ).rejects.toMatchObject({ code: 'stale_revision' });
    }
    expect(gen.engine.checkCompositions).not.toHaveBeenCalled();
  });

  it('does not access snapshot storage for a foreign account, and does not swallow storage denial', async () => {
    const loadSnapshot = vi.fn(async () => {
      throw new Error('snapshot forbidden');
    });
    for (const name of ['preview_slide', 'check_slide_fit', 'check_content_coverage']) {
      const gen = generation({ visible: () => false });
      const tool = tools(gen, messages(), { loadSnapshot }).find((tool) => tool.name === name);
      await expect(tool?.run({ deckId: DECK, slideIndex: 1 }, context())).rejects.toThrow(/chat/);
    }
    expect(loadSnapshot).not.toHaveBeenCalled();
    await savedDeck();
    const tool = tools(generation(), messages(), { loadSnapshot }).find(
      (tool) => tool.name === 'check_content_coverage',
    );
    await expect(tool?.run({ deckId: DECK, slideIndex: 1 }, context())).rejects.toThrow(
      'snapshot forbidden',
    );
  });

  it('uses the original only when snapshot is absent or explicitly requested', async () => {
    await savedDeck();
    const gen = generation();
    const absent = vi.fn(async () => ({ schemaVersion: 1 as const, snapshot: null }));
    const tool = tools(gen, messages(), { loadSnapshot: absent }).find(
      (tool) => tool.name === 'check_slide_fit',
    );
    expect(
      (await tool?.run({ deckId: DECK, slideIndex: 1, expectedRevision: 0 }, context()))?.output,
    ).toMatchObject({
      source: 'original',
      sourceReason: 'no-saved-snapshot',
      contentRevision: null,
    });
    expect(absent).toHaveBeenCalledTimes(2);
    const present = vi.fn(async () => ({ schemaVersion: 1 as const, snapshot: snapshot('Saved') }));
    const original = tools(gen, messages(), { loadSnapshot: present }).find(
      (tool) => tool.name === 'check_slide_fit',
    );
    expect(
      (await original?.run({ deckId: DECK, slideIndex: 1, source: 'original' }, context()))?.output,
    ).toMatchObject({ source: 'original', sourceReason: 'explicit-original' });
    expect(present).not.toHaveBeenCalled();
    const unwired = inspectionTools(gen, {
      account: { id: 'owner' } as Account,
      messages: () => messages(),
      chatId: 'chat',
      projectId: null,
      mode: 'chat',
      model: null,
      updatePart: () => undefined,
      addDecks: () => undefined,
    });
    await expect(
      unwired
        .find((tool) => tool.name === 'check_slide_fit')
        ?.run({ deckId: DECK, slideIndex: 1 }, context()),
    ).rejects.toMatchObject({ code: 'snapshot_unavailable' });
  });

  it('rejects a snapshot appearing while the original is checked', async () => {
    await savedDeck();
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ schemaVersion: 1, snapshot: null })
      .mockResolvedValue({ schemaVersion: 1, snapshot: snapshot('Saved') });
    const fit = tools(generation(), messages(), { loadSnapshot }).find(
      (tool) => tool.name === 'check_slide_fit',
    );
    await expect(fit?.run({ deckId: DECK, slideIndex: 1 }, context())).rejects.toMatchObject({
      code: 'stale_revision',
    });
  });

  it('returns not-rendered instead of the original PNG, or the exact exported revision preview', async () => {
    const saved = await savedDeck();
    const head = snapshot('Saved', 3);
    const dependency = {
      loadSnapshot: async () => ({ schemaVersion: 1 as const, snapshot: head }),
    };
    const preview = tools(generation(), messages(), dependency).find(
      (tool) => tool.name === 'preview_slide',
    );
    const input = { deckId: DECK, slideIndex: 1 };
    const missing = await preview?.run(input, context());
    expect(missing?.output).toMatchObject({
      status: 'not-rendered',
      source: 'server-snapshot',
      contentRevision: 3,
      visionAssessment: false,
    });
    expect(missing?.output).not.toHaveProperty('url');
    const exportId = '00000000-0000-4000-8000-0000000000aa';
    const directory = join(saved.directory, 'exports', exportId);
    await mkdir(join(directory, 'previews'), { recursive: true });
    // A subset export may give this slide a different PNG ordinal.
    await writeFile(
      join(directory, 'previews/slide-02.png'),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const manifest = {
      revision: head.revision,
      contentSha256: head.contentSha256,
      slideIds: ['other-slide', head.slides[0]?.slideId],
    };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, revision: 2 }));
    expect((await preview?.run(input, context()))?.output).toMatchObject({
      status: 'not-rendered',
    });
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    expect((await preview?.run(input, context()))?.output).toMatchObject({
      status: 'rendered',
      contentRevision: 3,
      fileName: 'slide-02.png',
      url: `/api/backend/editor/decks/${DECK}/exports/${exportId}/slide-02.png`,
    });
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({ ...manifest, contentSha256: '0'.repeat(64) }),
    );
    expect((await preview?.run(input, context()))?.output).toMatchObject({
      status: 'not-rendered',
    });
  });
});

describe('snapshot evidence safeguards', () => {
  it('rejects malformed, mismatched or ambiguous snapshot provenance without falling back', async () => {
    await savedDeck();
    const valid = snapshot('Saved');
    const invalid = [
      { ...valid, deckId: 'run-00000000-0000-4000-8000-0000000000ff' },
      { ...valid, contentSha256: '0'.repeat(64) },
      { ...valid, slides: [...valid.slides, ...valid.slides] },
    ];
    for (const head of invalid) {
      const tool = tools(generation(), messages(), {
        loadSnapshot: async () => ({ schemaVersion: 1, snapshot: head }),
      }).find((tool) => tool.name === 'check_content_coverage');
      await expect(tool?.run({ deckId: DECK, slideIndex: 1 }, context())).rejects.toMatchObject({
        code: 'invalid_snapshot',
      });
    }
  });

  it('uses stable identity after reorder and returns unknown for a newly inserted slide', async () => {
    const saved = await savedDeck();
    await approvedRequest(saved.directory);
    const base = JSON.parse(await readFile(join(saved.directory, 'request.json'), 'utf8'));
    base.outline.slides[0] = { title: 'First original', points: ['First original'], kind: 'other' };
    base.outline.slides[1] = {
      title: 'Second original',
      points: ['Second original'],
      kind: 'other',
    };
    await writeFile(join(saved.directory, 'request.json'), JSON.stringify(base));
    let head = snapshot('Second original');
    const first = head.slides[0];
    if (!first) throw new Error('No slide fixture');
    first.slideId = 'imported-2';
    head.contentSha256 = canonicalPlanHash(head.slides);
    const dependency = {
      loadSnapshot: async () => ({ schemaVersion: 1 as const, snapshot: head }),
    };
    const tool = tools(generation(), messages(), dependency).find(
      (tool) => tool.name === 'check_content_coverage',
    );
    expect((await tool?.run({ deckId: DECK, slideIndex: 1 }, context()))?.output).toMatchObject({
      status: 'covered',
      requirementsSlideIndex: 2,
    });
    head = snapshot('First original', 2);
    const inserted = head.slides[0];
    if (!inserted) throw new Error('No slide fixture');
    inserted.slideId = 'new-slide-editor-id';
    head.contentSha256 = canonicalPlanHash(head.slides);
    expect((await tool?.run({ deckId: DECK, slideIndex: 1 }, context()))?.output).toMatchObject({
      status: 'unknown',
      reason: 'unknown original slide identity',
      requirementsSlideIndex: null,
    });
  });

  it('audits changed geometry and ignores an unsaved draft passed alongside the tool input', async () => {
    const saved = await savedDeck();
    await approvedRequest(saved.directory);
    const head = snapshot('Fact one');
    const first = head.slides[0]?.elements[0];
    if (!first) throw new Error('No element fixture');
    first.box.x = 20000000;
    head.contentSha256 = canonicalPlanHash(head.slides);
    const gen = generation();
    const dependency = {
      loadSnapshot: async () => ({ schemaVersion: 1 as const, snapshot: head }),
    };
    const tool = tools(gen, messages(), dependency).find((tool) => tool.name === 'check_slide_fit');
    expect(
      (await tool?.run({ deckId: DECK, slideIndex: 1, draft: snapshot('Local only') }, context()))
        ?.output,
    ).toMatchObject({
      source: 'server-snapshot',
      liveEditorDraft: false,
      textFit: 'unknown',
      findings: expect.arrayContaining([expect.objectContaining({ checkId: 'off-slide' })]),
    });
    expect(gen.engine.checkCompositions).not.toHaveBeenCalled();
  });
});
