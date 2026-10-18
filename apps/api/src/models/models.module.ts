import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { loadCapabilityProbe, type CapabilityProbe } from '@lct/registry';
import { Pool } from 'pg';
import { privateHostsAllowed } from './connection-check.js';
import { createKeyVault } from './key-vault.js';
import { ModelSettingsController } from './model-settings.controller.js';
import { SpeechController } from './speech.controller.js';
import { PostgresModelSettingsStore, type ModelSettingsStore } from './model-settings-store.js';
import { ModelSettingsService } from './model-settings.service.js';
import { ModelCapabilityService } from './model-capabilities.js';

const MODEL_SETTINGS_POOL = Symbol('MODEL_SETTINGS_POOL');
const MODEL_SETTINGS_STORE = Symbol('MODEL_SETTINGS_STORE');

/** The registry's agents directory, found the way the generation finds it. */
function registryDir(): string {
  const found =
    process.env.REGISTRY_DIR ||
    [resolve('registry/agents'), resolve('../../registry/agents')].find(existsSync);
  if (!found) throw new Error('REGISTRY_DIR is not configured.');
  return found;
}

/** The probe message, read once: it is a prompt, so it lives in the registry. */
function probePrompts(): () => Promise<CapabilityProbe> {
  let loaded: Promise<CapabilityProbe> | null = null;
  return () => {
    loaded ??= loadCapabilityProbe(registryDir()).catch((error: unknown) => {
      loaded = null;
      throw error;
    });
    return loaded;
  };
}

@Module({
  controllers: [ModelSettingsController, SpeechController],
  providers: [
    {
      provide: MODEL_SETTINGS_POOL,
      useFactory: () => new Pool({ connectionString: process.env.DATABASE_URL }),
    },
    {
      provide: MODEL_SETTINGS_STORE,
      inject: [MODEL_SETTINGS_POOL],
      useFactory: (pool: Pool) => new PostgresModelSettingsStore(pool),
    },
    {
      provide: ModelSettingsService,
      inject: [MODEL_SETTINGS_STORE],
      useFactory: (store: ModelSettingsStore) =>
        new ModelSettingsService(store, createKeyVault(process.env.MODEL_KEYS_SECRET), {
          allowPrivateHosts: privateHostsAllowed(process.env),
        }),
    },
    {
      provide: ModelCapabilityService,
      inject: [MODEL_SETTINGS_STORE, ModelSettingsService],
      useFactory: (store: ModelSettingsStore, settings: ModelSettingsService) =>
        new ModelCapabilityService(store, settings, probePrompts()),
    },
  ],
  exports: [ModelSettingsService, ModelCapabilityService],
})
export class ModelsModule implements OnApplicationShutdown {
  constructor(@Inject(MODEL_SETTINGS_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
