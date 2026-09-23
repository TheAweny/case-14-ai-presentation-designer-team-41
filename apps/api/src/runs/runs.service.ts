import { Inject, Injectable } from '@nestjs/common';
import type { LocalRun, RunRepository, RunState } from '@lct/run-store';
import { RUN_REPOSITORY } from './runs.tokens.js';

@Injectable()
export class RunsService {
  constructor(@Inject(RUN_REPOSITORY) private readonly repository: RunRepository) {}

  create(): Promise<LocalRun> {
    return this.repository.create();
  }

  get(runId: string): Promise<LocalRun | null> {
    return this.repository.get(runId);
  }

  transition(runId: string, state: RunState): Promise<LocalRun> {
    return this.repository.transition(runId, state);
  }
}
