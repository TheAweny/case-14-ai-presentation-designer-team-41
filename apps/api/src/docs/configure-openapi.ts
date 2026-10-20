import type { INestApplication } from '@nestjs/common';
import { setupOpenApi } from './openapi.js';

/** Documentation is opt-in at server startup, independently of NODE_ENV. */
export function configureOpenApi(
  app: INestApplication,
  version: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (env.API_DOCS_ENABLED === 'true') setupOpenApi(app, version);
}
