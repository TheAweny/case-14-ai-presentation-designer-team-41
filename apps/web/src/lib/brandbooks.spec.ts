import { describe, expect, it } from 'vitest';
import {
  brandbookUploadSchema,
  brandbookAssetUrl,
  canPreviewBrandbookAsset,
  BRANDBOOK_FILE_ACCEPT,
  brandbookCoverAsset,
  brandbookOverview,
  composerBrandbookOf,
  libraryBrandbookOf,
} from './brandbooks';
import { proxiedApiPath } from './api-proxy';

describe('brandbook browser boundary', () => {
  it('accepts native Figma and archive inputs through a dedicated picker', () => {
    for (const extension of ['.fig', '.rar', '.zip', '.pdf', '.json'])
      expect(BRANDBOOK_FILE_ACCEPT.split(',')).toContain(extension);
  });
  it('rejects upload metadata without a parsed profile', () => {
    expect(brandbookUploadSchema.safeParse({ fileId: 'b', fileName: 'guide.pdf' }).success).toBe(
      false,
    );
  });
  it('rejects a template response as a brandbook', () => {
    expect(brandbookUploadSchema.safeParse({ kind: 'template', fileId: 't' }).success).toBe(false);
  });
  it('uses only the authenticated proxy for extracted assets', () => {
    expect(brandbookAssetUrl('book-1', 'asset-2')).toBe(
      '/api/backend/files/brandbooks/book-1/assets/asset-2',
    );
  });
  it('encodes untrusted asset identifiers as one path segment', () => {
    expect(brandbookAssetUrl('../x', 'a/b')).toContain('..%2Fx/assets/a%2Fb');
  });
  it('previews images, including SVG through img, but never HTML', () => {
    expect(canPreviewBrandbookAsset('image/png')).toBe(true);
    expect(canPreviewBrandbookAsset('image/jpeg')).toBe(true);
    expect(canPreviewBrandbookAsset('image/svg+xml')).toBe(true);
    expect(canPreviewBrandbookAsset('text/html')).toBe(false);
  });
  it('allows only intended brandbook methods and paths', () => {
    expect(proxiedApiPath(['files', 'brandbook'], 'POST')).toBe('/files/brandbook');
    expect(proxiedApiPath(['files', 'brandbooks'], 'GET')).toBe('/files/brandbooks');
    expect(proxiedApiPath(['files', 'brandbooks', 'b-1'], 'GET')).toBe('/files/brandbooks/b-1');
    expect(proxiedApiPath(['files', 'brandbooks', 'b-1', 'assets', 'a-1'], 'GET')).toBe(
      '/files/brandbooks/b-1/assets/a-1',
    );
    expect(proxiedApiPath(['files', 'brandbooks', 'b-1'], 'DELETE')).toBeNull();
    expect(proxiedApiPath(['files', 'brandbooks', '..'], 'GET')).toBeNull();
  });
});

describe('brandbook overview', () => {
  const evidence = [{ sourceId: 's', locator: 'x', excerpt: '' }];
  const token = (
    id: string,
    kind: 'color' | 'font-family' | 'font-size' | 'rule',
    value: string | number,
    authority: 'explicit' | 'observed' | 'inferred',
    role: string | null = null,
  ) => ({
    id,
    name: id,
    kind,
    value,
    unit: kind === 'font-size' ? ('pt' as const) : null,
    role,
    scope: 'document',
    authority,
    confidence: 1,
    evidence,
  });
  const asset = (
    id: string,
    kind: 'font' | 'image' | 'vector',
    mediaType: string,
    family?: string,
  ) => ({
    id,
    sourceId: 's',
    path: `assets/${id}`,
    name: `${id}.bin`,
    kind,
    mediaType,
    sha256: 'a'.repeat(64),
    sizeBytes: 1,
    width: null,
    height: null,
    fontFamily: family ?? null,
  });
  const profile = {
    schemaVersion: 1 as const,
    parserVersion: '1',
    sourceSha256: 'a'.repeat(64),
    status: 'ready' as const,
    sources: [
      {
        id: 's',
        path: 'brand.zip',
        format: 'zip',
        sha256: 'a'.repeat(64),
        sizeBytes: 1,
        status: 'parsed' as const,
        warnings: [],
      },
    ],
    tokens: [
      token('seen', 'color', '#aa0000', 'observed'),
      token('seen-again', 'color', 'AA0000', 'observed'),
      token('primary', 'color', '#1746a2', 'explicit', 'primary'),
      token('also-primary', 'color', '#1746A2', 'observed'),
      token('heading', 'font-family', 'Inter', 'explicit', 'heading'),
      token('inter', 'font-family', 'inter', 'observed'),
      token('size', 'font-size', 36, 'explicit', 'heading'),
      token('tone', 'rule', 'Пишем коротко', 'explicit'),
    ],
    assets: [
      asset('mark', 'vector', 'image/svg+xml'),
      asset('photo', 'image', 'image/png'),
      asset('mono', 'font', 'font/ttf', 'Mono'),
    ],
    sections: [
      {
        id: 'page',
        sourceId: 's',
        kind: 'page' as const,
        name: 'Page 1',
        locator: 'page:1',
        text: 'Логотип не растягиваем',
        width: null,
        height: null,
        parentId: null,
      },
    ],
    warnings: [],
    coverage: { filesTotal: 1, filesParsed: 1, filesUnsupported: 0, needsOcr: false },
  };

  it('merges repeated colours and fonts and puts declared ones first', () => {
    const overview = brandbookOverview(profile);
    expect(overview.colors.map((color) => color.hex)).toEqual(['1746A2', 'AA0000']);
    expect(overview.colors[0]).toMatchObject({
      roles: ['primary'],
      authority: 'explicit',
      count: 2,
    });
    expect(overview.fonts.map((font) => font.family)).toEqual(['Inter', 'Mono']);
    expect(overview.fonts[1]).toMatchObject({ files: 1, authority: 'observed' });
  });

  it('sorts assets, measures and rules into their own parts', () => {
    const overview = brandbookOverview(profile);
    expect(overview.logos.map((item) => item.id)).toEqual(['mark']);
    expect(overview.images.map((item) => item.id)).toEqual(['photo']);
    expect(overview.fontFiles.map((item) => item.id)).toEqual(['mono']);
    expect(overview.measures).toEqual([
      { id: 'size', name: 'size', kind: 'font-size', value: '36 pt', role: 'heading' },
    ]);
    expect(overview.rules.map((rule) => rule.text)).toEqual([
      'Пишем коротко',
      'Логотип не растягиваем',
    ]);
  });

  it('puts the brand mark on the cover and keeps the composer entry small', () => {
    expect(brandbookCoverAsset(profile)?.id).toBe('mark');
    const entry = composerBrandbookOf({
      brandbookId: 'b',
      name: 'Бренд',
      fileName: 'brand.zip',
      size: 1,
      createdAt: 0,
      shared: false,
      mine: true,
      profile,
    });
    expect(entry).toEqual({
      brandbookId: 'b',
      name: 'Бренд',
      colors: ['1746A2', 'AA0000'],
      colorCount: 2,
      fontCount: 2,
    });
  });

  it('skips a library row that is not a parsed brandbook', () => {
    expect(libraryBrandbookOf({ fileId: 'x', fileName: 'a.zip', size: 1 })).toBeNull();
    expect(
      libraryBrandbookOf({ fileId: 'x', fileName: 'a.zip', name: 'A', size: 1, profile }),
    ).toMatchObject({ brandbookId: 'x', name: 'A', shared: false, mine: true });
  });
});
