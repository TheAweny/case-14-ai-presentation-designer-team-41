import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import {
  agentConfigSchema,
  contractRegistry,
  deckPlanSchema,
  healthCheckSchema,
  runConfigSchema,
  templateIrSchema,
  type ContractName,
} from './index.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

interface ValidCase {
  name: string;
  payload: unknown;
}

interface InvalidCase extends ValidCase {
  why: string;
  path: (string | number)[];
}

interface FixtureFile {
  contract: ContractName;
  valid: ValidCase[];
  invalid: InvalidCase[];
}

function readFixture(contract: ContractName): FixtureFile {
  return JSON.parse(readFileSync(join(fixturesDir, `${contract}.json`), 'utf8')) as FixtureFile;
}

function schemaOf(contract: ContractName): ZodType {
  return contractRegistry[contract];
}

function firstValidPayload(contract: ContractName): Record<string, unknown> {
  const [first] = readFixture(contract).valid;
  if (first === undefined) {
    throw new Error(`${contract} has no valid fixture to build on`);
  }
  return first.payload as Record<string, unknown>;
}

const contractNames = Object.keys(contractRegistry) as ContractName[];

describe('contract registry', () => {
  it('exposes every schema that is exported to the engine', () => {
    expect(contractNames.sort()).toEqual([
      'AgentConfig',
      'ArtifactManifest',
      'AuditFinding',
      'ContentPack',
      'DeckPlan',
      'DesignSystem',
      'EditableDeckRequest',
      'EditableDeckResponse',
      'FixPatch',
      'HealthCheck',
      'JobEvent',
      'PatternCatalog',
      'RunConfig',
      'SlideIR',
      'TemplateIR',
    ]);
  });

  it('has a fixture file for every contract, and no fixture for a contract that is gone', () => {
    const onDisk = readdirSync(fixturesDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => entry.replace(/\.json$/, ''))
      .sort();
    expect(onDisk).toEqual([...contractNames].sort());
  });
});

describe.each(contractNames)('%s fixtures', (contract) => {
  const fixture = readFixture(contract);

  it('names the contract it belongs to', () => {
    expect(fixture.contract).toBe(contract);
  });

  it('carries at least one case of each kind', () => {
    expect(fixture.valid.length).toBeGreaterThan(0);
    expect(fixture.invalid.length).toBeGreaterThan(0);
  });

  it('accepts every valid case', () => {
    for (const testCase of fixture.valid) {
      const result = schemaOf(contract).safeParse(testCase.payload);
      expect(result.success, `${testCase.name}: ${JSON.stringify(result.error?.issues)}`).toBe(
        true,
      );
    }
  });

  it('refuses every invalid case, and for the stated reason', () => {
    for (const testCase of fixture.invalid) {
      const result = schemaOf(contract).safeParse(testCase.payload);
      if (result.success) {
        throw new Error(`${contract} / ${testCase.name} parsed, but ${testCase.why}`);
      }

      // Failing somewhere else means the fixture proves nothing about the rule it was
      // written for, which is the way a contract test quietly stops testing anything.
      const paths = result.error.issues.map((issue) => JSON.stringify(issue.path));
      expect(paths, `${testCase.name}: ${testCase.why}`).toContain(JSON.stringify(testCase.path));
    }
  });

  it('explains why each invalid case is invalid', () => {
    for (const testCase of fixture.invalid) {
      expect(testCase.why.length, `${testCase.name} has no reason recorded`).toBeGreaterThan(0);
    }
  });
});

describe('versioning', () => {
  it('declares schemaVersion on every contract that crosses the pipeline', () => {
    // HealthCheck and the two config files are read from disk or answered over HTTP and are
    // versioned by the release they ship in. Everything a run produces is versioned in itself.
    const unversioned = new Set<ContractName>(['HealthCheck', 'RunConfig', 'AgentConfig']);
    for (const contract of contractNames) {
      if (unversioned.has(contract)) continue;
      for (const testCase of readFixture(contract).valid) {
        expect(testCase.payload, contract).toHaveProperty('schemaVersion', 1);
      }
    }
  });

  it('refuses a payload from a future schema version', () => {
    const valid = firstValidPayload('SlideIR');
    const result = contractRegistry.SlideIR.safeParse({ ...valid, schemaVersion: 2 });
    expect(result.success).toBe(false);
  });
});

describe('golden parser output', () => {
  const goldenDir = join(fixturesDir, 'golden');
  const goldenFiles = readdirSync(goldenDir).filter((entry) => entry.endsWith('.json'));

  it('has golden files to check', () => {
    expect(goldenFiles.length).toBeGreaterThan(0);
  });

  it.each(goldenFiles)('%s matches TemplateIR', (file) => {
    const payload = JSON.parse(readFileSync(join(goldenDir, file), 'utf8'));
    const result = templateIrSchema.safeParse(payload);
    expect(result.success, JSON.stringify(result.error?.issues.slice(0, 5))).toBe(true);
  });

  it('carries shapes, so the golden files are checking something', () => {
    const payload = templateIrSchema.parse(
      JSON.parse(readFileSync(join(goldenDir, 'groups.json'), 'utf8')),
    );
    const shapes = [...payload.masters, ...payload.layouts, ...payload.slides].flatMap(
      (part) => part.shapes,
    );
    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes.some((shape) => shape.path.length > 0)).toBe(true);
  });
});

describe('rules the schemas exist to enforce', () => {
  it('strips geometry out of a deck plan instead of carrying it to the layout', () => {
    // A plan is reused by all three variants, so a box that survived into one would silently
    // become a constraint on the other two.
    const plan = firstValidPayload('DeckPlan');
    const slides = plan.slides as Record<string, unknown>[];
    const withBox = {
      ...plan,
      slides: [{ ...slides[0], box: { x: 1, y: 2, cx: 3, cy: 4 } }, ...slides.slice(1)],
    };
    const parsed = deckPlanSchema.parse(withBox);
    expect(parsed.slides[0]).not.toHaveProperty('box');
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

  it('only lets an agent name an output schema that exists', () => {
    // registry/agents/<id>/agent.yaml names one of these, and a typo there would otherwise
    // surface as an agent producing output nobody validates.
    const named = readFixture('AgentConfig').valid.map(
      (testCase) => (testCase.payload as { outputSchema: string }).outputSchema,
    );
    for (const name of named) {
      expect(contractNames).toContain(name);
    }
  });
});
