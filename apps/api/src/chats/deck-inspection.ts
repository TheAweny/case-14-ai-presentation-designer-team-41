import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import {
  artifactManifestSchema,
  composedSlideSchema,
  editorSnapshotLoadSchema,
  designSystemSchema,
  generationRequestSchema,
  type ArtifactManifest,
  type ComposedSlide,
  type DeckOutline,
  type EditorSnapshotLoad,
  type SlideIr,
  type DesignSystem,
} from '@lct/contracts';
import { z } from 'zod';

const DECK_ID = /^[a-zA-Z0-9-]{1,80}$/;
const PREVIEW_FILE = /^slide-(\d+)\.png$/;

const savedPlanSchema = z.array(
  z.object({
    index: z.number().int().nonnegative(),
    slide: composedSlideSchema,
    title: z.string().optional(),
  }),
);

export class DeckInspectionError extends Error {
  readonly code:
    | 'invalid_path'
    | 'invalid_snapshot'
    | 'snapshot_unavailable'
    | 'stale_revision'
    | 'invalid_plan'
    | 'invalid_request'
    | 'invalid_manifest'
    | 'slide_out_of_bounds'
    | 'missing_preview'
    | 'unknown_preview'
    | 'stale_preview';

  constructor(
    code:
      | 'invalid_path'
      | 'invalid_snapshot'
      | 'snapshot_unavailable'
      | 'stale_revision'
      | 'invalid_plan'
      | 'invalid_request'
      | 'invalid_manifest'
      | 'slide_out_of_bounds'
      | 'missing_preview'
      | 'unknown_preview'
      | 'stale_preview',
    message: string,
  ) {
    super(message);
    this.name = 'DeckInspectionError';
    this.code = code;
  }
}

export type SavedDeckRef = { root: string; deckId: string };

export type InspectionSelection = {
  source?: 'saved' | 'original';
  expectedRevision?: number;
  expectedContentHash?: string;
};
export type InspectionRead = {
  source: 'server-snapshot' | 'original';
  sourceReason: 'saved-snapshot' | 'explicit-original' | 'no-saved-snapshot';
  contentRevision: number | null;
  contentHash: string;
  savedBuild: true;
  liveEditorDraft: false;
  cacheKey: string;
  slideCount: number;
} & ({ source: 'server-snapshot'; slide: SlideIr } | { source: 'original'; slide: ComposedSlide });

/** The closure must use EditorService.load(deckId, account), never a client draft. */
export async function readInspectionSlide(
  ref: SavedDeckRef & { slideIndex: number },
  selection: InspectionSelection,
  loadSnapshot?: () => Promise<EditorSnapshotLoad>,
): Promise<{ read: InspectionRead; assertCurrent(): Promise<void> }> {
  slideOrdinal(ref.slideIndex);
  const explicitOriginal = selection.source === 'original';
  if (!explicitOriginal && !loadSnapshot) {
    fail(
      'snapshot_unavailable',
      'Saved snapshot reader is unavailable; original requires source=original.',
    );
  }
  const load = async () => {
    if (!loadSnapshot) return null;
    const parsed = editorSnapshotLoadSchema.safeParse(await loadSnapshot());
    if (!parsed.success) fail('invalid_snapshot', 'The server snapshot does not pass its schema.');
    const snapshot = parsed.data.snapshot;
    if (snapshot && snapshot.deckId !== ref.deckId) {
      fail('invalid_snapshot', 'The snapshot belongs to another deck.');
    }
    if (snapshot) {
      const ids = new Set(snapshot.slides.map((slide) => slide.slideId));
      const indexes = new Set(snapshot.slides.map((slide) => slide.index));
      if (ids.size !== snapshot.slides.length || indexes.size !== snapshot.slides.length) {
        fail('invalid_snapshot', 'Snapshot slide identities are ambiguous.');
      }
      if (canonicalPlanHash(snapshot.slides) !== snapshot.contentSha256) {
        fail('invalid_snapshot', 'Snapshot content does not match its stored hash.');
      }
    }
    return snapshot;
  };
  const snapshot = explicitOriginal ? null : await load();
  const revision = snapshot?.revision ?? null;
  if (selection.expectedRevision !== undefined && selection.expectedRevision !== (revision ?? 0)) {
    fail(
      'stale_revision',
      `Expected revision ${selection.expectedRevision}; current revision ${revision ?? 0}. Read again.`,
    );
  }
  const original = snapshot ? null : await readSavedPlan(ref);
  const ordinal = slideOrdinal(ref.slideIndex);
  const common = { savedBuild: true, liveEditorDraft: false } as const;
  let read: InspectionRead;
  if (snapshot) {
    const slide = snapshot.slides[ordinal];
    if (!slide) fail('slide_out_of_bounds', 'No slide at this position in the saved snapshot.');
    read = {
      ...common,
      source: 'server-snapshot',
      sourceReason: 'saved-snapshot',
      slide,
      contentRevision: snapshot.revision,
      contentHash: snapshot.contentSha256,
      cacheKey: `${ref.deckId}:snapshot:${snapshot.revision}:${snapshot.contentSha256}:${slide.slideId}`,
      slideCount: snapshot.slides.length,
    };
  } else {
    const found = original?.plan.find((item) => item.index === ordinal);
    if (!found || !original)
      fail('slide_out_of_bounds', 'No slide at this position in the original plan.');
    read = {
      ...common,
      source: 'original',
      sourceReason: explicitOriginal ? 'explicit-original' : 'no-saved-snapshot',
      slide: found.slide,
      contentRevision: null,
      contentHash: original.planHash,
      cacheKey: `${ref.deckId}:original:${original.planHash}:${ordinal}`,
      slideCount: original.plan.length,
    };
  }
  if (
    selection.expectedContentHash !== undefined &&
    selection.expectedContentHash !== read.contentHash
  ) {
    fail('stale_revision', 'Expected content hash differs from saved content. Read again.');
  }
  return {
    read,
    async assertCurrent() {
      if (!explicitOriginal) {
        const head = await load();
        if (
          (head?.revision ?? null) !== revision ||
          (head?.contentSha256 ?? null) !== (snapshot?.contentSha256 ?? null)
        ) {
          fail('stale_revision', 'Saved revision changed during inspection. Read and check again.');
        }
      }
      if (original && (await readSavedPlan(ref)).planHash !== original.planHash) {
        fail('stale_revision', 'Original plan changed during inspection. Read and check again.');
      }
    },
  };
}

export function inspectionProvenance(read: InspectionRead) {
  return {
    source: read.source,
    sourceReason: read.sourceReason,
    contentRevision: read.contentRevision,
    contentHash: read.contentHash,
    cacheKey: read.cacheKey,
    savedBuild: read.savedBuild,
    liveEditorDraft: read.liveEditorDraft,
    slideCount: read.slideCount,
  };
}

export async function readInspectionDesignSystem(ref: SavedDeckRef): Promise<DesignSystem | null> {
  const deck = await readJson(deckDirectory(ref.root, ref.deckId), 'deck.json');
  const parsed = z.object({ designSystem: designSystemSchema }).safeParse(deck);
  return parsed.success ? parsed.data.designSystem : null;
}

/** Only a published revision export can prove a PNG represents the editor snapshot. */
export async function readSnapshotPreview(
  ref: SavedDeckRef,
  read: InspectionRead & { source: 'server-snapshot' },
): Promise<unknown> {
  const exportsDir = join(deckDirectory(ref.root, ref.deckId), 'exports');
  const notRendered = {
    status: 'not-rendered',
    reason: 'No published PNG for this saved revision.',
    visionAssessment: false,
  };
  let exports: string[];
  try {
    exports = await readdir(exportsDir);
  } catch {
    return notRendered;
  }
  for (const exportId of exports.sort()) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(exportId)) continue;
    const directory = join(exportsDir, exportId);
    const manifest = z
      .object({
        revision: z.number().int().positive(),
        contentSha256: z.string(),
        slideIds: z.array(z.string()),
      })
      .safeParse(await readJson(directory, 'manifest.json'));
    if (
      !manifest.success ||
      manifest.data.revision !== read.contentRevision ||
      manifest.data.contentSha256 !== read.contentHash
    )
      continue;
    const position = manifest.data.slideIds.indexOf(read.slide.slideId);
    if (position < 0 || manifest.data.slideIds.lastIndexOf(read.slide.slideId) !== position)
      continue;
    let names: string[];
    try {
      names = await readdir(join(directory, 'previews'));
    } catch {
      continue;
    }
    const matches = names.filter((name) => previewNumber(name) === position + 1);
    const fileName = matches[0];
    if (matches.length !== 1 || !fileName) continue;
    let bytes: Buffer;
    try {
      bytes = await readFile(join(directory, 'previews', fileName));
    } catch {
      continue;
    }
    if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) continue;
    return {
      status: 'rendered',
      url: `/api/backend/editor/decks/${ref.deckId}/exports/${exportId}/${fileName}`,
      exportId,
      fileName,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      visionAssessment: false,
    };
  }
  return notRendered;
}

export type SavedPreview = {
  url: string;
  fileName: string;
  sha256: string;
  bytes: number;
  contentHash: string;
  contentRevision: number | null;
  savedBuild: true;
  liveEditorDraft: false;
  visionAssessment: false;
};

function fail(code: DeckInspectionError['code'], message: string): never {
  throw new DeckInspectionError(code, message);
}

export function canonicalPlanHash(plan: unknown): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function deckDirectory(root: string, deckId: string): string {
  if (!DECK_ID.test(deckId)) fail('invalid_path', 'Идентификатор колоды не подходит для пути.');
  const base = resolve(root);
  const directory = resolve(base, deckId);
  const fromBase = relative(base, directory);
  if (fromBase === '' || fromBase.startsWith('..') || isAbsolute(fromBase)) {
    fail('invalid_path', 'Каталог колоды выходит за пределы корня.');
  }
  return directory;
}

function assertInside(parent: string, target: string): void {
  const fromParent = relative(parent, target);
  if (fromParent.startsWith('..') || isAbsolute(fromParent)) {
    fail('invalid_path', 'Файл колоды выходит за пределы её каталога.');
  }
}

async function readJson(directory: string, name: string): Promise<unknown> {
  const path = join(directory, name);
  assertInside(directory, path);
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function slideOrdinal(slideIndex: number): number {
  if (!Number.isInteger(slideIndex) || slideIndex < 1) {
    fail('slide_out_of_bounds', 'Номер слайда считается с 1.');
  }
  return slideIndex - 1;
}

export async function readSavedPlan(ref: SavedDeckRef): Promise<{
  plan: z.infer<typeof savedPlanSchema>;
  planHash: string;
}> {
  const directory = deckDirectory(ref.root, ref.deckId);
  const raw = await readJson(directory, 'plan.json');
  const parsed = savedPlanSchema.safeParse(raw);
  if (!parsed.success || raw === null)
    fail('invalid_plan', 'plan.json не является сохранённым планом.');
  const indexes = new Set(parsed.data.map((item) => item.index));
  if (indexes.size !== parsed.data.length)
    fail('invalid_plan', 'В плане повторяется номер слайда.');
  return { plan: parsed.data, planHash: canonicalPlanHash(raw) };
}

export async function readSavedSlide(
  ref: SavedDeckRef & { slideIndex: number },
): Promise<ComposedSlide> {
  const { plan } = await readSavedPlan(ref);
  const ordinal = slideOrdinal(ref.slideIndex);
  const found = plan.filter((item) => item.index === ordinal);
  const slide = found[0];
  if (!slide || found.length !== 1)
    fail('slide_out_of_bounds', 'Слайда с таким номером в плане нет.');
  return slide.slide;
}

export async function readSavedRequest(ref: SavedDeckRef): Promise<{
  templateId: string;
  outline: DeckOutline | null;
  outlineSource: 'user' | 'model' | null;
}> {
  const directory = deckDirectory(ref.root, ref.deckId);
  const parsed = generationRequestSchema.safeParse(await readJson(directory, 'request.json'));
  if (!parsed.success) fail('invalid_request', 'request.json не является запросом сборки.');
  return {
    templateId: parsed.data.templateId,
    outline: parsed.data.outline,
    outlineSource: parsed.data.outlineSource ?? null,
  };
}

/** Facts the user approved. A model outline and speaker notes are not claims to cover. */
export async function readSavedOutlineFacts(
  ref: SavedDeckRef & { slideIndex: number },
): Promise<string[]> {
  const request = await readSavedRequest(ref);
  if (request.outlineSource !== 'user' || request.outline === null) return [];
  const ordinal = slideOrdinal(ref.slideIndex);
  const slide = request.outline.slides[ordinal];
  if (!slide) return [];
  return [slide.title, ...slide.points];
}

function previewNumber(fileName: string): number | null {
  const match = PREVIEW_FILE.exec(fileName);
  if (!match?.[1]) return null;
  return Number(match[1]);
}

function baseName(artifactPath: string): string {
  return artifactPath.split(/[/\\]/).at(-1) ?? '';
}

export async function readSavedPreview(
  ref: SavedDeckRef & { slideIndex: number },
): Promise<SavedPreview> {
  slideOrdinal(ref.slideIndex);
  await readSavedSlide(ref);
  const directory = deckDirectory(ref.root, ref.deckId);
  const { planHash } = await readSavedPlan(ref);
  const manifestParsed = artifactManifestSchema.safeParse(
    await readJson(directory, 'manifest.json'),
  );
  if (!manifestParsed.success) fail('invalid_manifest', 'manifest.json не проходит схему.');
  const manifest: ArtifactManifest = manifestParsed.data;
  if (manifest.runId !== ref.deckId) {
    fail('unknown_preview', 'runId манифеста не совпадает с колонкой.');
  }
  if (manifest.contentHash === undefined) {
    fail('unknown_preview', 'В манифесте нет contentHash, превью нельзя связать с ревизией плана.');
  }
  if (manifest.contentHash !== planHash) {
    fail('stale_preview', 'contentHash манифеста не совпадает с текущим plan.json.');
  }
  const artifact = manifest.artifacts.find((item) => {
    if (item.kind !== 'preview') return false;
    return previewNumber(baseName(item.path)) === ref.slideIndex;
  });
  if (!artifact) fail('unknown_preview', 'В манифесте нет записи preview для этого слайда.');
  const fileName = baseName(artifact.path);
  if (!PREVIEW_FILE.test(fileName))
    fail('unknown_preview', 'Путь preview в манифесте не является PNG слайда.');
  const filePath = resolve(directory, 'previews', fileName);
  assertInside(join(directory, 'previews'), filePath);
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    fail('missing_preview', 'Файл превью этого слайда не найден.');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== artifact.sha256 || bytes.length !== artifact.bytes) {
    fail('stale_preview', 'PNG на диске не совпадает с sha256 или размером в манифесте.');
  }
  return {
    url: '/api/backend/generation/' + ref.deckId + '/artifacts/' + fileName,
    fileName,
    sha256,
    bytes: bytes.length,
    contentHash: manifest.contentHash,
    contentRevision: manifest.contentRevision ?? null,
    savedBuild: true,
    liveEditorDraft: false,
    visionAssessment: false,
  };
}
