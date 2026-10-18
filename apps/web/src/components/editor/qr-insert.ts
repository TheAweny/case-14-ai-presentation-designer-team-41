import { qrUrlSchema, type Grid, type SlideElement } from '@lct/contracts';

const PNG_PREFIX = 'data:image/png;base64,';
/** The chat part carries the PNG inline, so the payload stays small enough for a message. */
export const QR_PNG_LIMIT = 262_144;

/** What the QR card knows about the code. The API part matches this shape. */
export interface QrInsertPart {
  readonly url: string;
  readonly pngDataUrl: string;
  readonly width: number;
  readonly height: number;
  readonly moduleCount: number;
  readonly minSizeEmu: number;
}

export type QrInsertFailure = 'invalid-url' | 'invalid-png' | 'invalid-size';

/**
 * Where a square code can sit inside the slide's content area.
 * Null when even the minimum readable size does not fit.
 */
export interface QrPlacement {
  readonly box: { x: number; y: number; cx: number; cy: number };
  readonly side: number;
}

export function qrPngBytes(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith(PNG_PREFIX) || dataUrl.length > QR_PNG_LIMIT) return null;
  const payload = dataUrl.slice(PNG_PREFIX.length);
  if (!payload || payload.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return null;
  try {
    const binary = atob(payload);
    if (btoa(binary) !== payload) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)
    )
      return null;
    const view = new DataView(bytes.buffer);
    if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR')
      return null;
    return bytes;
  } catch {
    return null;
  }
}

/** The part is a real QR only when the link, the PNG and the readable size all hold. */
export function qrInsertFailure(part: QrInsertPart): QrInsertFailure | null {
  if (!qrUrlSchema.safeParse(part.url).success) return 'invalid-url';
  const bytes = qrPngBytes(part.pngDataUrl);
  if (bytes === null) return 'invalid-png';
  if (
    !Number.isInteger(part.width) ||
    !Number.isInteger(part.height) ||
    !Number.isInteger(part.moduleCount) ||
    !Number.isInteger(part.minSizeEmu) ||
    part.moduleCount < 21 ||
    part.moduleCount > 177 ||
    (part.moduleCount - 21) % 4 !== 0 ||
    part.width !== (part.moduleCount + 8) * 8 ||
    part.height !== part.width ||
    !Number.isSafeInteger(part.minSizeEmu) ||
    part.minSizeEmu < Math.max(900000, (part.moduleCount + 8) * 38100) ||
    part.minSizeEmu > 7048500
  ) {
    return 'invalid-size';
  }
  const view = new DataView(bytes.buffer);
  if (view.getUint32(16) !== part.width || view.getUint32(20) !== part.height) return 'invalid-png';
  return null;
}

/**
 * A square, centred in the content area, at least `minimumSizeEmu` on a side and no larger than
 * the area or the slide. The content margins are the home of generated content; the slide edges
 * are the hard bound.
 */
export function placeQr(grid: Grid, minimumSizeEmu: number): QrPlacement | null {
  if (!Number.isSafeInteger(minimumSizeEmu) || minimumSizeEmu < 900000) return null;
  if (
    ![
      grid.slideCx,
      grid.slideCy,
      grid.marginLeft,
      grid.marginRight,
      grid.marginTop,
      grid.marginBottom,
    ].every((value) => Number.isSafeInteger(value) && value >= 0)
  )
    return null;
  const contentCx = grid.slideCx - grid.marginLeft - grid.marginRight;
  const contentCy = grid.slideCy - grid.marginTop - grid.marginBottom;
  if (contentCx < minimumSizeEmu || contentCy < minimumSizeEmu) return null;
  if (grid.slideCx < minimumSizeEmu || grid.slideCy < minimumSizeEmu) return null;
  const side = Math.min(
    contentCx,
    contentCy,
    Math.max(minimumSizeEmu, Math.round(contentCy * 0.25)),
  );
  const x = grid.marginLeft + Math.round((contentCx - side) / 2);
  const y = grid.marginTop + Math.round((contentCy - side) / 2);
  if (x < 0 || y < 0 || x + side > grid.slideCx || y + side > grid.slideCy) return null;
  return { box: { x, y, cx: side, cy: side }, side };
}

/**
 * One image element for the QR. The caller already registered the file; this only builds the IR.
 * `contain` keeps the quiet zone: the box is square and the picture is square.
 */
export function qrImageElement(
  mediaPart: string,
  box: QrPlacement['box'],
  elementId: string,
): SlideElement {
  return {
    kind: 'image',
    elementId,
    role: 'image',
    box: { ...box },
    sourceShapeId: null,
    mediaPart,
    fit: 'contain',
  };
}
