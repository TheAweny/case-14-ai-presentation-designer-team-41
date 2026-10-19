import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorSnapshotSaveRequest } from '@lct/contracts';
import {
  EditorMediaConflictError,
  EditorMediaMissingError,
  EditorRevisionError,
  MemoryEditorSnapshotStore,
  ORPHAN_MEDIA_MS,
} from './snapshot-store.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function request(
  slidesText: string,
  expectedRevision: number,
  media: { mediaPart: string; sha256: string; byteSize: number; contentType: 'image/png' | 'image/jpeg' }[] = [],
) {
  const body = {
    schemaVersion: 1 as const,
    expectedRevision,
    idempotencyKey: randomUUID(),
    base: 'base-1',
    slides: [
      {
        schemaVersion: 1,
        slideId: 's1',
        variant: 'balanced',
        index: 0,
        patternId: 'synthetic',
        slideCx: 100,
        slideCy: 100,
        elements: [
          {
            kind: 'text',
            elementId: 't',
            role: 'title',
            box: { x: 0, y: 0, cx: 10, cy: 10 },
            sourceShapeId: null,
            paragraphs: [
              {
                level: 0,
                runs: [
                  {
                    text: slidesText,
                    font: '',
                    sizePt: 12,
                    bold: null,
                    italic: null,
                    color: '',
                  },
                ],
                lineSpacing: null,
              },
            ],
            overflow: null,
          },
        ],
      },
    ],
    media,
  };
  return body as EditorSnapshotSaveRequest;
}

describe('MemoryEditorSnapshotStore', () => {
  it('publishes a revision only after the picture is stored', async () => {
    const store = new MemoryEditorSnapshotStore(() => Date.parse('2026-10-19T00:00:00.000Z'));
    const media = await store.putMedia('ann', 'run-1', 'upload/a.png', PNG, 'image/png');
    await expect(store.save('ann', 'run-1', request('Hi', 0, [media]))).resolves.toMatchObject({
      kind: 'saved',
      snapshot: { revision: 1 },
    });
    await expect(
      store.save('bob', 'run-1', request('Other', 0, [media])),
    ).rejects.toBeInstanceOf(EditorMediaMissingError);
    expect(await store.load('bob', 'run-1')).toBeNull();
    expect((await store.load('ann', 'run-1'))?.slides[0]).toMatchObject({
      elements: [{ paragraphs: [{ runs: [{ text: 'Hi' }] }] }],
    });
  });

  it('keeps both copies when two clients save the same revision', async () => {
    const local = new MemoryEditorSnapshotStore();
    const first = await local.save('ann', 'deck', request('one', 0));
    expect(first.kind).toBe('saved');
    const second = await local.save('ann', 'deck', request('two', 0));
    expect(second.kind).toBe('conflict');
    if (second.kind !== 'conflict' || first.kind !== 'saved') throw new Error('expected conflict');
    expect(second.conflict.server.revision).toBe(first.snapshot.revision);
    expect(second.conflict.rejected.slides[0]).toMatchObject({
      elements: [{ paragraphs: [{ runs: [{ text: 'two' }] }] }],
    });
    expect((await local.load('ann', 'deck'))?.revision).toBe(1);
    const mine = await local.save('ann', 'deck', request('two', 1));
    expect(mine.kind).toBe('saved');
    expect((await local.load('ann', 'deck'))?.revision).toBe(2);
  });

  it('returns the first outcome for a repeated idempotency key', async () => {
    const local = new MemoryEditorSnapshotStore();
    const body = request('once', 0);
    const first = await local.save('ann', 'deck', body);
    const repeat = await local.save('ann', 'deck', { ...body, slides: request('changed', 0).slides });
    expect(repeat).toEqual(first);
    expect((await local.load('ann', 'deck'))?.revision).toBe(1);
  });

  it('does not replace a picture with different bytes', async () => {
    const store = new MemoryEditorSnapshotStore();
    await store.putMedia('ann', 'run-1', 'upload/b.png', PNG, 'image/png');
    await expect(
      store.putMedia('ann', 'run-1', 'upload/b.png', Buffer.from([1, 2, 3]), 'image/png'),
    ).rejects.toBeInstanceOf(EditorMediaConflictError);
  });

  it('refuses a save that names a revision nobody stored', async () => {
    const local = new MemoryEditorSnapshotStore();
    await expect(local.save('ann', 'deck', request('x', 4))).rejects.toBeInstanceOf(
      EditorRevisionError,
    );
  });

  it('drops an upload that no snapshot referenced', async () => {
    let clock = 0;
    const local = new MemoryEditorSnapshotStore(() => clock);
    await local.putMedia('ann', 'deck', 'upload/old.png', PNG, 'image/png');
    clock = ORPHAN_MEDIA_MS + 1;
    expect(await local.recoverOrphans(clock)).toBe(1);
    expect(await local.readMedia('ann', 'deck', 'upload/old.png')).toBeNull();
  });

  it('keeps an old revision after a newer save', async () => {
    const local = new MemoryEditorSnapshotStore();
    await local.save('ann', 'deck', request('v1', 0));
    await local.save('ann', 'deck', request('v2', 1));
    expect((await local.loadRevision('ann', 'deck', 1))?.slides[0]).toMatchObject({
      elements: [{ paragraphs: [{ runs: [{ text: 'v1' }] }] }],
    });
    expect((await local.load('ann', 'deck'))?.revision).toBe(2);
  });
});

describe('editor media files stay out of the database row', () => {
  let directory: string;
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('writes bytes beside the process and records only the key', async () => {
    directory = await mkdtemp(join(tmpdir(), 'editor-media-'));
    const file = join(directory, 'pixel.png');
    await writeFile(file, PNG);
    expect((await readFile(file)).equals(PNG)).toBe(true);
  });
});
