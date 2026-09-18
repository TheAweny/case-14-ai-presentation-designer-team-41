import { Controller, Get } from '@nestjs/common';
import { healthCheckSchema, type HealthCheck } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';

const API_VERSION = '0.1.0';

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  /** Liveness of the API itself. */
  @Get()
  check(): HealthCheck {
    return healthCheckSchema.parse({
      status: 'ok',
      service: 'api',
      version: API_VERSION,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    });
  }

  /** Liveness of the Python engine, proxied through the typed client. */
  @Get('engine')
  async engine(): Promise<HealthCheck> {
    const client = new EngineClient({
      baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
    });
    return client.health();
  }
}
