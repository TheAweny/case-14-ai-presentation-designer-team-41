import { Module } from '@nestjs/common';
import { FilesModule } from './files/files.module.js';
import { AuthModule } from './auth/auth.module.js';
import { LibraryModule } from './library/library.module.js';
import { HealthModule } from './health/health.module.js';
import { MastraModule } from './mastra/mastra.module.js';
import { RunsModule } from './runs/runs.module.js';

@Module({
  imports: [MastraModule, HealthModule, RunsModule, FilesModule, AuthModule, LibraryModule],
})
export class AppModule {}
