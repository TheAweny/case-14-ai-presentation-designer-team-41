import { describe, expect, it } from 'vitest';
import { docsPortalDestination } from './docs-portal';

const origin = 'https://docs.lct.aweny.link';

describe('docsPortalDestination', () => {
  it('stays quiet until an origin is configured', () => {
    expect(docsPortalDestination('/docs/guide', undefined)).toBeNull();
    expect(docsPortalDestination('/docs/guide', '   ')).toBeNull();
  });

  it('leaves the in-app API reference where it is', () => {
    expect(docsPortalDestination('/api/docs', origin)).toBeNull();
    expect(docsPortalDestination('/api/docs/guide/access', origin)).toBeNull();
  });

  it('sends the docs index and a known article to the portal', () => {
    expect(docsPortalDestination('/docs', origin)).toBe('https://docs.lct.aweny.link/');
    expect(docsPortalDestination('/docs/guide/', origin)).toBe(
      'https://docs.lct.aweny.link/docs/guide/',
    );
  });

  it('does not invent a target for an unknown path', () => {
    expect(docsPortalDestination('/docs/missing', origin)).toBeNull();
    expect(docsPortalDestination('/docs/api/reference/missing', origin)).toBeNull();
  });
});
