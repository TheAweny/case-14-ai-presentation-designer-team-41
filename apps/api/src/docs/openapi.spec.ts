import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { RequestMethod, type INestApplication, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { generationRequestSchema } from '@lct/contracts';
import { UsersController } from '../accounts/users.controller.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { AccountDataService } from '../accounts/account-data.service.js';
import { AuthController } from '../auth/auth.controller.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AccountUsageService } from '../accounts/account-usage.service.js';
import { AccountPolicyController } from '../accounts/account-policy.controller.js';
import { ChatsController } from '../chats/chats.controller.js';
import { ChatsService } from '../chats/chats.service.js';
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
import { DOCS_TAGS, buildOpenApiDocument, convertSchema } from './openapi.js';

const CONTROLLERS = [
  UsersController,
  AccountPolicyController,
  AuthController,
  ChatsController,
  FilesController,
  GenerationController,
  HealthController,
  LibraryController,
  ModelSettingsController,
  RunsController,
];

const SERVICES: Type<unknown>[] = [
  AccountsService,
  SessionsService,
  AccountUsageService,
  AccountDataService,
  ChatsService,
  GenerationService,
  ModelSettingsService,
  ModelCapabilityService,
  RunsService,
];

/** The controllers with their services stubbed: the document reads decorators, not services. */
async function documentOf() {
  const module = await Test.createTestingModule({
    controllers: CONTROLLERS,
    providers: SERVICES.map((provide) => ({ provide, useValue: {} })),
  }).compile();
  const app: INestApplication = module.createNestApplication();
  const document = buildOpenApiDocument(app, '0.0.0');
  await app.close();
  return document;
}

/** Every route the controllers declare, as `METHOD /path` with `{param}` placeholders. */
function declaredRoutes(): string[] {
  return CONTROLLERS.flatMap((controller) => {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller));
    return Object.getOwnPropertyNames(controller.prototype).flatMap((name) => {
      // Read without calling getters: some controllers have getters over their service.
      const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
      if (typeof handler !== 'function' || !Reflect.hasMetadata(METHOD_METADATA, handler)) {
        return [];
      }
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number];
      const path = String(Reflect.getMetadata(PATH_METADATA, handler));
      const full = `/${[base, path].filter((part) => part && part !== '/').join('/')}`;
      return [`${method} ${full.replace(/:(\w+)/g, '{$1}')}`];
    });
  });
}

describe('OpenAPI document', () => {
  it('describes every route of every controller with a summary, a tag and an answer', async () => {
    const document = await documentOf();
    const documented = Object.entries(document.paths).flatMap(([path, item]) =>
      Object.entries(item).map(([method, operation]) => ({
        route: `${method.toUpperCase()} ${path}`,
        operation: operation as { summary?: string; tags?: string[]; responses?: object },
      })),
    );

    expect(documented.map((entry) => entry.route).sort()).toEqual(declaredRoutes().sort());
    const tags = Object.values(DOCS_TAGS) as string[];
    for (const { route, operation } of documented) {
      expect(operation.summary, route).toBeTruthy();
      expect(operation.tags?.length, route).toBe(1);
      expect(tags, route).toContain(operation.tags?.[0]);
      expect(Object.keys(operation.responses ?? {}), route).not.toHaveLength(0);
    }
  });

  it('points every reference at a schema the document carries', async () => {
    const document = await documentOf();
    const text = JSON.stringify(document);
    const references = new Set(
      [...text.matchAll(/#\/components\/schemas\/([\w.-]+)/g)].map((m) => m[1] ?? ''),
    );

    expect(references.size).toBeGreaterThan(0);
    for (const name of references) expect(document.components?.schemas, name).toHaveProperty(name);
    expect(text).not.toContain('#/definitions/');
  });

  it('takes request bodies from the Zod contracts, not from a copy', async () => {
    const document = await documentOf();
    const body = document.paths['/generation']?.post?.requestBody as {
      content: Record<string, { schema: unknown }>;
    };

    expect(body.content['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/GenerationRequest',
    });
    const converted = convertSchema(generationRequestSchema, { schemaType: 'input' });
    const expected = JSON.stringify(converted?.components?.GenerationRequest).replaceAll(
      '#/definitions/',
      '#/components/schemas/',
    );
    expect(document.components?.schemas?.GenerationRequest).toEqual(JSON.parse(expected));
  });

  it('opens only /health without the service token', async () => {
    const document = await documentOf();
    expect(document.security).toEqual([{ serviceToken: [], account: [] }]);
    expect(document.paths['/health']?.get?.security).toEqual([]);
    expect(document.paths['/auth/verify']?.post?.security).toEqual([{ serviceToken: [] }]);
  });
});
