import { AVATAR_IMAGE_SIZE, MAX_AVATAR_LENGTH } from './avatars';

/** Почему фото не подошло: не картинка, не читается или не ужимается до предела API. */
export type AvatarImageProblem = 'notImage' | 'unreadable' | 'tooLarge';

export class AvatarImageError extends Error {
  constructor(readonly problem: AvatarImageProblem) {
    super(problem);
  }
}

/** Файл больше этого не читаем: телефонные фото меньше, а гигабайт повесил бы вкладку. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Фото, выбранное человеком, как его хранит API: квадрат 256 px, WebP (там, где браузер его не
 * пишет, — JPEG). У вертикального снимка квадрат берётся ближе к верху — там обычно лицо, и
 * середина кадра срезала бы голову. Ужимаем здесь, в браузере: на сервер уходят десятки
 * килобайт, а не снимок с телефона.
 */

/**
 * Верх квадрата в исходном кадре. У портрета над кадром остаётся 15% лишней высоты: лицо обычно
 * выше середины. У квадрата и широкого снимка сдвигать нечего — квадрат и так на всю высоту.
 */
export function portraitCropTop(width: number, height: number, side: number): number {
  const spare = height - side;
  if (spare <= 0 || height <= width) return 0;
  return spare * 0.15;
}

export async function avatarFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new AvatarImageError('notImage');
  if (file.size > MAX_FILE_BYTES) throw new AvatarImageError('tooLarge');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AvatarImageError('unreadable');
  }
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_IMAGE_SIZE;
  canvas.height = AVATAR_IMAGE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new AvatarImageError('unreadable');
  const side = Math.min(bitmap.width, bitmap.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    portraitCropTop(bitmap.width, bitmap.height, side),
    side,
    side,
    0,
    0,
    AVATAR_IMAGE_SIZE,
    AVATAR_IMAGE_SIZE,
  );
  bitmap.close();
  for (const [type, quality] of [
    ['image/webp', 0.86],
    ['image/jpeg', 0.86],
    ['image/jpeg', 0.7],
  ] as const) {
    const url = canvas.toDataURL(type, quality);
    // Браузер без кодировщика WebP молча отдаёт PNG: такой результат пропускаем.
    if (url.startsWith(`data:${type};`) && url.length <= MAX_AVATAR_LENGTH) return url;
  }
  throw new AvatarImageError('tooLarge');
}
