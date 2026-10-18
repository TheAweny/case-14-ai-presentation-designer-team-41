import type { SlideIr } from '@lct/contracts';
import { uploadedMedia, type MediaRegistry } from './media-registry';
import { uploadPartsOf } from './deck-draft';

export const EXPORT_MEDIA_COUNT = 32;
export const EXPORT_MEDIA_BYTES = 1024 * 1024;
export const EXPORT_MEDIA_TOTAL = 3 * 1024 * 1024;

function dimensions(bytes: Uint8Array, type: string): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') {
    if (
      bytes.length < 33 ||
      ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) ||
      view.getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
    )
      return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (
    bytes.length < 4 ||
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    bytes.at(-2) !== 255 ||
    bytes.at(-1) !== 217
  )
    return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 218 || marker === 217) return null;
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8) return null;
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += length;
  }
  return null;
}

/** Only referenced uploads are sent. A missing local file must never silently disappear. */
export async function collectExportMedia(
  slides: readonly SlideIr[],
  registry: Pick<MediaRegistry, 'file'> = uploadedMedia,
  signal?: AbortSignal,
): Promise<{ mediaPart: string; dataUrl: string }[]> {
  signal?.throwIfAborted();
  const parts = uploadPartsOf(slides);
  if (parts.length > EXPORT_MEDIA_COUNT)
    throw new Error('Можно экспортировать не более 32 загруженных изображений.');
  let total = 0;
  const media: { mediaPart: string; dataUrl: string }[] = [];
  for (const mediaPart of parts) {
    signal?.throwIfAborted();
    if (!/^upload\/[\w.-]+\.(png|jpe?g)$/.test(mediaPart))
      throw new Error(
        'Экспорт поддерживает загруженные изображения PNG и JPEG с расширением строчными буквами.',
      );
    const file = registry.file(mediaPart);
    if (!file) throw new Error(`Не найден файл изображения ${mediaPart}. Загрузите его заново.`);
    if (
      !['image/png', 'image/jpeg'].includes(file.type) ||
      (file.type === 'image/png') !== /\.png$/i.test(mediaPart)
    )
      throw new Error('Формат изображения должен быть PNG или JPEG и соответствовать расширению.');
    total += file.size;
    if (!file.size || file.size > EXPORT_MEDIA_BYTES || total > EXPORT_MEDIA_TOTAL)
      throw new Error(
        'Изображение должно быть не больше 1 МиБ, все изображения — не больше 3 МиБ.',
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal?.throwIfAborted();
    const size = dimensions(bytes, file.type);
    if (
      !size ||
      size.width < 1 ||
      size.height < 1 ||
      size.width > 8192 ||
      size.height > 8192 ||
      size.width * size.height > 40_000_000
    )
      throw new Error('Изображение повреждено или имеет слишком большой размер.');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      signal?.throwIfAborted();
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    media.push({ mediaPart, dataUrl: `data:${file.type};base64,${btoa(binary)}` });
  }
  signal?.throwIfAborted();
  return media;
}
