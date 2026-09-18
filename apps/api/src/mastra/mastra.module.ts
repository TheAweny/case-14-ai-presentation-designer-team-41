import { Global, Module } from '@nestjs/common';
import { createMastra } from '@lct/pipeline';

/** Injection token for the Mastra instance shared by the whole API process. */
export const MASTRA = 'MASTRA';

/**
 * Mastra is wired in as a plain library through a provider. We deliberately do not mount the
 * Mastra server: the API owns every route the outside world can reach.
 */
@Global()
@Module({
  providers: [
    {
      provide: MASTRA,
      useFactory: () => createMastra({ storageUrl: process.env.MASTRA_STORAGE_URL }),
    },
  ],
  exports: [MASTRA],
})
export class MastraModule {}
