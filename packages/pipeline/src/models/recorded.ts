import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requestKey, type ModelProvider, type ModelRequest } from './provider.js';

/** Default location of recorded answers, relative to the repository root. */
export const DEFAULT_RECORDINGS_DIR = 'registry/recordings';

export interface RecordedProviderOptions {
  readonly dir?: string;
  /**
   * `replay` answers from recordings only and fails on a request it has not seen; `record` asks
   * the live provider and writes what it answered, so the next replay needs no network.
   */
  readonly mode?: 'replay' | 'record';
  readonly live?: ModelProvider;
}

interface Recording {
  readonly agentId: string;
  readonly agentVersion: string;
  readonly input: unknown;
  readonly answer: string;
}

/** Answers from registry/recordings/<agent>/<key>.json, which is what tests and the offline demo run on. */
export class RecordedProvider implements ModelProvider {
  readonly name = 'fake';
  private readonly dir: string;
  private readonly mode: 'replay' | 'record';
  private readonly live: ModelProvider | undefined;

  constructor(options: RecordedProviderOptions = {}) {
    this.dir = options.dir ?? DEFAULT_RECORDINGS_DIR;
    this.mode = options.mode ?? 'replay';
    this.live = options.live;
    if (this.mode === 'record' && this.live === undefined) {
      throw new Error('Recording needs a live provider to record from.');
    }
  }

  pathOf(request: ModelRequest): string {
    return join(this.dir, request.agent.config.id, `${requestKey(request)}.json`);
  }

  async complete(request: ModelRequest, feedback?: string): Promise<string> {
    const path = this.pathOf(request);
    if (this.mode === 'record' && this.live !== undefined) {
      const answer = await this.live.complete(request, feedback);
      const recording: Recording = {
        agentId: request.agent.config.id,
        agentVersion: request.agent.config.version,
        input: request.input,
        answer,
      };
      await mkdir(join(this.dir, request.agent.config.id), { recursive: true });
      await writeFile(path, `${JSON.stringify(recording, null, 2)}\n`, 'utf8');
      return answer;
    }
    try {
      const recording = JSON.parse(await readFile(path, 'utf8')) as Recording;
      return recording.answer;
    } catch {
      throw new Error(
        `No recorded answer for ${request.agent.config.id} at ${path}. ` +
          'Record one against a live model with MODEL_PROVIDER=record.',
      );
    }
  }
}
