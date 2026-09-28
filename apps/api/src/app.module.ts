import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountGuard } from './accounts/account.guard.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { ChatsModule } from './chats/chats.module.js';
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
    AccountsModule,
    MastraModule,
    HealthModule,
    ModelsModule,
    RunsModule,
    FilesModule,
    AuthModule,
    LibraryModule,
    ChatsModule,
  ],
  // Every route answers only the web server (ServiceTokenGuard), and for a signed-in account
  // (AccountGuard). Guards run in this order.
  providers: [
    { provide: APP_GUARD, useClass: ServiceTokenGuard },
    { provide: APP_GUARD, useClass: AccountGuard },
  ],
})
export class AppModule {}
