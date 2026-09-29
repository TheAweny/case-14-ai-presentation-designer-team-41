import { describe, expect, it, vi } from 'vitest';
import { checkBackendServices } from './service-health';

function healthy(service: string, status: 'ok' | 'degraded' = 'ok'): Response {
  return Response.json({ service, status, version: '1.0.0', uptimeSeconds: 1 });
}

describe('checkBackendServices', () => {
  it('reports healthy components separately', async () => {
    const fetchHealth = vi.fn(async (path: string) => {
      const service = {
        '/health': 'api',
        '/health/engine': 'engine',
        '/health/database': 'postgresql',
      }[path];
      return healthy(service ?? 'unexpected');
    });
    await expect(checkBackendServices(fetchHealth)).resolves.toEqual({
      api: 'ok',
      engine: 'ok',
      database: 'ok',
    });
    expect(fetchHealth).toHaveBeenCalledTimes(3);
  });

  it('marks dependent components unknown when the API is unreachable', async () => {
    const fetchHealth = vi.fn(async () => {
      throw new Error('Connection refused');
    });
    await expect(checkBackendServices(fetchHealth)).resolves.toEqual({
      api: 'down',
      engine: 'unknown',
      database: 'unknown',
    });
    expect(fetchHealth).toHaveBeenCalledTimes(1);
  });

  it('identifies an engine outage while the API and database work', async () => {
    const fetchHealth = vi.fn(async (path: string) => {
      if (path === '/health/engine') return new Response(null, { status: 503 });
      return healthy(path === '/health' ? 'api' : 'postgresql');
    });
    await expect(checkBackendServices(fetchHealth)).resolves.toEqual({
      api: 'ok',
      engine: 'down',
      database: 'ok',
    });
  });

  it('preserves a degraded status and rejects a mismatched response', async () => {
    const fetchHealth = vi.fn(async (path: string) => {
      if (path === '/health/engine') return healthy('engine', 'degraded');
      return healthy(path === '/health' ? 'api' : 'other-service');
    });
    await expect(checkBackendServices(fetchHealth)).resolves.toEqual({
      api: 'ok',
      engine: 'degraded',
      database: 'down',
    });
  });
});
