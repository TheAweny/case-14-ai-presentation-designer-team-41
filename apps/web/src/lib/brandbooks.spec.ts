import { describe, expect, it } from 'vitest';
import {
  brandbookUploadSchema,
  brandbookAssetUrl,
  canPreviewBrandbookAsset,
  BRANDBOOK_FILE_ACCEPT,
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
  it('previews only inert raster formats', () => {
    expect(canPreviewBrandbookAsset('image/png')).toBe(true);
    expect(canPreviewBrandbookAsset('image/jpeg')).toBe(true);
    expect(canPreviewBrandbookAsset('image/svg+xml')).toBe(false);
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
