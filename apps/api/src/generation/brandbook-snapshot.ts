import { cp, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { BrandbookBinding, BrandbookProfile } from '@lct/contracts';

type Selection = { brandbookId?: string | null; brandbookPriority?: 'brandbook' | 'template' };
export function sameBrandbook(a: Selection, b: Selection): boolean {
  return (
    (a.brandbookId ?? null) === (b.brandbookId ?? null) &&
    (!a.brandbookId ||
      (a.brandbookPriority ?? 'brandbook') === (b.brandbookPriority ?? 'brandbook'))
  );
}

export async function snapshotBrandbook(
  profile: BrandbookProfile,
  storagePath: string,
  directory: string,
  priority: BrandbookBinding['priority'],
): Promise<BrandbookBinding> {
  // Parser asset paths are relative to the brandbook directory (for example assets/<digest>.svg).
  const sourceRoot = resolve(dirname(storagePath));
  await mkdir(directory, { recursive: true });
  const assets = await Promise.all(
    profile.assets.map(async (asset, index) => {
      const source = resolve(
        sourceRoot,
        asset.path.startsWith('assets/') ? asset.path : `assets/${asset.path}`,
      );
      const local = relative(sourceRoot, source);
      if (isAbsolute(local) || local === '..' || local.startsWith('../'))
        throw new Error('Brandbook asset escapes its source directory.');
      const path = join(
        directory,
        `${index}-${asset.sha256}${asset.path.match(/\.[a-z0-9]+$/i)?.[0] ?? ''}`,
      );
      await cp(source, path, { force: false, errorOnExist: false });
      return { ...asset, path };
    }),
  );
  return { schemaVersion: 1, profile: { ...profile, assets }, priority };
}
