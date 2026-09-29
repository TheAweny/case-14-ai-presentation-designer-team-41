import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Pool } from 'pg';
import { LibraryMetadata } from '../generation/library-metadata.js';

/**
 * What an account leaves on disk. Its rows go with it by foreign keys; decks and uploaded files
 * live in `RUNS_DIR` and are removed here. Templates the account shared with everyone stay: other
 * people's decks may be laid out with them.
 */
@Injectable()
export class AccountDataService implements OnApplicationShutdown {
  private readonly root = resolve(process.env.RUNS_DIR ?? join(process.cwd(), 'runs'));
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  private readonly library = new LibraryMetadata(this.root);

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }

  async removeAllOf(userId: string): Promise<void> {
    for (const entry of await this.library.entries()) {
      if (entry.metadata.ownerId === userId) {
        await rm(join(this.root, entry.id), { recursive: true, force: true });
      }
    }
    const files = await this.pool.query<{ id: string; storage_path: string }>(
      'DELETE FROM stored_files WHERE owner_id = $1 AND NOT shared RETURNING id, storage_path',
      [userId],
    );
    for (const file of files.rows) {
      // Each upload has a directory of its own under RUNS_DIR; nothing outside it is touched.
      const directory = resolve(dirname(file.storage_path));
      if (directory.startsWith(this.root) && directory !== this.root) {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
