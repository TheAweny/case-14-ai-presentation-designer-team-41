import { describe, expect, it } from 'vitest';
import { proxiedApiPath } from './api-proxy';

describe('proxiedApiPath', () => {
  it('lets through the routes the interface uses', () => {
    expect(proxiedApiPath(['files', 'template'], 'POST')).toBe('/files/template');
    expect(proxiedApiPath(['generation'], 'POST')).toBe('/generation');
    expect(proxiedApiPath(['generation', 'prepare'], 'POST')).toBe('/generation/prepare');
    expect(proxiedApiPath(['runs', 'run-1', 'events'], 'GET')).toBe('/runs/run-1/events');
    expect(proxiedApiPath(['files', 'templates', 't-1', 'previews', 'slide-12.png'], 'GET')).toBe(
      '/files/templates/t-1/previews/slide-12.png',
    );
    expect(proxiedApiPath(['generation', 'run-1', 'artifacts', 'deck.pdf'], 'GET')).toBe(
      '/generation/run-1/artifacts/deck.pdf',
    );
  });

  it('keeps server-only routes away from the browser', () => {
    expect(proxiedApiPath(['model-settings'], 'GET')).toBeNull();
    expect(proxiedApiPath(['model-settings', 'connections'], 'POST')).toBeNull();
    expect(proxiedApiPath(['auth', 'verify'], 'POST')).toBeNull();
    expect(proxiedApiPath(['auth', 'accounts', 'x'], 'GET')).toBeNull();
    expect(proxiedApiPath(['library', 'projects'], 'GET')).toBeNull();
    expect(proxiedApiPath(['files'], 'GET')).toBeNull();
  });

  it('checks the method as well as the path', () => {
    expect(proxiedApiPath(['generation', 'run-1'], 'DELETE')).toBeNull();
    expect(proxiedApiPath(['files', 'template'], 'GET')).toBeNull();
  });

  it('cannot be walked out of with dots or encoded slashes', () => {
    expect(proxiedApiPath(['generation', '..', 'model-settings'], 'GET')).toBeNull();
    expect(proxiedApiPath(['generation', 'a/../../model-settings', 'deck'], 'GET')).toBeNull();
  });
});
