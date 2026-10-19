import { describe, expect, it } from 'vitest';
import {
  SERVER_ONLY_EXTENSION,
  browserDocument,
  documentForSchemas,
  documentForTag,
  type OpenApiDocument,
} from './api-docs';

const pathParam = (name: string, example: string) => ({
  name,
  in: 'path',
  schema: { type: 'string', example },
});

const document: OpenApiDocument = {
  openapi: '3.0.0',
  paths: {
    '/chats': { get: { description: 'Чаты.' } },
    '/files/templates/{id}/previews/{name}': {
      get: { parameters: [pathParam('id', 't-1'), pathParam('name', 'slide-3.png')] },
    },
    '/files/templates/{id}/download': {
      get: { parameters: [pathParam('id', '11d8fefa-d032-4a95-84e5-77efd69569c2')] },
    },
    '/model-settings': { get: { description: 'Настройки.' } },
    '/generation/{id}': {
      get: { parameters: [pathParam('id', 'run-1')] },
      delete: { parameters: [pathParam('id', 'run-1')] },
    },
  },
};

describe('browserDocument', () => {
  it('offers the proxy as the only server', () => {
    expect(browserDocument(document).servers).toEqual([
      { url: '/api/backend', description: expect.any(String) },
    ]);
  });

  it('leaves the routes the proxy forwards as they are', () => {
    const paths = browserDocument(document).paths ?? {};
    expect(paths['/chats']?.get).toEqual({ description: 'Чаты.' });
    expect(paths['/files/templates/{id}/previews/{name}']?.get?.[SERVER_ONLY_EXTENSION]).toBe(
      undefined,
    );
    expect(paths['/files/templates/{id}/download']?.get?.[SERVER_ONLY_EXTENSION]).toBe(undefined);
  });

  it('marks the routes only the web server may call', () => {
    const paths = browserDocument(document).paths ?? {};
    const settings = paths['/model-settings']?.get;
    expect(settings?.[SERVER_ONLY_EXTENSION]).toBe(true);
    expect(settings?.description).toMatch(/^\*\*Только для сервера веба\.\*\*/);
    expect(settings?.description).toContain('Настройки.');
    // The same path can be open for one method and closed for another.
    expect(paths['/generation/{id}']?.delete?.[SERVER_ONLY_EXTENSION]).toBe(true);
  });
});

describe('documentForTag', () => {
  const source: OpenApiDocument = {
    tags: [
      { name: 'Чаты', description: 'Разговор.' },
      { name: 'Состояние', description: 'Жив.' },
      { name: 'Генерация', description: 'Сборка.' },
    ],
    paths: {
      '/chats': { get: { description: 'Чаты.', tags: ['Чаты'] } },
      '/health': { get: { description: 'Жив.', tags: ['Состояние'] } },
      '/generation/{id}': {
        delete: {
          description: 'Удалить.',
          tags: ['Генерация'],
          parameters: [pathParam('id', 'run-1')],
        },
      },
    },
    components: {
      schemas: { Chat: { type: 'object' } },
      securitySchemes: { serviceToken: { type: 'apiKey' } },
    },
  };

  it('drops routes of other tags and keeps schemas out of the route list', () => {
    const ready = browserDocument(source);
    const chats = documentForTag(ready, 'Чаты');

    expect(Object.keys(chats.paths ?? {})).toEqual(['/chats']);
    expect(chats.tags).toEqual([{ name: 'Чаты', description: 'Разговор.' }]);
    expect(JSON.stringify(chats.paths)).not.toContain('Chat');
    expect(chats.components).toEqual(ready.components);

    const generation = documentForTag(ready, 'Генерация');
    expect(generation.paths?.['/generation/{id}']?.delete?.[SERVER_ONLY_EXTENSION]).toBe(true);
  });

  it('puts the models on their own document, with no routes', () => {
    const ready = browserDocument(source);
    const schemas = documentForSchemas(ready);

    expect(schemas.paths).toEqual({});
    expect(schemas.tags).toEqual([]);
    expect(schemas.components).toEqual(ready.components);
  });
});
