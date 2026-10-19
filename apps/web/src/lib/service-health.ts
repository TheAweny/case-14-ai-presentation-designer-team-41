import { healthCheckSchema } from '@lct/contracts';

export type ServiceState = 'ok' | 'degraded' | 'down' | 'unknown';

export interface BackendServices {
  readonly api: ServiceState;
  readonly engine: ServiceState;
  readonly database: ServiceState;
}

type HealthFetch = (path: string, init: RequestInit) => Promise<Response>;

export async function probeService(
  fetchHealth: HealthFetch,
  path: string,
  service: string,
): Promise<ServiceState> {
  try {
    const response = await fetchHealth(path, {
      signal: AbortSignal.timeout(3000),
      cache: 'no-store',
    });
    if (!response.ok) return 'down';
    const parsed = healthCheckSchema.safeParse(await response.json());
    return parsed.success && parsed.data.service === service ? parsed.data.status : 'down';
  } catch {
    return 'down';
  }
}

/** Check the API first; dependent services cannot be diagnosed while it is unreachable. */
export async function checkBackendServices(fetchHealth: HealthFetch): Promise<BackendServices> {
  const api = await probeService(fetchHealth, '/health', 'api');
  if (api === 'down') return { api, engine: 'unknown', database: 'unknown' };
  const [engine, database] = await Promise.all([
    probeService(fetchHealth, '/health/engine', 'engine'),
    probeService(fetchHealth, '/health/database', 'postgresql'),
  ]);
  return { api, engine, database };
}
