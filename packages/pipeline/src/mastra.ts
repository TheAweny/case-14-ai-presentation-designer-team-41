import type { createGenerationWorkflow, createRepairWorkflow } from './generation/workflow.js';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export interface PipelineOptions {
  readonly generationWorkflow?: ReturnType<typeof createGenerationWorkflow>;
  readonly repairWorkflow?: ReturnType<typeof createRepairWorkflow>;
  /** LibSQL connection string for Mastra's internal workflow state. */
  readonly storageUrl?: string;
}

/** Default storage location for Mastra state, relative to the process working directory. */
export const DEFAULT_STORAGE_URL = 'file:./runs/mastra.db';

export function ensureLocalStorageDirectory(storageUrl: string): void {
  if (!storageUrl.startsWith('file:')) {
    return;
  }
  const filePath = storageUrl.slice('file:'.length);
  if (filePath === '' || filePath === ':memory:') {
    return;
  }
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
}

/**
 * Builds the Mastra instance used by the API and the CLI.
 * Agents and workflows are registered here once they exist; the registry of steps is empty
 * while the pipeline is being built.
 */
export function createMastra(options: PipelineOptions = {}): Mastra {
  const storageUrl = options.storageUrl ?? DEFAULT_STORAGE_URL;
  ensureLocalStorageDirectory(storageUrl);
  return new Mastra({
    storage: new LibSQLStore({
      id: 'pipeline-storage',
      url: storageUrl,
    }),
    agents: {},
    workflows: {
      ...(options.generationWorkflow ? { generation: options.generationWorkflow } : {}),
      ...(options.repairWorkflow ? { repair: options.repairWorkflow } : {}),
    },
  });
}
