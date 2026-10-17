import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { privateHostsAllowed } from './connection-check.js';
import { createKeyVault } from './key-vault.js';
import { ModelSettingsController } from './model-settings.controller.js';
import { SpeechController } from './speech.controller.js';
import { PostgresModelSettingsStore } from './model-settings-store.js';
import { ModelSettingsService } from './model-settings.service.js';

const MODEL_SETTINGS_POOL = Symbol('MODEL_SETTINGS_POOL');

@Module({
  controllers: [ModelSettingsController, SpeechController],
  providers: [
    {
      provide: MODEL_SETTINGS_POOL,
      useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }),
    },
    {
      provide: ModelSettingsService,
      inject: [MODEL_SETTINGS_POOL],
      useFactory: (pool: Pool) =>
        new ModelSettingsService(
          new PostgresModelSettingsStore(pool),
          createKeyVault(process.env.MODEL_KEYS_SECRET),
          { allowPrivateHosts: privateHostsAllowed(process.env) },
        ),
    },
  ],
  exports: [ModelSettingsService],
})
export class ModelsModule implements OnApplicationShutdown {
  constructor(@Inject(MODEL_SETTINGS_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
