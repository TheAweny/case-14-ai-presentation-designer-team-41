import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool, PoolClient } from 'pg';
import {
  editorSnapshotSaveResponseSchema,
  type EditorMediaRef,
  type EditorSnapshot,
  type EditorSnapshotSaveRequest,
  type EditorSnapshotSaveResponse,
} from '@lct/contracts';

/** How long an unreferenced upload may sit before recovery deletes it. */
export const ORPHAN_MEDIA_MS = 60 * 60 * 1000;

export class EditorRevisionError extends Error {
  constructor() {
    super('The expected revision does not match a stored snapshot.');
    this.name = 'EditorRevisionError';
  }
}

export class EditorMediaMissingError extends Error {
  constructor(readonly mediaPart: string) {
    super(`Picture ${mediaPart} is not stored for this deck.`);
    this.name = 'EditorMediaMissingError';
  }
}

export class EditorMediaConflictError extends Error {
  constructor(readonly mediaPart: string) {
    super(`Picture ${mediaPart} is already stored with different bytes.`);
    this.name = 'EditorMediaConflictError';
  }
}

export interface StoredMedia extends EditorMediaRef {
  readonly storageKey: string;
}

export interface EditorSnapshotStore {
  savedOutcome?(
    accountId: string,
    deckId: string,
    key: string,
  ): Promise<EditorSnapshotSaveResponse | null>;
  load(accountId: string, deckId: string): Promise<EditorSnapshot | null>;
  loadRevision(accountId: string, deckId: string, revision: number): Promise<EditorSnapshot | null>;
  save(
    accountId: string,
    deckId: string,
    request: EditorSnapshotSaveRequest,
    beforeCommit?: (client: PoolClient) => Promise<void>,
  ): Promise<EditorSnapshotSaveResponse>;
  putMedia(
    accountId: string,
    deckId: string,
    mediaPart: string,
    bytes: Buffer,
    contentType: 'image/png' | 'image/jpeg',
  ): Promise<EditorMediaRef>;
  readMedia(accountId: string, deckId: string, mediaPart: string): Promise<Buffer | null>;
  /** Delete uploads that no published snapshot names, and files left without a row. */
  recoverOrphans(now?: number): Promise<number>;
}

function mediaStorageKey(accountId: string, deckId: string, fileName: string): string {
  for (const part of [accountId, deckId, fileName]) {
    if (part.length === 0 || part.includes('/') || part.includes('\\') || part.includes('..')) {
      throw new Error('Invalid media path.');
    }
  }
  return `${accountId}/${deckId}/${fileName}`;
}

function sha256(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function snapshotOf(
  deckId: string,
  revision: number,
  request: EditorSnapshotSaveRequest,
  savedAt: string,
): EditorSnapshot {
  return {
    schemaVersion: 1,
    deckId,
    revision,
    base: request.base,
    savedAt,
    contentSha256: sha256(JSON.stringify(request.slides)),
    slides: request.slides,
    media: request.media,
  };
}

/**
 * In-process store. The tests use it. PostgreSQL uses the same decisions: one head per
 * account and deck, a rejected save kept beside it, and a repeated key returning the first
 * outcome.
 */
export class MemoryEditorSnapshotStore implements EditorSnapshotStore {
  private readonly heads = new Map<string, EditorSnapshot>();
  private readonly revisions = new Map<string, EditorSnapshot>();
  private readonly conflicts = new Map<string, EditorSnapshotSaveResponse>();
  private readonly idempotency = new Map<string, EditorSnapshotSaveResponse>();
  private readonly media = new Map<string, { ref: EditorMediaRef; bytes: Buffer; at: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private deckKey(accountId: string, deckId: string): string {
    return `${accountId}\n${deckId}`;
  }

  async load(accountId: string, deckId: string): Promise<EditorSnapshot | null> {
    return this.heads.get(this.deckKey(accountId, deckId)) ?? null;
  }

  async loadRevision(
    accountId: string,
    deckId: string,
    revision: number,
  ): Promise<EditorSnapshot | null> {
    return this.revisions.get(`${this.deckKey(accountId, deckId)}\n${revision}`) ?? null;
  }

  async putMedia(
    accountId: string,
    deckId: string,
    mediaPart: string,
    bytes: Buffer,
    contentType: 'image/png' | 'image/jpeg',
  ): Promise<EditorMediaRef> {
    const key = `${this.deckKey(accountId, deckId)}\n${mediaPart}`;
    const digest = sha256(bytes);
    const existing = this.media.get(key);
    if (existing) {
      if (existing.ref.sha256 !== digest) throw new EditorMediaConflictError(mediaPart);
      return existing.ref;
    }
    const ref: EditorMediaRef = {
      mediaPart,
      sha256: digest,
      byteSize: bytes.length,
      contentType,
    };
    this.media.set(key, { ref, bytes, at: this.now() });
    return ref;
  }

  async readMedia(accountId: string, deckId: string, mediaPart: string): Promise<Buffer | null> {
    return this.media.get(`${this.deckKey(accountId, deckId)}\n${mediaPart}`)?.bytes ?? null;
  }

  async save(
    accountId: string,
    deckId: string,
    request: EditorSnapshotSaveRequest,
  ): Promise<EditorSnapshotSaveResponse> {
    const idem = `${this.deckKey(accountId, deckId)}\n${request.idempotencyKey}`;
    const prior = this.idempotency.get(idem);
    if (prior) return prior;
    for (const item of request.media) {
      const stored = this.media.get(`${this.deckKey(accountId, deckId)}\n${item.mediaPart}`);
      if (!stored || stored.ref.sha256 !== item.sha256 || stored.bytes.length !== item.byteSize) {
        throw new EditorMediaMissingError(item.mediaPart);
      }
    }
    const head = this.heads.get(this.deckKey(accountId, deckId));
    const current = head?.revision ?? 0;
    if (current !== request.expectedRevision) {
      if (!head) throw new EditorRevisionError();
      const conflictId = randomUUID();
      const outcome: EditorSnapshotSaveResponse = {
        schemaVersion: 1,
        kind: 'conflict',
        conflict: {
          schemaVersion: 1,
          conflictId,
          expectedRevision: request.expectedRevision,
          server: head,
          rejected: { base: request.base, slides: request.slides, media: request.media },
        },
      };
      this.conflicts.set(conflictId, outcome);
      this.idempotency.set(idem, outcome);
      for (const item of request.media) {
        const stored = this.media.get(`${this.deckKey(accountId, deckId)}\n${item.mediaPart}`);
        if (stored) stored.at = Number.POSITIVE_INFINITY;
      }
      return outcome;
    }
    const snapshot = snapshotOf(deckId, current + 1, request, new Date(this.now()).toISOString());
    this.heads.set(this.deckKey(accountId, deckId), snapshot);
    this.revisions.set(`${this.deckKey(accountId, deckId)}\n${snapshot.revision}`, snapshot);
    for (const item of request.media) {
      const stored = this.media.get(`${this.deckKey(accountId, deckId)}\n${item.mediaPart}`);
      if (stored) stored.at = Number.POSITIVE_INFINITY;
    }
    const outcome: EditorSnapshotSaveResponse = { schemaVersion: 1, kind: 'saved', snapshot };
    this.idempotency.set(idem, outcome);
    return outcome;
  }

  async recoverOrphans(now = this.now()): Promise<number> {
    let removed = 0;
    for (const [key, item] of this.media) {
      if (item.at === Number.POSITIVE_INFINITY) continue;
      if (now - item.at < ORPHAN_MEDIA_MS) continue;
      this.media.delete(key);
      removed += 1;
    }
    return removed;
  }
}

type SnapshotRow = {
  revision: number;
  base: string;
  slides: unknown;
  media: unknown;
  content_sha256: string;
  created_at: Date;
};

function rowToSnapshot(deckId: string, row: SnapshotRow): EditorSnapshot {
  return {
    schemaVersion: 1,
    deckId,
    revision: row.revision,
    base: row.base,
    savedAt: row.created_at.toISOString(),
    contentSha256: row.content_sha256,
    slides: row.slides as EditorSnapshot['slides'],
    media: row.media as EditorSnapshot['media'],
  };
}

/** PostgreSQL snapshots. Picture bytes are files named by `storage_key`, never a column. */
export class PostgresEditorSnapshotStore implements EditorSnapshotStore {
  constructor(
    private readonly pool: Pool,
    private readonly mediaRoot: string,
  ) {}

  async savedOutcome(
    accountId: string,
    deckId: string,
    key: string,
  ): Promise<EditorSnapshotSaveResponse | null> {
    const result = await this.pool.query(
      'SELECT outcome FROM editor_idempotency WHERE account_id=$1 AND deck_id=$2 AND idempotency_key=$3',
      [accountId, deckId, key],
    );
    return result.rows[0] ? editorSnapshotSaveResponseSchema.parse(result.rows[0].outcome) : null;
  }

  private async withDeck<T>(
    accountId: string,
    deckId: string,
    run: (client: PoolClient) => Promise<T>,
    beforeCommit?: (client: PoolClient) => Promise<void>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `editor:${accountId}:${deckId}`,
      ]);
      const result = await run(client);
      await beforeCommit?.(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async load(accountId: string, deckId: string): Promise<EditorSnapshot | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT revision, base, slides, media, content_sha256, created_at
       FROM editor_snapshots
       WHERE account_id = $1 AND deck_id = $2
       ORDER BY revision DESC
       LIMIT 1`,
      [accountId, deckId],
    );
    const row = result.rows[0];
    return row ? rowToSnapshot(deckId, row) : null;
  }

  async loadRevision(
    accountId: string,
    deckId: string,
    revision: number,
  ): Promise<EditorSnapshot | null> {
    const result = await this.pool.query<SnapshotRow>(
      `SELECT revision, base, slides, media, content_sha256, created_at
       FROM editor_snapshots
       WHERE account_id = $1 AND deck_id = $2 AND revision = $3`,
      [accountId, deckId, revision],
    );
    const row = result.rows[0];
    return row ? rowToSnapshot(deckId, row) : null;
  }

  async putMedia(
    accountId: string,
    deckId: string,
    mediaPart: string,
    bytes: Buffer,
    contentType: 'image/png' | 'image/jpeg',
  ): Promise<EditorMediaRef> {
    const digest = sha256(bytes);
    const extension = contentType === 'image/png' ? 'png' : 'jpg';
    const storageKey = mediaStorageKey(accountId, deckId, `${digest}.${extension}`);
    const destination = join(this.mediaRoot, storageKey);
    return this.withDeck(accountId, deckId, async (client) => {
      const existing = await client.query<{
        sha256: string;
        byte_size: number;
        content_type: string;
      }>(
        `SELECT sha256, byte_size, content_type FROM editor_media
         WHERE account_id = $1 AND deck_id = $2 AND media_part = $3`,
        [accountId, deckId, mediaPart],
      );
      const row = existing.rows[0];
      if (row) {
        if (row.sha256 !== digest) throw new EditorMediaConflictError(mediaPart);
        return {
          mediaPart,
          sha256: row.sha256,
          byteSize: row.byte_size,
          contentType: row.content_type as EditorMediaRef['contentType'],
        };
      }
      await mkdir(join(this.mediaRoot, accountId, deckId), { recursive: true });
      const temporary = `${destination}.partial`;
      await writeFile(temporary, bytes);
      await rename(temporary, destination);
      await client.query(
        `INSERT INTO editor_media
           (account_id, deck_id, media_part, storage_key, sha256, byte_size, content_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [accountId, deckId, mediaPart, storageKey, digest, bytes.length, contentType],
      );
      return { mediaPart, sha256: digest, byteSize: bytes.length, contentType };
    });
  }

  async readMedia(accountId: string, deckId: string, mediaPart: string): Promise<Buffer | null> {
    const result = await this.pool.query<{ storage_key: string }>(
      `SELECT storage_key FROM editor_media
       WHERE account_id = $1 AND deck_id = $2 AND media_part = $3`,
      [accountId, deckId, mediaPart],
    );
    const key = result.rows[0]?.storage_key;
    if (!key) return null;
    const { readFile } = await import('node:fs/promises');
    return readFile(join(this.mediaRoot, key));
  }

  async save(
    accountId: string,
    deckId: string,
    request: EditorSnapshotSaveRequest,
    beforeCommit?: (client: PoolClient) => Promise<void>,
  ): Promise<EditorSnapshotSaveResponse> {
    return this.withDeck(
      accountId,
      deckId,
      async (client) => {
        const prior = await client.query<{ outcome: EditorSnapshotSaveResponse }>(
          `SELECT outcome FROM editor_idempotency
         WHERE account_id = $1 AND deck_id = $2 AND idempotency_key = $3`,
          [accountId, deckId, request.idempotencyKey],
        );
        if (prior.rows[0]) return editorSnapshotSaveResponseSchema.parse(prior.rows[0].outcome);
        for (const item of request.media) {
          const media = await client.query<{
            sha256: string;
            byte_size: number;
            storage_key: string;
          }>(
            `SELECT sha256, byte_size, storage_key FROM editor_media
           WHERE account_id = $1 AND deck_id = $2 AND media_part = $3`,
            [accountId, deckId, item.mediaPart],
          );
          const row = media.rows[0];
          if (!row || row.sha256 !== item.sha256 || row.byte_size !== item.byteSize) {
            throw new EditorMediaMissingError(item.mediaPart);
          }
          try {
            await stat(join(this.mediaRoot, row.storage_key));
          } catch {
            throw new EditorMediaMissingError(item.mediaPart);
          }
        }
        const head = await client.query<SnapshotRow>(
          `SELECT revision, base, slides, media, content_sha256, created_at
         FROM editor_snapshots
         WHERE account_id = $1 AND deck_id = $2
         ORDER BY revision DESC
         LIMIT 1
         FOR UPDATE`,
          [accountId, deckId],
        );
        const current = head.rows[0]?.revision ?? 0;
        if (current !== request.expectedRevision) {
          if (!head.rows[0]) throw new EditorRevisionError();
          const conflictId = randomUUID();
          const outcome: EditorSnapshotSaveResponse = {
            schemaVersion: 1,
            kind: 'conflict',
            conflict: {
              schemaVersion: 1,
              conflictId,
              expectedRevision: request.expectedRevision,
              server: rowToSnapshot(deckId, head.rows[0]),
              rejected: { base: request.base, slides: request.slides, media: request.media },
            },
          };
          await client.query(
            `INSERT INTO editor_conflicts
             (id, account_id, deck_id, expected_revision, base, slides, media)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
            [
              conflictId,
              accountId,
              deckId,
              request.expectedRevision,
              request.base,
              JSON.stringify(request.slides),
              JSON.stringify(request.media),
            ],
          );
          await client.query(
            `INSERT INTO editor_idempotency (account_id, deck_id, idempotency_key, outcome)
           VALUES ($1, $2, $3, $4::jsonb)`,
            [accountId, deckId, request.idempotencyKey, JSON.stringify(outcome)],
          );
          if (request.media.length)
            await client.query(
              'UPDATE editor_media SET referenced=true WHERE account_id=$1 AND deck_id=$2 AND media_part=ANY($3::text[])',
              [accountId, deckId, request.media.map((item) => item.mediaPart)],
            );
          return outcome;
        }
        const revision = current + 1;
        const savedAt = new Date();
        const contentSha256 = sha256(JSON.stringify(request.slides));
        await client.query(
          `INSERT INTO editor_snapshots
           (account_id, deck_id, revision, base, slides, media, content_sha256, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
          [
            accountId,
            deckId,
            revision,
            request.base,
            JSON.stringify(request.slides),
            JSON.stringify(request.media),
            contentSha256,
            savedAt,
          ],
        );
        if (request.media.length) {
          await client.query(
            `UPDATE editor_media SET referenced = true
           WHERE account_id = $1 AND deck_id = $2 AND media_part = ANY($3::text[])`,
            [accountId, deckId, request.media.map((item) => item.mediaPart)],
          );
        }
        const snapshot: EditorSnapshot = {
          schemaVersion: 1,
          deckId,
          revision,
          base: request.base,
          savedAt: savedAt.toISOString(),
          contentSha256,
          slides: request.slides,
          media: request.media,
        };
        const outcome: EditorSnapshotSaveResponse = { schemaVersion: 1, kind: 'saved', snapshot };
        await client.query(
          `INSERT INTO editor_idempotency (account_id, deck_id, idempotency_key, outcome)
         VALUES ($1, $2, $3, $4::jsonb)`,
          [accountId, deckId, request.idempotencyKey, JSON.stringify(outcome)],
        );
        return outcome;
      },
      beforeCommit,
    );
  }

  async recoverOrphans(now = Date.now()): Promise<number> {
    const stale = new Date(now - ORPHAN_MEDIA_MS);
    let removed = 0;
    let accounts: string[];
    try {
      accounts = await readdir(this.mediaRoot);
    } catch {
      return removed;
    }
    for (const accountId of accounts) {
      let decks: string[];
      try {
        decks = await readdir(join(this.mediaRoot, accountId));
      } catch {
        continue;
      }
      for (const deckId of decks) {
        // Validate directory components before taking a lock or touching files.
        try {
          mediaStorageKey(accountId, deckId, 'probe.png');
        } catch {
          continue;
        }
        const directory = join(this.mediaRoot, accountId, deckId);
        await this.withDeck(accountId, deckId, async (client) => {
          await client.query(
            `DELETE FROM editor_media WHERE account_id=$1 AND deck_id=$2
             AND referenced=false AND created_at<$3`,
            [accountId, deckId, stale],
          );
          // Several names can refer to the same content-addressed file. Remove a
          // file only when none of those names survives, under the upload lock.
          const known = await client.query<{ storage_key: string }>(
            'SELECT storage_key FROM editor_media WHERE account_id=$1 AND deck_id=$2',
            [accountId, deckId],
          );
          const live = new Set(known.rows.map((row) => row.storage_key));
          let files: string[];
          try {
            files = await readdir(directory);
          } catch {
            return;
          }
          for (const file of files) {
            let key: string;
            try {
              key = mediaStorageKey(accountId, deckId, file);
            } catch {
              continue;
            }
            if (live.has(key)) continue;
            const path = join(directory, file);
            const info = await stat(path);
            // A file may precede its DB row after a crash. Give both partial and
            // complete files the same grace period, rather than deleting uploads.
            if (!info.isFile() || info.mtimeMs >= stale.getTime()) continue;
            await rm(path, { force: true });
            removed += 1;
          }
        });
      }
    }
    return removed;
  }
}
