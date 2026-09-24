import { describe, expect, it } from 'vitest';
import {
  agentConfigSchema,
  contractRegistry,
  healthCheckSchema,
  runConfigSchema,
} from './index.js';

describe('contract registry', () => {
  it('exposes every schema that is exported to the engine', () => {
    expect(Object.keys(contractRegistry).sort()).toEqual([
      'AgentConfig',
      'ArtifactManifest',
      'AuditFinding',
      'DeckPlan',
      'EditableDeckRequest',
      'EditableDeckResponse',
      'HealthCheck',
      'RunConfig',
      'RunEvent',
      'SlideIR',
      'TemplateProfile',
    ]);
  });

  it('accepts a well formed health check', () => {
    const parsed = healthCheckSchema.parse({
      status: 'ok',
      service: 'engine',
      version: '0.1.0',
      uptimeSeconds: 12,
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects a run config with a slide count outside the allowed range', () => {
    const result = runConfigSchema.safeParse({
      templatePath: 'data/templates/example.pptx',
      contentPath: 'data/content/example.md',
      slideCount: 3,
      layoutVariants: ['balanced'],
      auditProfile: 'default',
      models: [{ role: 'planner', modelId: 'planner-default' }],
      seed: 1,
      outputDir: 'runs',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an agent version that is not semver', () => {
    const result = agentConfigSchema.safeParse({
      id: 'agent-example',
      version: 'v1',
      description: 'example',
      modelId: 'planner-default',
      generation: { temperature: 0.2, topP: 0.9, maxOutputTokens: 1024 },
      outputSchema: 'HealthCheck',
      instructionsFile: 'instructions.md',
    });
    expect(result.success).toBe(false);
  });
});
