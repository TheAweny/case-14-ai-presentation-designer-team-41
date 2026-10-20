import { Test } from '@nestjs/testing';
import { SwaggerModule } from '@nestjs/swagger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../health/health.controller.js';
import { RunsService } from '../runs/runs.service.js';
import { configureOpenApi } from './configure-openapi.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('runtime OpenAPI registration', () => {
  it.each([undefined, '', 'false', '0', '1', 'TRUE', 'invalid', 'true'])(
    'serves /docs-json only for explicit true (value: %s)',
    async (value) => {
      vi.stubEnv('API_DOCS_ENABLED', value);
      const setup = vi.spyOn(SwaggerModule, 'setup');
      const createDocument = vi.spyOn(SwaggerModule, 'createDocument');
      const module = await Test.createTestingModule({
        controllers: [HealthController],
        providers: [{ provide: RunsService, useValue: {} }],
      }).compile();
      const app = module.createNestApplication();
      try {
        configureOpenApi(app, 'test-version');
        expect(setup).toHaveBeenCalledTimes(value === 'true' ? 1 : 0);
        expect(createDocument).toHaveBeenCalledTimes(value === 'true' ? 1 : 0);
        await app.listen(0, '127.0.0.1');
        const url = await app.getUrl();
        const response = await fetch(`${url}/docs-json`);
        expect(response.status).toBe(value === 'true' ? 200 : 404);
        if (value === 'true') {
          expect(await response.json()).toMatchObject({
            openapi: '3.0.0',
            info: { version: 'test-version' },
            paths: { '/health': { get: { security: [] } } },
          });
        }
        expect((await fetch(`${url}/health`)).status).toBe(200);
        expect((await fetch(`${url}/docs`)).status).toBe(404);
      } finally {
        await app.close();
      }
    },
  );
});
