import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FilesModule } from './files/files.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ServiceTokenGuard } from './auth/service-token.guard.js';
import { LibraryModule } from './library/library.module.js';
import { HealthModule } from './health/health.module.js';
import { MastraModule } from './mastra/mastra.module.js';
import { ModelsModule } from './models/models.module.js';
import { RunsModule } from './runs/runs.module.js';

@Module({
  imports: [
    MastraModule,
    HealthModule,
    ModelsModule,
    RunsModule,
    FilesModule,
    AuthModule,
    LibraryModule,
  ],
  // Every route answers only the web server; see ServiceTokenGuard.
  providers: [{ provide: APP_GUARD, useClass: ServiceTokenGuard }],
})
export class AppModule {}
