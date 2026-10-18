/**
 * Десять готовых портретов. Номер — индекс `preset:N`, файлы — квадрат 256 px в `public/avatars`.
 * В ряду мужские и женские чередуются. Круг обрезает обёртка.
 */
const PRESET_SRC = [
  '/avatars/0.webp',
  '/avatars/1.webp',
  '/avatars/2.webp',
  '/avatars/3.webp',
  '/avatars/4.webp',
  '/avatars/5.webp',
  '/avatars/6.webp',
  '/avatars/7.webp',
  '/avatars/8.webp',
  '/avatars/9.webp',
] as const;

/** Портрет номер `index`, во весь свой контейнер. */
export function AvatarMark({ index }: { index: number }) {
  const src = PRESET_SRC[index] ?? PRESET_SRC[0];
  return <img src={src} alt="" draggable={false} className="block size-full object-cover" />;
}
