import { describe, expect, it } from 'vitest';
import { appendTranscript } from './voice-transcript';

describe('appendTranscript', () => {
  it('writes the first words into an empty field', () => {
    expect(appendTranscript('', 'Привет голосом')).toBe('Привет голосом');
    expect(appendTranscript('   ', 'Привет')).toBe('Привет');
  });

  it('continues an existing draft with a single space', () => {
    expect(appendTranscript('Черновик', 'и ещё')).toBe('Черновик и ещё');
    expect(appendTranscript('Черновик  ', 'дальше')).toBe('Черновик дальше');
  });

  it('ignores an empty transcript', () => {
    expect(appendTranscript('Черновик', '  ')).toBe('Черновик');
  });
});
