import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';

/** Status of a run as reported to the web client. */
export interface RunStatus {
  readonly runId: string;
  readonly state: 'queued' | 'running' | 'done' | 'failed';
}

/**
 * Runs: create one, poll its status, follow its progress over SSE.
 * The handlers answer with placeholders until the workflow in `@lct/pipeline` is wired in.
 */
@Controller('runs')
export class RunsController {
  @Post()
  @HttpCode(202)
  create(): RunStatus {
    return { runId: 'not-started', state: 'queued' };
  }

  @Get(':runId')
  status(@Param('runId') runId: string): RunStatus {
    return { runId, state: 'queued' };
  }
}
