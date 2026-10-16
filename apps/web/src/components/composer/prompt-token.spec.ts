import { describe, expect, it } from 'vitest';
import { promptToken } from './prompt-token';

describe('prompt tokens', () => {
  it('matches a Cyrillic source at the caret without consuming following text', () => {
    expect(promptToken('Смотри @слайд дальше', 13)).toEqual({
      kind: 'source',
      query: 'слайд',
      start: 7,
      end: 13,
    });
  });
  it('recognizes commands and keeps ordinary email addresses and URLs intact', () => {
    expect(promptToken('/pla', 4)?.kind).toBe('command');
    expect(promptToken('name@example.com', 16)).toBe(null);
    expect(promptToken('https://example.com', 19)).toBe(null);
  });
});
