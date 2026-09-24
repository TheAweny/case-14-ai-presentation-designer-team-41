import { describe, expect, it } from 'vitest';
import { MemoryRunRepository } from '@lct/run-store';
import { HealthController } from './health.controller.js';
import { RunsService } from '../runs/runs.service.js';

describe('HealthController', () => {
  it('answers with a payload that matches the health contract', () => {
    const result = new HealthController(new RunsService(new MemoryRunRepository())).check();
    expect(result).toMatchObject({ status: 'ok', service: 'api' });
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
