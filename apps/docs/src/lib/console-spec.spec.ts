import { describe, expect, it } from 'vitest';
import { consoleDocument } from './console-spec';

describe('consoleDocument', () => {
  it('points Swagger at the app and drops headers the page adds itself', () => {
    const next = consoleDocument(
      {
        openapi: '3.0.0',
        security: [{ serviceToken: [] }],
        components: { securitySchemes: { serviceToken: { type: 'apiKey' } }, schemas: { A: {} } },
        paths: {
          '/generation': {
            post: {
              summary: 'Собрать',
              security: [{ serviceToken: [] }],
              parameters: [
                { in: 'header', name: 'x-lct-service-token' },
                { in: 'header', name: 'x-lct-session' },
                { in: 'query', name: 'limit' },
              ],
            },
          },
        },
      },
      'http://localhost:3000/api/docs-playground',
    );
    expect(next.servers).toEqual([
      {
        url: 'http://localhost:3000/api/docs-playground',
        description: 'Через приложение, от имени аккаунта в шапке документации',
      },
    ]);
    expect(next.security).toBeUndefined();
    expect(next.components?.securitySchemes).toBeUndefined();
    expect(next.components?.schemas).toEqual({ A: {} });
    expect(next.paths?.['/generation']?.post?.parameters).toEqual([{ in: 'query', name: 'limit' }]);
    expect(JSON.stringify(next)).not.toContain('x-lct-service-token');
  });
});
