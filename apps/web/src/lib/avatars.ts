/**
 * Аватар аккаунта. Вместо инициалов — один из десяти портретов: у каждого человека свой, и он не
 * меняется от входа к входу. Портрет выбирается по id, пока человек не взял другой или не загрузил
 * своё фото.
 *
 * Значение, как его хранит API: null — портрет по id, `preset:N` — выбранный портрет, иначе картинка
 * (data URL квадрата 256 px, который сделал браузер).
 *
 * Модуль без React и DOM: выбор портрета и чтение значения проверяются тестами.
 */

/** Сколько портретов на выбор. Номера — индексы картинок в `AvatarMark`. */
export const AVATAR_PRESETS = 10;

export type AvatarView =
  | { readonly kind: 'mark'; readonly index: number }
  | { readonly kind: 'image'; readonly src: string };

/** Портрет по id: один и тот же для человека, и разные люди расходятся по всем портретам ровно. */
export function defaultAvatarIndex(userId: string): number {
  // FNV-1a: у похожих id (подряд выданных UUID) портреты всё равно разные.
  let hash = 0x811c9dc5;
  for (const char of userId) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % AVATAR_PRESETS;
}

/** Что показать: своё фото, выбранный портрет или портрет по id, если значение пустое или чужое. */
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

/** Значение выбранного портрета, как его сохраняет API. */
export function presetAvatar(index: number): string {
  return `preset:${index}`;
}

/** Сторона картинки, которую браузер отправляет: втрое больше самого крупного показа. */
export const AVATAR_IMAGE_SIZE = 256;
/** Предел API на картинку; браузер сжимает до него, прежде чем отправить. */
export const MAX_AVATAR_LENGTH = 200_000;
