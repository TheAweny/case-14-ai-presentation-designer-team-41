import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresRunRepository } from '@lct/run-store';
import type { EditorMediaRef, EditorSnapshotSaveRequest } from '@lct/contracts';
import {
  EditorMediaMissingError,
  PostgresEditorSnapshotStore,
} from './snapshot-store.js';

const databaseUrl = process.env.RUN_STORE_TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function request(
  text: string,
  expectedRevision: number,
  media: EditorMediaRef[] = [],
): EditorSnapshotSaveRequest {
  return {
    schemaVersion: 1 as const,
    expectedRevision,
    idempotencyKey: randomUUID(),
    base: 'base-1',
    slides: [
      {
        schemaVersion: 1 as const,
        slideId: 's1',
        variant: 'balanced' as const,
        index: 0,
        patternId: 'synthetic',
        slideCx: 100,
        slideCy: 100,
        elements: [
          {
            kind: 'text' as const,
            elementId: 't',
            role: 'title' as const,
            box: { x: 0, y: 0, cx: 10, cy: 10 },
            sourceShapeId: null,
            paragraphs: [
              {
                level: 0,
                runs: [{ text, font: '', sizePt: 12, bold: null, italic: null, color: '' }],
                lineSpacing: null,
              },
            ],
            overflow: null,
          },
        ],
      },
    ],
    media,
  } as EditorSnapshotSaveRequest;
}

describeWithPostgres('PostgresEditorSnapshotStore', () => {
  const schema = `editor_snap_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: databaseUrl });
  let pool: Pool;
  let store: PostgresEditorSnapshotStore;
  let mediaRoot: string;

  beforeAll(async () => {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(databaseUrl ?? '');
    url.searchParams.set('options', `-csearch_path=${schema},public`);
    const runs = new PostgresRunRepository({ connectionString: url.toString(), maxConnections: 1 });
    await runs.migrate();
    await runs.close();
    pool = new Pool({ connectionString: url.toString(), max: 2 });
    await pool.query(
      `INSERT INTO app_users (id, email, name, password_hash, role)
       VALUES ('ann', 'ann-editor@example.test', 'Ann', 'x', 'user'),
              ('bob', 'bob-editor@example.test', 'Bob', 'x', 'user')`,
    );
    mediaRoot = await mkdtemp(join(tmpdir(), 'editor-snap-'));
    store = new PostgresEditorSnapshotStore(pool, mediaRoot);
  });

  afterAll(async () => {
    await pool?.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('publishes a revision only after the picture is on disk and hides it from another account', async () => {
    const deckId = 'run-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    await expect(store.save('ann', deckId, request('Hi', 0, [
      { mediaPart: 'upload/a.png', sha256: 'ab'.repeat(32), byteSize: PNG.length, contentType: 'image/png' },
    ]))).rejects.toBeInstanceOf(EditorMediaMissingError);
    const media = await store.putMedia('ann', deckId, 'upload/a.png', PNG, 'image/png');
    const saved = await store.save('ann', deckId, request('Hi', 0, [media]));
    expect(saved.kind).toBe('saved');
    expect(await store.load('bob', deckId)).toBeNull();
    expect((await store.readMedia('bob', deckId, 'upload/a.png'))).toBeNull();
    expect((await store.readMedia('ann', deckId, 'upload/a.png'))?.equals(PNG)).toBe(true);
  });

  it('keeps the first copy when a second save names the same revision', async () => {
    const deckId = 'run-bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const first = await store.save('ann', deckId, request('one', 0));
    const second = await store.save('ann', deckId, request('two', 0));
    expect(first.kind).toBe('saved');
    expect(second.kind).toBe('conflict');
    expect((await store.load('ann', deckId))?.revision).toBe(1);
    expect((await store.loadRevision('ann', deckId, 1))?.slides[0]).toMatchObject({
      elements: [{ paragraphs: [{ runs: [{ text: 'one' }] }] }],
    });
  });

  it('returns the first outcome for a repeated idempotency key', async () => {
    const deckId = 'run-cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const body = request('once', 0);
    const first = await store.save('ann', deckId, body);
    const repeat = await store.save('ann', deckId, { ...body, slides: request('changed', 0).slides });
    expect(repeat).toEqual(first);
    expect((await store.load('ann', deckId))?.revision).toBe(1);
  });
});
