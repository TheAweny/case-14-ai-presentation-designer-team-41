import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComposedSlide, Composition, CompositionNote, CompositionPlan } from '@lct/contracts';
import { writerSlots } from './workflow.js';
import {
  generateQrCode,
  minimumQrSizeEmu,
  qrUrlsInText,
  type QrCodeImage,
} from '../assets/qr-code.js';

// Reused by the three variants, with a strict process-wide bound (including pending encodes).
const cache = new Map<string, Promise<QrCodeImage>>();
function encode(url: string): Promise<QrCodeImage> {
  let pending = cache.get(url);
  if (!pending) {
    const oldest = cache.keys().next().value;
    if (cache.size >= 64 && oldest !== undefined) cache.delete(oldest);
    pending = generateQrCode(url);
    cache.set(url, pending);
    void pending.catch(() => {
      if (cache.get(url) === pending) cache.delete(url);
    });
  }
  return pending;
}

/** Parse JSON before reading string leaves: JSON escapes must never become QR payload bytes. */
export function sourceQrUrls(brief: string): string[] {
  const urls = new Set<string>();
  const visit = (value: unknown, depth: number): void => {
    if (depth > 20) return;
    if (typeof value === 'string') {
      if (value.trimStart().startsWith('[') || value.trimStart().startsWith('{')) {
        try {
          visit(JSON.parse(value), depth + 1);
          return;
        } catch {
          /* Plain source text. */
        }
      }
      for (const url of qrUrlsInText(value)) urls.add(url);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
    } else if (value && typeof value === 'object') {
      const object = value as Record<string, unknown>;
      if (
        object.role === 'assistant' ||
        object.role === 'model' ||
        object.outlineSource === 'model'
      )
        return;
      for (const [key, leaf] of Object.entries(object)) {
        if (
          ['proposedOutline', 'modelOutline', 'assistant', 'model', 'assistantMessages'].includes(
            key,
          )
        )
          continue;
        visit(leaf, depth + 1);
      }
    }
  };
  visit(brief, 0);
  return [...urls];
}

export function declaredQrSlots(pattern: Composition, note?: CompositionNote): string[] {
  const known = new Set(
    [...(pattern.imageSlots ?? []), ...(pattern.qrCandidateSlots ?? [])].map((s) => s.slotId),
  );
  return [...new Set(note?.qrSlotIds ?? [])].filter((id) => known.has(id));
}

async function assetsFor(
  pattern: Composition,
  note: CompositionNote | undefined,
  requests: NonNullable<CompositionPlan['slides'][number]['qrRequests']>,
  brief: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const ids = declaredQrSlots(pattern, note);
  const allowed = new Set(sourceQrUrls(brief));
  if (
    requests.length !== ids.length ||
    new Set(requests.map((r) => r.slotId)).size !== requests.length
  )
    throw new Error('QR requests must fill every declared QR slot exactly once.');
  return Promise.all(
    requests.map(async (request) => {
      if (!ids.includes(request.slotId) || !allowed.has(request.url))
        throw new Error(
          'QR requires a declared picture slot and an exact URL from the source brief.',
        );
      const slot = [...(pattern.qrCandidateSlots ?? []), ...(pattern.imageSlots ?? [])].find(
        (s) => s.slotId === request.slotId,
      );
      if (!slot) throw new Error('QR picture candidate is missing.');
      const image = await encode(request.url);
      signal.throwIfAborted();
      if (Math.min(slot.box.cx, slot.box.cy) < minimumQrSizeEmu(image.moduleCount))
        throw new Error('QR picture slot is too small for this URL.');
      return { request, image };
    }),
  );
}

/** Resolve before the writer: an unfillable QR frame must never retain the template's old code. */
export async function safeQrPlan(
  plan: CompositionPlan,
  catalog: readonly Composition[],
  notes: ReadonlyMap<string, CompositionNote>,
  brief: string,
  imagesAvailable: boolean,
  signal: AbortSignal,
  fallbackCatalog: readonly Composition[] = catalog,
): Promise<CompositionPlan> {
  const framing = (kind: string) => ['cover', 'section', 'closing'].includes(kind);
  const blocks = (p: Composition) => writerSlots(p).filter((s) => s.role !== 'title').length;
  const slides = await Promise.all(
    plan.slides.map(async (slide, index) => {
      signal.throwIfAborted();
      const pattern = catalog.find((p) => p.patternId === slide.patternId);
      if (!pattern) throw new Error('Planner selected an unknown template composition.');
      const ids = declaredQrSlots(pattern, notes.get(pattern.patternId));
      if (!ids.length && !slide.qrRequests?.length) return slide;
      try {
        await assetsFor(
          pattern,
          notes.get(pattern.patternId),
          slide.qrRequests ?? [],
          brief,
          signal,
        );
        return slide;
      } catch (error) {
        signal.throwIfAborted();
        const kind = notes.get(pattern.patternId)?.kind ?? 'other';
        const fallback = fallbackCatalog
          .filter((p) => {
            const note = notes.get(p.patternId);
            return (
              !note?.skip &&
              !note?.special &&
              !declaredQrSlots(p, note).length &&
              framing(note?.kind ?? 'other') === framing(kind) &&
              (index !== 0 || kind !== 'cover' || note?.kind === 'cover') &&
              !(note?.requiredContent ?? []).some((item) => item !== 'image' || !imagesAvailable) &&
              (imagesAvailable || !(p.imageSlots ?? []).some((s) => s.kind !== 'photo'))
            );
          })
          .sort(
            (a, b) =>
              Number(notes.get(b.patternId)?.kind === kind) -
                Number(notes.get(a.patternId)?.kind === kind) ||
              Math.abs(blocks(a) - blocks(pattern)) - Math.abs(blocks(b) - blocks(pattern)),
          )[0];
        if (!fallback)
          throw new Error(
            `Cannot safely replace QR composition: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          );
        return {
          ...slide,
          patternId: fallback.patternId,
          qrRequests: [],
          imageQuery: '',
          sourceEvidence: {},
        };
      }
    }),
  );
  return { ...plan, slides };
}

export interface QrAssetRecord {
  slide: number;
  slotId: string;
  path: string;
  encodedUrl: string;
  sha256: string;
  width: number;
  height: number;
  moduleCount: number;
  quietZoneModules: number;
  reachability: 'not-checked';
}

export async function saveQrAssets(
  outputDir: string,
  slides: readonly {
    index: number;
    composition: Composition;
    qrRequests?: CompositionPlan['slides'][number]['qrRequests'];
  }[],
  notes: ReadonlyMap<string, CompositionNote>,
  brief: string,
  signal: AbortSignal,
): Promise<{
  images: Map<number, NonNullable<ComposedSlide['images']>>;
  manifest: QrAssetRecord[];
}> {
  const images = new Map<number, NonNullable<ComposedSlide['images']>>();
  const manifest: QrAssetRecord[] = [];
  signal.throwIfAborted();
  await mkdir(join(outputDir, 'media'), { recursive: true });
  // Sequential writes avoid racing on the same content-addressed file within one variant.
  for (const slide of slides) {
    const assets = await assetsFor(
      slide.composition,
      notes.get(slide.composition.patternId),
      slide.qrRequests ?? [],
      brief,
      signal,
    );
    for (const { request, image } of assets) {
      const path = `media/qr-${image.sha256}.png`;
      signal.throwIfAborted();
      await writeFile(join(outputDir, path), image.png);
      const { png: _png, ...metadata } = image;
      manifest.push({
        slide: slide.index,
        slotId: request.slotId,
        path,
        ...metadata,
        reachability: 'not-checked',
      });
      images.set(slide.index, [
        ...(images.get(slide.index) ?? []),
        { slotId: request.slotId, path, fit: 'contain', purpose: 'qr' },
      ]);
    }
  }
  signal.throwIfAborted();
  await writeFile(join(outputDir, 'qr-assets.json'), JSON.stringify(manifest, null, 2));
  return { images, manifest };
}
