import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  artifactManifestSchema,
  type ArtifactManifest,
  type JobEvent,
  type JobStage,
  type RunArtifact,
  type StageTiming,
} from '@lct/contracts';
import type { RunRecord, RunRepository } from '@lct/run-store';

export interface LifecycleArtifact extends Omit<RunArtifact, 'sha256' | 'bytes' | 'path'> {
  readonly path: string;
  readonly bytes?: number;
  readonly sha256?: string;
}

export interface LifecycleStageContext {
  readonly runId: string;
  readonly stage: Exclude<JobStage, 'queued'>;
  progress(done: number, total: number, note?: string): Promise<void>;
}

export interface LifecycleStage {
  readonly name: Exclude<JobStage, 'queued'>;
  readonly run: (context: LifecycleStageContext) => Promise<readonly LifecycleArtifact[]>;
}

export interface RunLifecycleOptions {
  readonly repository: RunRepository;
  readonly runDirectory: string;
  readonly stages: readonly LifecycleStage[];
  readonly templateHash: string;
  readonly contentPackId: string;
  readonly planId: string;
  readonly seed: number;
  readonly revisions: ArtifactManifest['revisions'];
  readonly modelCalls?: ArtifactManifest['modelCalls'];
}

export interface RunLifecycleResult {
  readonly run: RunRecord;
  readonly manifest: ArtifactManifest;
}

const now = (): string => new Date().toISOString();
type EventPayload = {
  [Type in JobEvent['type']]: Omit<
    Extract<JobEvent, { type: Type }>,
    'schemaVersion' | 'runId' | 'seq' | 'at'
  >;
}[JobEvent['type']];

export class RunLifecycle {
  private sequence = 0;
  private currentRunId: string | undefined;

  constructor(private readonly options: RunLifecycleOptions) {}

  async execute(runId: string): Promise<RunLifecycleResult> {
    const queued = await this.options.repository.get(runId);
    if (queued === null) {
      throw new Error(`Run ${runId} was not found.`);
    }
    this.currentRunId = runId;
    const running = await this.options.repository.transition(runId, 'running');
    await this.emit({ type: 'stage-started', stage: 'queued' });
    const timings: StageTiming[] = [];
    const artifacts: RunArtifact[] = [];
    try {
      for (const stage of this.options.stages) {
        const started = Date.now();
        await this.emit({ type: 'stage-started', stage: stage.name });
        const stageArtifacts = await stage.run({
          runId,
          stage: stage.name,
          progress: (done, total, note = '') =>
            this.emit({ type: 'stage-progress', stage: stage.name, done, total, note }),
        });
        const durationMs = Date.now() - started;
        timings.push({ stage: stage.name, ms: durationMs });
        await this.emit({ type: 'stage-finished', stage: stage.name, durationMs });
        for (const artifact of stageArtifacts) {
          const normalized = await this.normalizeArtifact(artifact);
          artifacts.push(normalized);
          await this.emit({
            type: 'artifact-ready',
            kind: normalized.kind,
            variant: normalized.variant,
            path: normalized.path,
          });
        }
      }

      const finishedAt = now();
      const totalMs = Date.parse(finishedAt) - Date.parse(running.startedAt ?? running.createdAt);
      const manifest = artifactManifestSchema.parse({
        schemaVersion: 1,
        runId,
        startedAt: running.startedAt ?? running.createdAt,
        finishedAt,
        templateHash: this.options.templateHash,
        contentPackId: this.options.contentPackId,
        planId: this.options.planId,
        seed: this.options.seed,
        revisions: this.options.revisions,
        modelCalls: this.options.modelCalls ?? [],
        artifacts,
        timings,
        totalMs: Math.max(0, totalMs),
        appliedPatchIds: [],
      });
      await mkdir(this.options.runDirectory, { recursive: true });
      await writeFile(
        join(this.options.runDirectory, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      );
      await this.emit({
        type: 'artifact-ready',
        kind: 'manifest',
        variant: null,
        path: 'manifest.json',
      });
      await this.emit({ type: 'done', totalMs: manifest.totalMs, manifestPath: 'manifest.json' });
      const done = await this.options.repository.transition(runId, 'done');
      return { run: done, manifest };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await mkdir(this.options.runDirectory, { recursive: true });
      await writeFile(
        join(this.options.runDirectory, 'failure.json'),
        `${JSON.stringify({ runId, at: now(), message }, null, 2)}\n`,
        'utf8',
      );
      await this.emit({
        type: 'failed',
        stage: this.options.stages.at(-1)?.name ?? 'queued',
        code: 'engine-failed',
        message,
        retryable: false,
      });
      const failed = await this.options.repository.transition(runId, 'failed');
      throw Object.assign(error instanceof Error ? error : new Error(message), { run: failed });
    }
  }

  private async emit(event: EventPayload): Promise<void> {
    const runId = this.currentRunId;
    if (runId === undefined) {
      throw new Error('Run lifecycle has not started.');
    }
    await this.options.repository.appendEvent(runId, {
      ...event,
      schemaVersion: 1,
      runId,
      seq: this.sequence++,
      at: now(),
    } as JobEvent);
  }

  private async normalizeArtifact(artifact: LifecycleArtifact): Promise<RunArtifact> {
    const path = join(this.options.runDirectory, artifact.path);
    return {
      ...artifact,
      path: relative(this.options.runDirectory, path),
      bytes: artifact.bytes ?? 0,
      sha256: artifact.sha256 ?? createHash('sha256').update('').digest('hex'),
    };
  }
}
