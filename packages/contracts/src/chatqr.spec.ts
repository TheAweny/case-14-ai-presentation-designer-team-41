import { describe, expect, it } from 'vitest';
import { chatPartSchema, qrUrlSchema } from './chat.js';

const part = {
  type: 'qr-code',
  callId: 'qr-call',
  qrId: '00000000-0000-4000-8000-000000000001',
  url: 'https://EXAMPLE.test/Привет?sig=(x)&k=2;',
  pngDataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  sha256: 'a'.repeat(64),
  width: 232,
  height: 232,
  moduleCount: 21,
  minSizeEmu: 1104900,
  source: { kind: 'user', messageId: '00000000-0000-4000-8000-000000000002' },
  reachability: { status: 'not-checked' },
};

describe('QR chat part', () => {
  it('round-trips an exact Unicode and signed URL', () => {
    expect(chatPartSchema.parse(part)).toEqual(part);
  });

  it.each([
    { pngDataUrl: 'data:image/svg+xml;base64,AAAA' },
    { pngDataUrl: 'https://example.test/qr.png' },
    { pngDataUrl: 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(262144) },
    { sha256: 'x'.repeat(64) },
    { width: 231 },
    { height: 240 },
    { moduleCount: 22 },
    { moduleCount: 181 },
    { minSizeEmu: 900000 },
    { source: { kind: 'material', messageId: part.source.messageId } },
    { reachability: { status: 'fetched' } },
    { reachability: { status: 'fetched', fetchedAt: 'yesterday' } },
  ])('rejects unsafe or inconsistent stored QR metadata: %j', (change) => {
    expect(chatPartSchema.safeParse({ ...part, ...change }).success).toBe(false);
  });

  it('accepts attested material and fetched source metadata', () => {
    expect(
      chatPartSchema.safeParse({
        ...part,
        source: { ...part.source, kind: 'material', callId: 'read', fileId: part.qrId },
        reachability: { status: 'fetched', fetchedAt: '2026-10-18T12:00:00Z' },
      }).success,
    ).toBe(true);
  });
});

describe('exact QR URL validation', () => {
  it.each([
    'https:example.test',
    'https:///example.test',
    '//example.test',
    'ftp://example.test',
    'https://user:pass@example.test',
    'https://@example.test',
    'https://:@example.test',
    'https://example.test/a b',
    'https://example.test/\u0000',
    'https://example.test/\u001f',
    'https://example.test/\u007f',
    'https://example.test/\u0085',
    'https://example.test/\u009f',
    'https://example.test/\ud800',
    'https://example.test/\udc00',
    'https://example.test/\\a',
    `https://example.test/${'я'.repeat(1024)}`,
  ])('rejects %j', (url) => expect(qrUrlSchema.safeParse(url).success).toBe(false));

  it('permits user-supplied private destinations without fetching them', () => {
    expect(qrUrlSchema.parse('http://127.0.0.1:8080/internal?sig=abc;')).toBe(
      'http://127.0.0.1:8080/internal?sig=abc;',
    );
  });
});
