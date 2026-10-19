import { BadRequestException } from '@nestjs/common';

const PART = /^upload\/[\w.-]+\.(png|jpe?g)$/;
const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
const MAX_BYTES = 1024 * 1024;

export interface DecodedEditorMedia {
  readonly mediaPart: string;
  readonly bytes: Buffer;
  readonly contentType: 'image/png' | 'image/jpeg';
}

/** Decode one uploaded picture. The path is the media part, never a client filesystem path. */
export function decodeEditorMedia(mediaPart: string, dataUrl: string): DecodedEditorMedia {
  const fail = (): never => {
    throw new BadRequestException(
      'Invalid editor media. Use a PNG or JPEG data URL of at most 1 MiB.',
    );
  };
  if (!PART.test(mediaPart) || dataUrl.length > Math.ceil(MAX_BYTES / 3) * 4 + 32) fail();
  const match = DATA_URL.exec(dataUrl);
  if (match === null) {
    throw new BadRequestException(
      'Invalid editor media. Use a PNG or JPEG data URL of at most 1 MiB.',
    );
  }
  const kind = match[1] ?? '';
  const payload = match[2] ?? '';
  if (!kind || !payload || payload.length % 4 !== 0) fail();
  if ((kind === 'png') !== mediaPart.endsWith('.png')) fail();
  const bytes = Buffer.from(payload, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== payload) fail();
  const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
  if (kind === 'png' ? !png : !jpeg) fail();
  return {
    mediaPart,
    bytes,
    contentType: kind === 'png' ? 'image/png' : 'image/jpeg',
  };
}
