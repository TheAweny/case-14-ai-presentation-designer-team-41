import { describe, expect, it } from 'vitest';
import {
  connectionInputProblems,
  headerRecord,
  headersProblem,
  normalizeHeaders,
  parseHeaderEnv,
  parseHeaderLines,
} from './model-settings.js';

describe('headers of a connection', () => {
  it('reads lines as typed in the form', () => {
    expect(parseHeaderLines('Project-ID: abc\n\n X-Team :  one: two \n')).toEqual([
      { name: 'Project-ID', value: 'abc' },
      { name: 'X-Team', value: 'one: two' },
    ]);
    expect(parseHeaderLines('NoColon')).toEqual([{ name: 'NoColon', value: '' }]);
  });

  it('reads MODEL_HEADERS as Name=value pairs separated by commas', () => {
    const headers = parseHeaderEnv('Project-ID=f9b1,X-Region=ru=central');
    expect(headers).toEqual([
      { name: 'Project-ID', value: 'f9b1' },
      { name: 'X-Region', value: 'ru=central' },
    ]);
    expect(headerRecord(headers)).toEqual({ 'Project-ID': 'f9b1', 'X-Region': 'ru=central' });
    expect(parseHeaderEnv(undefined)).toEqual([]);
    expect(parseHeaderEnv('')).toEqual([]);
  });

  it('accepts ordinary headers', () => {
    expect(headersProblem([{ name: 'Project-ID', value: 'f9b1' }])).toBeNull();
    expect(headersProblem([])).toBeNull();
  });

  it('names what is wrong', () => {
    expect(headersProblem([{ name: 'Project ID', value: 'x' }])).toBe('name');
    expect(headersProblem([{ name: 'authorization', value: 'Bearer x' }])).toBe('reserved');
    expect(headersProblem([{ name: 'Host', value: 'evil' }])).toBe('reserved');
    expect(headersProblem([{ name: 'X-A', value: '' }])).toBe('value');
    expect(headersProblem([{ name: 'X-A', value: 'a\r\nX-B: b' }])).toBe('value');
    expect(
      headersProblem([
        { name: 'X-A', value: '1' },
        { name: 'x-a', value: '2' },
      ]),
    ).toBe('duplicate');
    expect(
      headersProblem(Array.from({ length: 9 }, (_, i) => ({ name: `X-${i}`, value: '1' }))),
    ).toBe('tooMany');
  });

  it('trims names and values, and the form reports a header problem with the rest', () => {
    expect(normalizeHeaders([{ name: ' Project-ID ', value: ' f9b1 ' }])).toEqual([
      { name: 'Project-ID', value: 'f9b1' },
    ]);
    expect(
      connectionInputProblems({
        name: 'VK',
        baseUrl: 'https://example.com/v1',
        headers: [{ name: 'Cookie', value: 'x' }],
      }),
    ).toEqual({ headers: 'reserved' });
  });
});
