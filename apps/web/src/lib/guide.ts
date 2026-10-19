import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ArticleSlug } from './docs-nav';

/**
 * Guide articles live in `apps/web/content/docs`. Next bundles this module, so the path is
 * resolved three ways: next to the source (tests and dev), the app working directory (`next dev`),
 * and the standalone image, where the process starts at the tracing root.
 */
function docsDirectory(): string {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), '../../content/docs'),
    join(process.cwd(), 'content/docs'),
    join(process.cwd(), 'apps/web/content/docs'),
  ];
  const found = candidates.find((dir) => existsSync(dir));
  if (found === undefined) {
    throw new Error(`Guide articles not found. Looked in ${candidates.join(', ')}.`);
  }
  return found;
}

export function readGuide(slug: ArticleSlug): string {
  return readFileSync(join(docsDirectory(), `${slug}.md`), 'utf8');
}
