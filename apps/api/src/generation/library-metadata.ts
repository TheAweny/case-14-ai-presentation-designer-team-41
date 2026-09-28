import { BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rename, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface Metadata {
  templateId: string;
  projectId: string | null;
  /** The account that generated the deck. Decks made before accounts have none and are hidden. */
  ownerId?: string;
  /** The chat the deck was generated in. */
  chatId?: string | null;
  variant?: string;
  updatedAt: number;
  title?: string;
  deletedAt?: number;
}
const pending = new Map<string, Promise<unknown>>();

/** I preserve existing run metadata and publish library mutations atomically. */
export class LibraryMetadata {
  constructor(private readonly root: string) {}

  private path(id: string): string {
    if (!/^run-[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Invalid deck id.');
    return join(resolve(this.root), id, 'metadata.json');
  }

  async read(id: string): Promise<Metadata> {
    const path = this.path(id);
    try {
      return JSON.parse(await readFile(path, 'utf8')) as Metadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new NotFoundException('Deck not found.');
      throw error;
    }
  }

  /** Not deleted and, when `ownerId` is given, belonging to that account. */
  async visible(id: string, ownerId?: string): Promise<boolean> {
    try {
      const metadata = await this.read(id);
      return !metadata.deletedAt && (ownerId === undefined || metadata.ownerId === ownerId);
    } catch (error) {
      if (error instanceof NotFoundException) return false;
      throw error;
    }
  }

  async entries(): Promise<{ id: string; metadata: Metadata }[]> {
    let names: string[];
    try {
      names = await readdir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const entries = [];
    for (const id of names.filter((name) => /^run-[0-9a-f-]{36}$/i.test(name))) {
      try {
        entries.push({ id, metadata: await this.read(id) });
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    return entries;
  }

  private async mutate(id: string, change: (metadata: Metadata) => Metadata): Promise<Metadata> {
    const path = this.path(id);
    const work = (pending.get(path) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        const metadata = change(await this.read(id));
        const temporary = path + '.' + randomUUID() + '.tmp';
        try {
          await writeFile(temporary, JSON.stringify(metadata));
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
        return metadata;
      });
    pending.set(path, work);
    try {
      return await work;
    } finally {
      if (pending.get(path) === work) pending.delete(path);
    }
  }

  patch(id: string, patch: { title?: string; projectId?: string | null }): Promise<Metadata> {
    return this.mutate(id, (metadata) => {
      if (metadata.deletedAt) throw new NotFoundException('Deck not found.');
      return { ...metadata, ...patch };
    });
  }

  remove(id: string): Promise<Metadata> {
    return this.mutate(id, (metadata) => ({
      ...metadata,
      deletedAt: metadata.deletedAt ?? Date.now(),
    }));
  }
}
