import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  artifactManifestSchema,
  auditFindingSchema,
  contractRegistry,
  deckPlanSchema,
  runEventSchema,
  slideIrSchema,
  templateProfileSchema,
} from './index.js';

const SHA256 = 'a'.repeat(64);
const BBOX = { x: 0, y: 0, width: 100, height: 50 };

function templateProfile() {
  return {
    schemaVersion: '1.0.0',
    templateId: 'template-1',
    sourceSha256: SHA256,
    slideSize: { widthPt: 960, heightPt: 540 },
    palette: ['#112233', '#FFFFFF'],
    typography: [{ family: 'Inter', sizePt: 24, weight: 700 }],
    protectedElements: [{ objectId: 'logo-1', kind: 'logo', bbox: BBOX }],
  };
}

describe('deck contracts', () => {
  it('accepts a template profile extracted from an arbitrary template', () => {
    expect(templateProfileSchema.parse(templateProfile()).templateId).toBe('template-1');
  });

  it('rejects a template profile without a SHA-256 input identity', () => {
    expect(
      templateProfileSchema.safeParse({ ...templateProfile(), sourceSha256: 'bad' }).success,
    ).toBe(false);
  });

  it('accepts a deck plan with grounded source references', () => {
    const result = deckPlanSchema.parse({
      schemaVersion: '1.0.0',
      runId: 'run-1',
      slides: [
        {
          slideId: 'slide-1',
          title: 'Revenue grows',
          intent: 'Introduce the main result.',
          sourceRefs: [{ sourceId: 'content-1', location: 'paragraph:1' }],
        },
      ],
    });
    expect(result.slides).toHaveLength(1);
  });

  it('rejects slide IR with a non-positive bounding box', () => {
    expect(
      slideIrSchema.safeParse({
        schemaVersion: '1.0.0',
        slideId: 'slide-1',
        objects: [{ objectId: 'title-1', kind: 'text', bbox: { ...BBOX, width: 0 } }],
      }).success,
    ).toBe(false);
  });

  it('accepts an audit finding linked to a stable slide and object id', () => {
    expect(
      auditFindingSchema.parse({
        schemaVersion: '1.0.0',
        findingId: 'finding-1',
        ruleId: 'text-overflow',
        severity: 'error',
        slideId: 'slide-1',
        objectId: 'title-1',
        bbox: BBOX,
        evidence: 'The measured text height exceeds the available box.',
      }).findingId,
    ).toBe('finding-1');
  });

  it('requires exactly three artifacts for a complete generated deck', () => {
    expect(
      artifactManifestSchema.safeParse({
        schemaVersion: '1.0.0',
        runId: 'run-1',
        inputHashes: { template: SHA256, content: SHA256 },
        gitSha: 'b'.repeat(40),
        seed: 1,
        variants: [
          {
            variantId: 'variant-1',
            strategy: 'concise',
            pptxPath: 'variants/one.pptx',
            sha256: SHA256,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('accepts monotonically numbered run events', () => {
    expect(
      runEventSchema.parse({
        schemaVersion: '1.0.0',
        runId: 'run-1',
        sequence: 0,
        stage: 'parsing',
        status: 'started',
        occurredAt: '2026-09-23T10:00:00.000Z',
      }).sequence,
    ).toBe(0);
  });

  it('validates committed valid and invalid template profile fixtures', () => {
    const fixtures = resolve(import.meta.dirname, '../fixtures');
    const valid = JSON.parse(
      readFileSync(resolve(fixtures, 'template-profile.valid.json'), 'utf8'),
    );
    const invalid = JSON.parse(
      readFileSync(resolve(fixtures, 'template-profile.invalid.json'), 'utf8'),
    );

    expect(templateProfileSchema.safeParse(valid).success).toBe(true);
    expect(templateProfileSchema.safeParse(invalid).success).toBe(false);
  });

  it('exports every MVP contract to the engine registry', () => {
    expect(Object.keys(contractRegistry).sort()).toEqual(
      expect.arrayContaining([
        'ArtifactManifest',
        'AuditFinding',
        'DeckPlan',
        'RunEvent',
        'SlideIR',
        'TemplateProfile',
      ]),
    );
  });
});
