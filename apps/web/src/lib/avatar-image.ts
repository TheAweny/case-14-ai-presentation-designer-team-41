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
 * Фото, выбранное человеком, как его хранит API: квадрат из середины кадра, 256 px, WebP (там,
 * где браузер его не пишет, — JPEG). Ужимаем здесь, в браузере: на сервер уходят десятки
 * килобайт, а не снимок с телефона.
 */
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
    (bitmap.height - side) / 2,
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
