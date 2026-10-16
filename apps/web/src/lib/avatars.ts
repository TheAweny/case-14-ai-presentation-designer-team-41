/**
 * Аватар аккаунта. Вместо инициалов — абстрактный знак: у каждого человека свой, и он не меняется
 * от входа к входу. Знак выбирается по id, пока человек не взял другой или не загрузил картинку.
 *
 * Значение, как его хранит API: null — знак по id, `preset:N` — выбранный знак, иначе картинка
 * (data URL квадрата 256 px, который сделал браузер).
 *
 * Модуль без React и DOM: выбор знака и чтение значения проверяются тестами.
 */

/** Сколько знаков на выбор. Номера — индексы в `AVATAR_MARKS` компонента. */
export const AVATAR_PRESETS = 10;

export type AvatarView =
  | { readonly kind: 'mark'; readonly index: number }
  | { readonly kind: 'image'; readonly src: string };

/** Знак по id: один и тот же для человека, и разные люди расходятся по всем знакам ровно. */
export function defaultAvatarIndex(userId: string): number {
  // FNV-1a: у похожих id (подряд выданных UUID) знаки всё равно разные.
  let hash = 0x811c9dc5;
  for (const char of userId) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % AVATAR_PRESETS;
}

/** Что показать: картинку, выбранный знак или знак по id, если значение пустое или чужое. */
export function avatarView(avatar: string | null | undefined, userId: string): AvatarView {
  if (avatar && /^data:image\/(png|jpeg|webp);base64,/.test(avatar)) {
    return { kind: 'image', src: avatar };
  }
  const preset = avatar ? /^preset:(\d+)$/.exec(avatar) : null;
  const index = preset ? Number(preset[1]) : NaN;
  return {
    kind: 'mark',
    index: Number.isInteger(index) && index < AVATAR_PRESETS ? index : defaultAvatarIndex(userId),
  };
}

/** Значение выбранного знака, как его сохраняет API. */
export function presetAvatar(index: number): string {
  return `preset:${index}`;
}

/** Сторона картинки, которую браузер отправляет: втрое больше самого крупного показа. */
export const AVATAR_IMAGE_SIZE = 256;
/** Предел API на картинку; браузер сжимает до него, прежде чем отправить. */
export const MAX_AVATAR_LENGTH = 200_000;
