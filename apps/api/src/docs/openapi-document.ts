import { Test } from '@nestjs/testing';
import type { INestApplication, Type } from '@nestjs/common';
import { UsersController } from '../accounts/users.controller.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AccountDataService } from '../accounts/account-data.service.js';
import { AccountUsageService } from '../accounts/account-usage.service.js';
import { AccountPolicyController } from '../accounts/account-policy.controller.js';
import { AuthController } from '../auth/auth.controller.js';
import { SessionsService } from '../auth/sessions.service.js';
import { ChatsController } from '../chats/chats.controller.js';
import { ChatsService } from '../chats/chats.service.js';
import { EditorController } from '../editor/editor.controller.js';
import { EditorService } from '../editor/editor.service.js';
import { FilesController } from '../files/files.controller.js';
import { GenerationController } from '../generation/generation.controller.js';
import { GenerationService } from '../generation/generation.service.js';
import { HealthController } from '../health/health.controller.js';
import { LibraryController } from '../library/library.controller.js';
import { ModelSettingsController } from '../models/model-settings.controller.js';
import { ModelSettingsService } from '../models/model-settings.service.js';
import { ModelCapabilityService } from '../models/model-capabilities.js';
import { RunsController } from '../runs/runs.controller.js';
import { RunsService } from '../runs/runs.service.js';
import { buildOpenApiDocument } from './openapi.js';

/**
 * Controllers the running API exposes with OpenAPI decorators.
 * `SpeechController` is intentionally absent: it has no Swagger metadata, so a generated
 * page would not describe it. The docs portal says so in prose instead of inventing a schema.
 */
export const OPENAPI_CONTROLLERS = [
  UsersController,
  AccountPolicyController,
  AuthController,
  ChatsController,
  EditorController,
  FilesController,
  GenerationController,
  HealthController,
  LibraryController,
  ModelSettingsController,
  RunsController,
] as const;

const SERVICES: Type<unknown>[] = [
  AccountsService,
  SessionsService,
  AccountUsageService,
  AccountDataService,
  ChatsService,
  EditorService,
  GenerationService,
  ModelSettingsService,
  ModelCapabilityService,
  RunsService,
];

/**
 * The OpenAPI document without listening and without a database.
 * Nest reads decorators; every service is a stub, so pools are never constructed.
 */
export async function openApiDocument(
  version: string,
): Promise<ReturnType<typeof buildOpenApiDocument>> {
  const module = await Test.createTestingModule({
    controllers: [...OPENAPI_CONTROLLERS],
    providers: SERVICES.map((provide) => ({ provide, useValue: {} })),
  }).compile();
  const app: INestApplication = module.createNestApplication();
  try {
    return buildOpenApiDocument(app, version);
  } finally {
    await app.close();
  }
}
