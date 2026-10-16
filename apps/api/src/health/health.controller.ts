import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { healthCheckSchema, type HealthCheck } from '@lct/contracts';
import { EngineClient } from '@lct/engine-client';
import { PublicRoute } from '../auth/service-token.guard.js';
import { RunsService } from '../runs/runs.service.js';
import { ApiErrors } from '../docs/decorators.js';
import { DOCS_TAGS } from '../docs/openapi.js';

export const API_VERSION = '0.1.0';

@ApiTags(DOCS_TAGS.health)
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(@Inject(RunsService) private readonly runs: RunsService) {}

  /** Liveness of the API itself. The only route open without the service token. */
  @Get()
  @PublicRoute()
  @ApiOperation({
    summary: 'API живо',
    description: 'Открыт без токена: для Docker и установщика.',
    security: [],
  })
  @ApiOkResponse({
    standardSchema: healthCheckSchema,
    example: { status: 'ok', service: 'api', version: '0.1.0', uptimeSeconds: 5400 },
  })
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
  @ApiOperation({ summary: 'Python-движок жив' })
  @ApiOkResponse({
    standardSchema: healthCheckSchema,
    example: { status: 'ok', service: 'engine', version: '0.1.0', uptimeSeconds: 5398 },
  })
  @ApiErrors(403, 503)
  async engine(): Promise<HealthCheck> {
    const client = new EngineClient({
      baseUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
    });
    return client.health();
  }

  @Get('database')
  @ApiOperation({ summary: 'PostgreSQL отвечает' })
  @ApiOkResponse({
    standardSchema: healthCheckSchema,
    example: { status: 'ok', service: 'postgresql', version: '0.1.0', uptimeSeconds: 5400 },
  })
  @ApiErrors(403, 503)
  async database(): Promise<HealthCheck> {
    await this.runs.ping();
    return healthCheckSchema.parse({
      status: 'ok',
      service: 'postgresql',
      version: API_VERSION,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
    });
  }
}
