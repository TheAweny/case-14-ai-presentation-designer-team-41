import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('answers with a payload that matches the health contract', () => {
    const result = new HealthController().check();
    expect(result).toMatchObject({ status: 'ok', service: 'api' });
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
