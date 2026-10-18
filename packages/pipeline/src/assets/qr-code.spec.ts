import { createHash } from 'node:crypto';
import jsQR from 'jsqr';
import type { QRCode as DecodedQr } from 'jsqr';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { generateQrCode, minimumQrSizeEmu, qrUrlsInText } from './qr-code.js';

function decode(png: Buffer): string {
  const image = PNG.sync.read(png);
  // jsqr is CommonJS; NodeNext exposes its declaration namespace as the default import type.
  const decodeQr = jsQR as unknown as (
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
  ) => DecodedQr | null;
  const code = decodeQr(new Uint8ClampedArray(image.data), image.width, image.height);
  expect(code).not.toBeNull();
  if (!code) throw new Error('QR decoder did not find a symbol');
  expect(Buffer.from(code.binaryData)).toEqual(Buffer.from(code.data, 'utf8'));
  return code.data;
}

describe('generateQrCode', () => {
  it('keeps an exact unicode URL, including a signed query, and hashes the PNG bytes', async () => {
    const url = 'https://files.example/deck/Презентация?sig=ab+cd/ef==&n=1';
    const image = await generateQrCode(url);
    expect(image.encodedUrl).toBe(url);
    expect(decode(image.png)).toBe(url);
    expect(image.sha256).toBe(createHash('sha256').update(image.png).digest('hex'));
    expect(image.quietZoneModules).toBe(4);
    expect(image.moduleCount).toBeGreaterThanOrEqual(21);
    expect(image.moduleCount).toBeLessThanOrEqual(177);
    expect((image.moduleCount - 21) % 4).toBe(0);
    expect(image.width).toBe((image.moduleCount + 8) * 8);
    expect(image.height).toBe(image.width);
    const parsed = PNG.sync.read(image.png);
    expect(parsed.width).toBe(image.width);
    expect(parsed.height).toBe(image.height);
  });

  it('does not rewrite the raw string when URL parsing would normalize it', async () => {
    const url = 'https://EXAMPLE.com/Презентация/a%2Fb?x=%41';
    const image = await generateQrCode(url);
    expect(new URL(url).href).not.toBe(url);
    expect(image.encodedUrl).toBe(url);
    expect(decode(image.png)).toBe(url);
  });

  it('repeats the same bytes for the same URL', async () => {
    const url = 'http://example.com/repeat?q=1';
    const first = await generateQrCode(url);
    const second = await generateQrCode(url);
    expect(Buffer.compare(first.png, second.png)).toBe(0);
    expect(first.sha256).toBe(second.sha256);
    expect(first.moduleCount).toBe(second.moduleCount);
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/plain,hello',
    'https://user:secret@example.com/private',
    'http://user@example.com/',
    'https://example.com/has space',
    'https://example.com/line\nbreak',
    'https://example.com/a\\b',
    'not a url',
    'ftp://example.com/file',
    'https:example.test',
    '//example.test/',
    'https://example.test/\u0085',
    'https://example.test/\ud800',
    'https://example.test/\udc00',
  ])('rejects %s', async (url) => {
    await expect(generateQrCode(url)).rejects.toThrow();
  });

  it('rejects a URL longer than 2048 UTF-8 bytes', async () => {
    const url = `https://example.com/${'я'.repeat(1100)}`;
    expect(Buffer.byteLength(url, 'utf8')).toBeGreaterThan(2048);
    await expect(generateQrCode(url)).rejects.toThrow(/2048/);
  });

  it('decodes the complete 2048-byte boundary payload as UTF-8 bytes', async () => {
    const prefix = 'https://example.test/';
    const url = prefix + 'a'.repeat(2048 - Buffer.byteLength(prefix));
    const image = await generateQrCode(url);
    expect(decode(image.png)).toBe(url);
    const pixels = PNG.sync.read(image.png);
    const quiet = 32;
    let stained = 0;
    const touch = (x: number, y: number) => {
      const offset = (y * pixels.width + x) * 4;
      if (
        pixels.data[offset] !== 255 ||
        pixels.data[offset + 1] !== 255 ||
        pixels.data[offset + 2] !== 255 ||
        pixels.data[offset + 3] !== 255
      )
        stained += 1;
    };
    for (let y = 0; y < pixels.height; y += 1) {
      const edge = y < quiet || y >= pixels.height - quiet;
      for (let x = 0; x < pixels.width; x += 1) {
        if (edge || x < quiet || x >= pixels.width - quiet) touch(x, y);
      }
    }
    expect(stained).toBe(0);
  }, 20_000);
});

describe('minimumQrSizeEmu', () => {
  it('is at least 900000 EMU and grows with the quiet zone', () => {
    expect(minimumQrSizeEmu(21)).toBe(Math.max(900_000, 29 * 38_100));
    expect(minimumQrSizeEmu(177)).toBe(185 * 38_100);
  });

  it('rejects module counts outside 21..177 step 4', () => {
    expect(() => minimumQrSizeEmu(20)).toThrow(RangeError);
    expect(() => minimumQrSizeEmu(22)).toThrow(RangeError);
    expect(() => minimumQrSizeEmu(181)).toThrow(RangeError);
  });
});

describe('qrUrlsInText', () => {
  it('reads consecutive URLs as separate tokens', () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://ex.test/${i}`);
    expect(qrUrlsInText(urls.join(' '))).toEqual(urls);
  });

  it('keeps parentheses, semicolons and signed query tails inside complete URL tokens', () => {
    const url = 'https://ex.test/a?sig=(x)&k=2;';
    expect(qrUrlsInText(`Ссылка [источник](${url}) и <${url}>`)).toEqual([url]);
    expect(qrUrlsInText(url)).toEqual([url]);
    expect(qrUrlsInText('https://evil.test/?next=(https://ex.test/ok)')).toEqual([
      'https://evil.test/?next=(https://ex.test/ok)',
    ]);
    expect(qrUrlsInText(url)).not.toContain('https://ex.test/a?sig=');
    expect(qrUrlsInText(url)).not.toContain(url.slice(0, -1));
    expect(qrUrlsInText('https://ex.test/?sig="abc"')).toEqual(['https://ex.test/?sig="abc"']);
    expect(qrUrlsInText('https://ex.test/?sig=`abc`')).toEqual(['https://ex.test/?sig=`abc`']);
  });

  it('does not attest nested query URLs or hostname/path prefixes', () => {
    const url = 'https://evil.test/a?next=https://ex.test/ok';
    expect(qrUrlsInText(url)).toEqual([url]);
    expect(qrUrlsInText('xhttps://ex.test/ok')).toEqual([]);
    expect(qrUrlsInText('xhttps://evil.test/?next=(https://ex.test/ok)')).toEqual([]);
    expect(qrUrlsInText('(https://ex.test/ok)', { startComplete: false })).toEqual([]);
    expect(qrUrlsInText('https://ex.test.evil/ok')).not.toContain('https://ex.test');
  });
});
