import { Controller, Get, HttpCode, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import type { RunRecord } from '@lct/run-store';
import { RunsService } from './runs.service.js';

@Controller('runs')
export class RunsController {
  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  @Post()
  @HttpCode(202)
  create(): Promise<RunRecord> {
    return this.runs.create();
  }

  @Get(':runId')
  async status(@Param('runId') runId: string): Promise<RunRecord> {
    const run = await this.runs.get(runId);
    if (run === null) {
      throw new NotFoundException(`Run ${runId} was not found.`);
    }
    return run;
  }
}
