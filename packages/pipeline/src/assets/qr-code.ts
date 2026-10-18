import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { qrUrlSchema } from '@lct/contracts';

const QUIET_ZONE_MODULES = 4;
const MODULE_SCALE = 8;
const EMU_PER_MODULE = 38_100;
const MIN_QR_SIZE_EMU = 900_000;

export interface QrCodeImage {
  png: Buffer;
  encodedUrl: string;
  sha256: string;
  width: number;
  height: number;
  moduleCount: number;
  quietZoneModules: 4;
}

/** Exact tokens, including signed query punctuation; only explicit text wrappers are removed. */
export function qrUrlsInText(
  text: string,
  boundaries: { startComplete?: boolean; endComplete?: boolean } = {},
): string[] {
  const urls: string[] = [];
  const starts = /(^|[\s<("'`])https?:\/\//gi;
  let match: RegExpExecArray | null;
  while ((match = starts.exec(text)) !== null) {
    const wrapper = match[1] ?? '';
    const start = match.index + wrapper.length;
    let end = start;
    let depth = 0;
    for (; end < text.length; end += 1) {
      const char = text.charAt(end);
      if (/\s/u.test(char)) break;
      if (wrapper === '<' && char === '>') break;
      if (['"', "'", '`'].includes(wrapper) && char === wrapper) break;
      if (wrapper === '(') {
        if (char === '(') depth += 1;
        if (char === ')') {
          if (depth === 0) break;
          depth -= 1;
        }
      }
    }
    // Skip the whole token, so a nested URL in a query cannot become separate evidence.
    starts.lastIndex = end;
    const url = text.slice(start, end);
    let boundary = match.index;
    if (!/\s/u.test(wrapper)) {
      while (boundary > 0 && !/\s/u.test(text.charAt(boundary - 1))) boundary -= 1;
    }
    const prefix = text.slice(boundary, match.index);
    if (
      /https?:\/\/|[?&=]/i.test(prefix) ||
      (boundaries.startComplete === false && boundary === 0 && !/\s/u.test(wrapper)) ||
      (end === text.length && boundaries.endComplete === false)
    )
      continue;
    if (qrUrlSchema.safeParse(url).success) urls.push(url);
  }
  return [...new Set(urls)];
}

/**
 * Smallest square that still leaves four modules of quiet zone on every side and stays at least
 * 2.5 cm. `n` is the symbol module count (21..177, step 4); the quiet zone is added on top.
 */
export function minimumQrSizeEmu(moduleCount: number): number {
  if (
    !Number.isInteger(moduleCount) ||
    moduleCount < 21 ||
    moduleCount > 177 ||
    (moduleCount - 21) % 4 !== 0
  ) {
    throw new RangeError(`QR module count must be 21..177 in steps of 4, got ${moduleCount}`);
  }
  return Math.max(MIN_QR_SIZE_EMU, (moduleCount + QUIET_ZONE_MODULES * 2) * EMU_PER_MODULE);
}

/**
 * PNG of `rawUrl` encoded as UTF-8 bytes. The string is not normalized, rewritten, or trimmed:
 * `new URL` only rejects values that are not an http(s) URL.
 */
export async function generateQrCode(rawUrl: string): Promise<QrCodeImage> {
  const encodedUrl = qrUrlSchema.parse(rawUrl);
  const bytes = Buffer.from(encodedUrl, 'utf8');
  const symbol = QRCode.create([{ data: bytes, mode: 'byte' }], { errorCorrectionLevel: 'M' });
  const moduleCount = symbol.modules.size;
  const png = await QRCode.toBuffer([{ data: bytes, mode: 'byte' }], {
    errorCorrectionLevel: 'M',
    margin: QUIET_ZONE_MODULES,
    scale: MODULE_SCALE,
    color: { dark: '#000000', light: '#ffffff' },
  });
  const side = (moduleCount + QUIET_ZONE_MODULES * 2) * MODULE_SCALE;
  return {
    png,
    encodedUrl,
    sha256: createHash('sha256').update(png).digest('hex'),
    width: side,
    height: side,
    moduleCount,
    quietZoneModules: QUIET_ZONE_MODULES,
  };
}
