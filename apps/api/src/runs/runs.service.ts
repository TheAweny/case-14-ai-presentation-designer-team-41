import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { RunRecord, RunRepository, RunState } from '@lct/run-store';
import { RUN_REPOSITORY } from './runs.tokens.js';

@Injectable()
export class RunsService implements OnApplicationShutdown {
  constructor(@Inject(RUN_REPOSITORY) private readonly repository: RunRepository) {}

  create(): Promise<RunRecord> {
    return this.repository.create();
  }

  get(runId: string): Promise<RunRecord | null> {
    return this.repository.get(runId);
  }

  transition(runId: string, state: RunState): Promise<RunRecord> {
    return this.repository.transition(runId, state);
  }

  ping(): Promise<void> {
    return this.repository.ping();
  }

  onApplicationShutdown(): Promise<void> {
    return this.repository.close();
  }
}
