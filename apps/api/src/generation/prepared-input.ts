import { BadRequestException, ConflictException } from '@nestjs/common';
import { extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { datasetSchema, type Dataset } from '@lct/contracts';
import type { EngineClient } from '@lct/engine-client';
import { dependencyKey, prepareDatasets } from '@lct/pipeline';
import {
  readPreparedMaterial,
  type DatasetLabeler,
  type MaterialExtractEngine,
  type PreparedMaterial,
  type PreparedMaterialSource,
} from '../materials/prepared-material.js';

export interface PreparedGenerationInput {
  readonly brief: string;
  readonly preparedDatasets: readonly Dataset[];
  readonly materials: readonly (PreparedMaterial & { readonly source: PreparedMaterialSource })[];
}

export const preparedInputSnapshotSchema = z.object({
  version: z.literal(1),
  brief: z.string().max(60_000),
  preparedDatasets: z.array(datasetSchema),
  materials: z.array(
    z.object({
      text: z.string().max(60_000),
      sourceSha256: z.string().regex(/^[0-9a-f]{64}$/u),
      source: z.object({ sourceId: z.string(), name: z.string(), path: z.string() }),
    }),
  ),
});

/** Keep legacy tasks compatible; typed evidence adds a versioned immutable dependency. */
export function preparedInputDependency(registry: unknown, input: PreparedGenerationInput): string {
  return dependencyKey(
    input.preparedDatasets.length
      ? {
          registry,
          preparation: {
            version: 1,
            datasets: input.preparedDatasets,
            brief: input.brief,
            sources: input.materials.map((material) => ({
              sourceId: material.source.sourceId,
              sha256: material.sourceSha256,
            })),
          },
        }
      : registry,
  );
}

/** Preparation never consumes generation time. Ownership is checked around every awaited read. */
export async function prepareGenerationInput(options: {
  engine: MaterialExtractEngine & Partial<Pick<EngineClient, 'extractDataset'>>;
  brief: string;
  contentIds: readonly string[];
  signal: AbortSignal;
  loadContent(id: string): Promise<PreparedMaterialSource>;
  assertOwner(): Promise<void>;
  readMaterial?: typeof readPreparedMaterial;
  /** Human column labels for a data file, asked while it is prepared. */
  labelDataset?: DatasetLabeler;
  snapshot?: unknown;
}): Promise<PreparedGenerationInput> {
  const preparedDatasets: Dataset[] = [];
  const materials: (PreparedMaterial & { source: PreparedMaterialSource })[] = [];
  let brief = options.brief;
  const check = async () => {
    options.signal.throwIfAborted();
    await options.assertOwner();
    options.signal.throwIfAborted();
  };
  await check();
  if (options.snapshot !== undefined) {
    const parsed = preparedInputSnapshotSchema.safeParse(options.snapshot);
    if (!parsed.success)
      throw new ConflictException('Снимок подготовки несовместим. Создайте новую генерацию.');
    const snapshot = parsed.data;
    if (snapshot.materials.length !== options.contentIds.length)
      throw new ConflictException('Состав источников изменился. Создайте новую генерацию.');
    let expectedBrief = options.brief;
    for (const [i, material] of snapshot.materials.entries()) {
      await check();
      const id = options.contentIds[i];
      if (!id || id !== material.source.sourceId)
        throw new ConflictException('Состав источников изменился. Создайте новую генерацию.');
      const source = await options.loadContent(id);
      await check();
      const info = await stat(source.path);
      if (!info.isFile() || info.size > 32 * 1024 * 1024)
        throw new ConflictException('Исходный файл изменился. Создайте новую генерацию.');
      const bytes = await readFile(source.path, { signal: options.signal });
      await check();
      if (createHash('sha256').update(bytes).digest('hex') !== material.sourceSha256)
        throw new ConflictException('Исходный файл изменился. Создайте новую генерацию.');
      expectedBrief += `\n\nSource ${id}:\n${material.text}`;
    }
    if (snapshot.brief !== expectedBrief)
      throw new ConflictException('Бриф подготовки изменился. Создайте новую генерацию.');
    return freezePreparedInput(snapshot);
  }
  if (brief.length > 60_000) throw new BadRequestException('Content exceeds 60000 characters.');
  for (const id of options.contentIds) {
    await check();
    const source = await options.loadContent(id);
    await check();
    const material = await (options.readMaterial ?? readPreparedMaterial)(
      options.engine,
      source,
      options.signal,
      options.labelDataset,
    );
    await check();
    brief += `\n\nSource ${id}:\n${material.text}`;
    if (brief.length > 60_000) throw new BadRequestException('Content exceeds 60000 characters.');
    materials.push({ ...material, source });
    if (
      ['.csv', '.tsv', '.xlsx', '.json'].includes(extname(source.name || source.path).toLowerCase())
    ) {
      const extractDataset = options.engine.extractDataset;
      if (!extractDataset)
        throw new BadRequestException('Typed dataset extraction is unavailable.');
      // A singleton call preserves sequential file processing even when the pipeline helper
      // supports batches. No extra provider requests or parallel engine calls are introduced.
      const datasets = material.dataset
        ? [material.dataset]
        : await prepareDatasets(
            {
              extractDataset: (request, signal) =>
                extractDataset.call(options.engine, request, signal),
            },
            [source.path],
            options.signal,
          );
      await check();
      for (const input of datasets) {
        const dataset = datasetSchema.parse(input);
        if (dataset.status === 'failed' || dataset.source.sha256 !== material.sourceSha256)
          throw new BadRequestException(
            'Typed dataset extraction failed or the source changed during preparation.',
          );
        preparedDatasets.push(dataset);
      }
    }
  }
  return freezePreparedInput({ brief, materials, preparedDatasets });
}

/** The three variants share one snapshot; no consumer may mutate the accepted source data. */
function freezePreparedInput<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezePreparedInput(child);
    Object.freeze(value);
  }
  return value;
}
