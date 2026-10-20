import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { BrandbookProfile } from '@lct/contracts';
import type { GeneratedImage, ImageProvider } from '@lct/pipeline';

/** A picture smaller than this on its long side is an icon or a badge, not a slide's picture. */
const MIN_SIDE = 300;

/**
 * The brandbook's own pictures, largest first: photos, maps, illustrations. Logos are left to the
 * logo placement, and examples of the brand in use show someone else's layout: neither is used as
 * a picture, nor are fonts or vector files.
 */
export function brandPictures(profile: BrandbookProfile, root: string): string[] {
  const base = resolve(root);
  return profile.assets
    .filter(
      (asset) =>
        (asset.mediaType === 'image/png' || asset.mediaType === 'image/jpeg') &&
        !/logo|example|mockup|пример|макет/iu.test(asset.name) &&
        Math.max(asset.width ?? 0, asset.height ?? 0) >= MIN_SIDE,
    )
    .sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0))
    .map((asset) => resolve(join(base, asset.path)))
    .filter((path) => path.startsWith(base + sep));
}

/**
 * Pictures taken from the brandbook instead of drawn: when no image model is connected, a slide's
 * picture frame gets the brand's own photo rather than staying empty. Each request takes the next
 * picture, so the frames of one deck show different ones while there are enough.
 */
export class BrandbookPictures implements ImageProvider {
  readonly model = 'brandbook-pictures';
  private taken = 0;

  constructor(private readonly files: readonly string[]) {
    if (files.length === 0) throw new Error('A brandbook without pictures has none to give.');
  }

  async generate(): Promise<GeneratedImage> {
    const path = this.files[this.taken % this.files.length] ?? '';
    this.taken += 1;
    return { bytes: await readFile(path), extension: path.endsWith('.png') ? 'png' : 'jpg' };
  }
}
