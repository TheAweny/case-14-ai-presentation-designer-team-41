import type { SlideIr } from '@lct/contracts';
import { fontFamily } from '@lct/slide-renderer';

/**
 * Готовность того, без чего первый кадр страницы выглядит не так, как задуман: шрифтов шаблона
 * и картинок открытого слайда. Сбой или долгая загрузка страницу не запирают: по истечении
 * `ASSETS_TIMEOUT_MS` она открывается с тем, что есть, а остальное дорисуется само.
 */

export const ASSETS_TIMEOUT_MS = 4000;

/** Выполняется, когда `task` завершился как угодно или вышло `ms`. Никогда не отклоняется. */
export function settleWithin(task: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    task.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

/** Часть `FontFaceSet`, которая нужна здесь: подменяется в тестах. */
export interface FontLoader {
  load(font: string): Promise<unknown>;
  readonly ready: Promise<unknown>;
}

/**
 * Шрифты шаблона загружены или точно недоступны. Отсутствующий шрифт — не ошибка: браузер
 * нарисует запасной из стека.
 */
export async function loadFonts(families: readonly string[], fonts: FontLoader): Promise<void> {
  await Promise.allSettled(
    families.flatMap((family) => {
      const stack = fontFamily(family);
      return stack ? [fonts.load(`1em ${stack}`)] : [];
    }),
  );
  await fonts.ready;
}

/** Часть `HTMLImageElement`, которая нужна здесь: подменяется в тестах. */
export interface DecodableImage {
  src: string;
  decode(): Promise<void>;
}

/** Картинки загружены и раскодированы, битые пропущены. */
export async function decodeImages(
  urls: readonly string[],
  createImage: () => DecodableImage,
): Promise<void> {
  await Promise.allSettled(
    urls.map((url) => {
      const image = createImage();
      image.src = url;
      return image.decode();
    }),
  );
}

/** Адреса картинок слайда, которые источник смог отдать, без повторов. */
export function slideImageUrls(
  slide: Pick<SlideIr, 'elements'>,
  media: Readonly<Record<string, string>>,
): string[] {
  const urls = new Set<string>();
  for (const element of slide.elements) {
    if (element.kind !== 'image') continue;
    const url = media[element.mediaPart];
    if (url) urls.add(url);
  }
  return [...urls];
}
