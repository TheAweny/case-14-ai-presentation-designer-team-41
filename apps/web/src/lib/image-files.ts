'use client';

import { uploadedMedia, type MediaRegistry } from '@/lib/media-registry';

/** Пиксельный размер картинки. Нужен только ради пропорций рамки на слайде. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Картинки из перетаскивания или буфера обмена. Остальные файлы молча пропускаются. */
export function imageFilesOf(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files = [...transfer.files].filter(isImageFile);
  if (files.length > 0) return files;
  // Скриншот из буфера бывает только в items, без files.
  return [...transfer.items]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .flatMap((item) => {
      const file = item.getAsFile();
      return file ? [file] : [];
    });
}

/** Перетаскивают ли сейчас файлы. Содержимое до drop браузер не показывает, только типы. */
export function carriesFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && [...transfer.types].includes('Files'));
}

/**
 * Системный выбор файла. Отмена даёт пустой список: вставка тогда просто не случается, и на
 * слайде не остаётся пустой рамки.
 */
export function pickImageFiles({ multiple = false } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    let settled = false;
    const settle = (files: File[]) => {
      if (settled) return;
      settled = true;
      resolve(files);
    };
    input.addEventListener('change', () => settle([...(input.files ?? [])].filter(isImageFile)));
    input.addEventListener('cancel', () => settle([]));
    input.click();
  });
}

/** Естественный размер. Null, если браузер картинку не прочёл (у SVG без размеров он нулевой). */
export async function naturalSize(url: string): Promise<ImageSize | null> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Файл в реестр вкладки: `mediaPart` для SlideIR и размер для пропорций рамки. */
export async function registerImage(
  file: File,
  registry: MediaRegistry = uploadedMedia,
): Promise<{ mediaPart: string; size: ImageSize | null }> {
  const mediaPart = registry.register(file);
  const url = registry.url(mediaPart);
  return { mediaPart, size: url ? await naturalSize(url) : null };
}
