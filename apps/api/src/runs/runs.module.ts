import { Module } from '@nestjs/common';
import { PostgresRunRepository } from '@lct/run-store';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';
import { RUN_REPOSITORY } from './runs.tokens.js';

@Module({
  controllers: [RunsController],
  providers: [
    {
      provide: RUN_REPOSITORY,
      useFactory: async () => {
        const connectionString = process.env.DATABASE_URL;
        if (connectionString === undefined || connectionString.length === 0) {
          throw new Error('DATABASE_URL is required. Start PostgreSQL or use docker compose.');
        }
        const repository = new PostgresRunRepository({ connectionString });
        try {
          await repository.migrate();
          return repository;
        } catch (error) {
          await repository.close();
          throw error;
        }
      },
    },
    RunsService,
  ],
  exports: [RunsService],
})
export class RunsModule {}
