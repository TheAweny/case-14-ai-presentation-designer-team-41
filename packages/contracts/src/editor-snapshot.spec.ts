import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { editorSnapshotSaveRequestSchema } from './editor-snapshot.js';

describe('editor snapshot media completeness', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('../fixtures/SlideIR.json', import.meta.url), 'utf8'),
  );
  const slide = {
    ...fixture.valid[0].payload,
    elements: [
      {
        kind: 'image',
        elementId: 'uploaded',
        role: 'image',
        sourceShapeId: null,
        box: { x: 0, y: 0, cx: 100, cy: 100 },
        mediaPart: 'upload/image.png',
        fit: 'contain',
      },
    ],
  };
  const media = {
    mediaPart: 'upload/image.png',
    sha256: 'a'.repeat(64),
    byteSize: 10,
    contentType: 'image/png',
  };
  const request = {
    schemaVersion: 1,
    expectedRevision: 0,
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    base: 'base',
    slides: [slide],
    media: [media],
  };
  it('accepts a complete reference and rejects absent or ambiguous media', () => {
    expect(editorSnapshotSaveRequestSchema.safeParse(request).success).toBe(true);
    expect(editorSnapshotSaveRequestSchema.safeParse({ ...request, media: [] }).success).toBe(
      false,
    );
    expect(
      editorSnapshotSaveRequestSchema.safeParse({ ...request, media: [media, media] }).success,
    ).toBe(false);
  });
});
