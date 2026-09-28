import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { RunRecord, RunRepository, RunState } from '@lct/run-store';
import type { JobEvent } from '@lct/contracts';
import { validateLocalRunInputs, type ValidatedLocalInputs } from '@lct/input-validation';
import type { RunConfig } from '@lct/contracts';
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

  events(runId: string, afterSequence = -1): Promise<readonly JobEvent[]> {
    return this.repository.events(runId, afterSequence);
  }

  ping(): Promise<void> {
    return this.repository.ping();
  }

  validateInputs(
    config: Pick<RunConfig, 'contentPath' | 'outputDir' | 'templatePath'>,
  ): ValidatedLocalInputs {
    return validateLocalRunInputs(config);
  }

  onApplicationShutdown(): Promise<void> {
    return this.repository.close();
  }
}
