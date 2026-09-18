import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';

export interface PipelineOptions {
  /** LibSQL connection string; a local file keeps the scaffold free of a database service. */
  readonly storageUrl?: string;
}

/** Default storage location for Mastra state, relative to the process working directory. */
export const DEFAULT_STORAGE_URL = 'file:./runs/mastra.db';

/**
 * Builds the Mastra instance used by the API and the CLI.
 * Agents and workflows are registered here once they exist; the registry of steps is empty
 * while the pipeline is being built.
 */
export function createMastra(options: PipelineOptions = {}): Mastra {
  return new Mastra({
    storage: new LibSQLStore({
      id: 'pipeline-storage',
      url: options.storageUrl ?? DEFAULT_STORAGE_URL,
    }),
    agents: {},
    workflows: {},
  });
}
