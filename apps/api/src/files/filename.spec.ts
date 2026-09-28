import { describe, expect, it } from 'vitest';
import { decodeMultipartFilename } from './filename.js';

describe('decodeMultipartFilename', () => {
  it('keeps a valid unicode filename unchanged', () => {
    expect(decodeMultipartFilename('Шаблон.pptx')).toBe('Шаблон.pptx');
  });

  it('repairs latin1-decoded UTF-8 filenames from multipart clients', () => {
    expect(decodeMultipartFilename(Buffer.from('Шаблон.pptx').toString('latin1'))).toBe(
      'Шаблон.pptx',
    );
  });
});
