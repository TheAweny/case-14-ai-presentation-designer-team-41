import { describe, expect, it } from 'vitest';
import { EngineHttpError } from '@lct/engine-client';
import { templateUploadError } from './template-upload-error.js';

describe('templateUploadError', () => {
  it('reports an engine timeout as 504 rather than an internal error', () => {
    const result = templateUploadError(new DOMException('timeout', 'TimeoutError'));
    expect(result.getStatus()).toBe(504);
    expect(result.message).toContain('времени');
  });

  it('reports an invalid presentation as 422', () => {
    const result = templateUploadError(new EngineHttpError(422, '/v1/template-profile', 'bad XML'));
    expect(result.getStatus()).toBe(422);
    expect(result.message).toContain('PowerPoint');
  });

  it('reports an unreachable engine as 503 without exposing paths', () => {
    const result = templateUploadError(new TypeError('fetch failed at /private/path'));
    expect(result.getStatus()).toBe(503);
    expect(JSON.stringify(result.getResponse())).not.toContain('/private/path');
  });

  it('does not blame the file for internal engine errors', () => {
    expect(
      templateUploadError(
        new EngineHttpError(500, '/v1/template-profile', 'traceback'),
      ).getStatus(),
    ).toBe(503);
  });
});
