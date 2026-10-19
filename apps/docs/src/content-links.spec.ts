import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const docsRoot = join(import.meta.dirname, '..');
const contentRoot = join(docsRoot, 'content/docs');
const publicRoot = join(docsRoot, 'public');

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else acc.push(path);
  }
  return acc;
}

function pageFile(urlPath: string): string | undefined {
  const clean = urlPath.split(/[?#]/, 1)[0] ?? urlPath;
  const trimmed = clean.replace(/\/+$/, '') || '/';
  if (trimmed === '/openapi.json') return join(publicRoot, 'openapi.json');
  if (trimmed.startsWith('/images/')) return join(publicRoot, trimmed.slice(1));
  if (!trimmed.startsWith('/docs/') && trimmed !== '/docs') return undefined;
  const slug = trimmed === '/docs' ? '' : trimmed.slice('/docs/'.length);
  const base = join(contentRoot, slug);
  const candidates = [`${base}.mdx`, `${base}.md`, join(base, 'index.mdx'), join(base, 'index.md')];
  return candidates.find((file) => {
    try {
      return statSync(file).isFile();
    } catch {
      return false;
    }
  });
}

function localLinks(source: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /!\[[^\]]*]\(([^)\s]+)\)/g,
    /\[[^\]]+]\(([^)\s]+)\)/g,
    /\b(?:src|href)="([^"]+)"/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = match[1];
      if (target && !target.startsWith('#') && !/^[a-z]+:/i.test(target)) found.add(target);
    }
  }
  return [...found];
}

describe('docs content', () => {
  const articles = walk(contentRoot).filter(
    (file) => file.endsWith('.md') || file.endsWith('.mdx'),
  );

  it('resolves internal links and images', () => {
    const missing: string[] = [];
    for (const file of articles) {
      const source = readFileSync(file, 'utf8');
      for (const link of localLinks(source)) {
        const target = link.startsWith('/')
          ? pageFile(link)
          : pageFile(
              `/docs/${relative(contentRoot, join(file, '..', link.split(/[?#]/, 1)[0] ?? ''))}`.replaceAll(
                sep,
                '/',
              ),
            );
        if (!target) missing.push(`${relative(docsRoot, file)} -> ${link}`);
      }
    }
    expect(missing).toEqual([]);
    for (const file of walk(publicRoot).filter((item) => item.endsWith('.svg'))) {
      const text = readFileSync(file, 'utf8');
      const outsideTags = text.replace(/<[^>]*>/g, '');
      expect(outsideTags.includes('<'), relative(docsRoot, file)).toBe(false);
      expect(text.trimStart().startsWith('<svg'), relative(docsRoot, file)).toBe(true);
    }
  });

  it('keeps secrets out of published files', () => {
    const files = [
      ...articles,
      join(docsRoot, 'generated/openapi.json'),
      join(publicRoot, 'openapi.json'),
    ];
    const forbidden = [
      /(?:API_SERVICE_TOKEN|AUTH_SECRET|POSTGRES_PASSWORD|MODEL_API_KEY|SEARXNG_SECRET|ADMIN_PASSWORD)\s*=\s*\S+/,
      /sk-[A-Za-z0-9]{8,}/,
      /Bearer\s+[A-Za-z0-9._-]{16,}/,
      /lct26-local/,
      /postgresql:\/\/[^\s]+/,
    ];
    const hits: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const pattern of forbidden) {
        if (pattern.test(source)) hits.push(`${relative(docsRoot, file)} matches ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('lists only pages that exist for the application redirect', () => {
    const portal = readFileSync(join(docsRoot, '../web/src/lib/docs-portal.ts'), 'utf8');
    const paths = [...portal.matchAll(/'(\/docs[^']*)'/g)].map((match) => match[1] ?? '');
    expect(paths.length).toBeGreaterThan(10);
    const missing = paths.filter((path) => path !== '/docs' && pageFile(path) === undefined);
    expect(missing).toEqual([]);
  });

  it('does not depend on the product runtime', () => {
    const pkg = JSON.parse(readFileSync(join(docsRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((name) => name.startsWith('@lct/') || name === 'pg')).toEqual([]);
  });
});
