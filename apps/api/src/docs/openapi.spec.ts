import { describe, expect, it } from 'vitest';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { generationRequestSchema } from '@lct/contracts';
import { DOCS_TAGS, convertSchema } from './openapi.js';
import { OPENAPI_CONTROLLERS, openApiDocument } from './openapi-document.js';

const CONTROLLERS = OPENAPI_CONTROLLERS;

/** The controllers with their services stubbed: the document reads decorators, not services. */
function documentOf() {
  return openApiDocument('0.0.0');
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
