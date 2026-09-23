import { Module } from '@nestjs/common';
import { RunRepository } from '@lct/run-store';
import { resolve } from 'node:path';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';
import { RUN_REPOSITORY } from './runs.tokens.js';

@Module({
  controllers: [RunsController],
  providers: [
    {
      provide: RUN_REPOSITORY,
      useFactory: () => new RunRepository(process.env.RUNS_DIR ?? resolve(process.cwd(), 'runs')),
    },
    RunsService,
  ],
})
export class RunsModule {}
