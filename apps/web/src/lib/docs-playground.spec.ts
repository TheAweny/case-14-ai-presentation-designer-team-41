import { describe, expect, it } from 'vitest';
import {
  bearerToken,
  docsConsoleOrigins,
  playgroundApiPath,
  playgroundOriginAllowed,
  sessionIdentity,
} from './docs-playground';

describe('docs console origins', () => {
  it('allows the local portal and a configured docs host', () => {
    expect(
      docsConsoleOrigins({ DOCS_PUBLIC_URL: 'https://docs.example.com/' }),
    ).toEqual(
      expect.arrayContaining([
        'http://localhost:3002',
        'http://127.0.0.1:3002',
        'https://docs.example.com',
      ]),
    );
  });

  it('ignores a docs address that is not a URL', () => {
    expect(docsConsoleOrigins({ DOCS_PUBLIC_URL: 'docs.example.com' })).not.toContain(
      'docs.example.com',
    );
  });

  it('accepts the docs origin, this server, and a request without Origin', () => {
    const env = { DOCS_PUBLIC_URL: 'https://docs.example.com' };
    const here = 'http://localhost:3000/api/docs-playground/session';
    expect(playgroundOriginAllowed('https://docs.example.com', here, env)).toBe(true);
    expect(playgroundOriginAllowed('http://localhost:3000', here, env)).toBe(true);
    expect(playgroundOriginAllowed(null, here, env)).toBe(true);
    expect(playgroundOriginAllowed('https://evil.example', here, env)).toBe(false);
    expect(playgroundOriginAllowed('not a url', here, env)).toBe(false);
  });
});

describe('docs console credentials', () => {
  it('reads a single bearer token', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer one two')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('splits the signed payload on the session marker', () => {
    expect(sessionIdentity('6f1c:session:abc')).toEqual({
      userId: '6f1c',
      sessionToken: 'abc',
    });
    expect(sessionIdentity('only-a-user')).toBeNull();
    expect(sessionIdentity(':session:token')).toBeNull();
    expect(sessionIdentity('user:session:')).toBeNull();
  });
});

describe('playgroundApiPath', () => {
  it('keeps a normal API path and encodes each segment', () => {
    expect(playgroundApiPath(['generation', 'run 1', 'cancel'])).toBe(
      '/generation/run%201/cancel',
    );
    expect(playgroundApiPath(['files', 'templates', 'id', 'previews', 'slide-1.png'])).toBe(
      '/files/templates/id/previews/slide-1.png',
    );
  });

  it('refuses an empty path and a segment that climbs out', () => {
    expect(playgroundApiPath([])).toBeNull();
    expect(playgroundApiPath(['..', 'etc'])).toBeNull();
    expect(playgroundApiPath(['generation', '.'])).toBeNull();
    expect(playgroundApiPath(['generation', ''])).toBeNull();
  });
});
