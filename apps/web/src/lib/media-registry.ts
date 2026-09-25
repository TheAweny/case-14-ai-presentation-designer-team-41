'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Картинки, которые пользователь положил на слайд в этой вкладке.
 *
 * В SlideIR у картинки есть только `mediaPart` — имя части внутри пакета или путь в каталоге
 * прогона. Загрузки API пока нет, поэтому часть выдаёт этот реестр (`upload/<id>.<ext>`), а адрес
 * для браузера живёт рядом как blob-URL. Когда появится загрузка, `mediaPart` останется тем же, а
 * адрес начнёт приходить с сервера: слайд от этого не меняется.
 */

/** Префикс частей, которые загрузил пользователь. По нему видно, чей адрес спрашивать. */
export const UPLOAD_PREFIX = 'upload/';

export function isUploadPart(mediaPart: string): boolean {
  return mediaPart.startsWith(UPLOAD_PREFIX);
}

/** Расширения по типу файла, когда в имени его нет. */
const EXTENSION_OF: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function extensionOf(file: File): string {
  const fromName = /\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1]?.toLowerCase();
  return fromName ?? EXTENSION_OF[file.type.toLowerCase()] ?? 'bin';
}

export interface MediaRegistry {
  /** Положить файл в реестр и получить `mediaPart` для SlideIR. */
  register(file: File): string;
  /** Адрес для браузера или null, если части в реестре нет: тогда на слайде рамка. */
  url(mediaPart: string): string | null;
  /** Сам файл части — для черновика колоды. Null, если части в реестре нет. */
  file(mediaPart: string): Blob | null;
  /**
   * Вернуть в реестр файл под прежним `mediaPart`: черновик колоды после перезагрузки.
   * Часть, которая уже есть, не заменяется.
   */
  restore(mediaPart: string, file: Blob): void;
  /** Подписка на изменения: реестр живёт вне React, а холст должен перерисоваться. */
  subscribe(listener: () => void): () => void;
  /** Номер версии реестра: растёт на каждую регистрацию. */
  version(): number;
  /** Отпустить все адреса. Нужно, когда вкладка закрывает колоду. */
  clear(): void;
}

export interface MediaRegistryOptions {
  readonly createUrl?: (file: Blob) => string;
  readonly revokeUrl?: (url: string) => void;
  readonly nextId?: () => string;
}

export function createMediaRegistry(options: MediaRegistryOptions = {}): MediaRegistry {
  const createUrl = options.createUrl ?? ((file: Blob) => URL.createObjectURL(file));
  const revokeUrl = options.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url));
  const nextId = options.nextId ?? (() => crypto.randomUUID());
  const urls = new Map<string, string>();
  const files = new Map<string, Blob>();
  const listeners = new Set<() => void>();
  let version = 0;

  const announce = () => {
    version += 1;
    for (const listener of listeners) listener();
  };

  return {
    register(file) {
      const mediaPart = `${UPLOAD_PREFIX}${nextId()}.${extensionOf(file)}`;
      urls.set(mediaPart, createUrl(file));
      files.set(mediaPart, file);
      announce();
      return mediaPart;
    },
    url: (mediaPart) => urls.get(mediaPart) ?? null,
    file: (mediaPart) => files.get(mediaPart) ?? null,
    restore(mediaPart, file) {
      if (urls.has(mediaPart)) return;
      urls.set(mediaPart, createUrl(file));
      files.set(mediaPart, file);
      announce();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    clear() {
      for (const url of urls.values()) revokeUrl(url);
      urls.clear();
      files.clear();
      announce();
    },
  };
}

/** Реестр вкладки. Один на приложение: адреса blob живут столько же, сколько документ. */
export const uploadedMedia = createMediaRegistry();

/**
 * Резолвер адресов для `SlideView`: сначала то, что загрузил пользователь, затем то, что отдал
 * источник колоды. Пересоздаётся, когда в реестр добавили файл, чтобы холст перерисовался.
 */
export function useMediaResolver(
  media: Readonly<Record<string, string>>,
  registry: MediaRegistry = uploadedMedia,
): (mediaPart: string) => string | null {
  const version = useSyncExternalStore(registry.subscribe, registry.version, () => 0);
  return useCallback(
    (mediaPart: string) => {
      void version;
      return registry.url(mediaPart) ?? media[mediaPart] ?? null;
    },
    [media, registry, version],
  );
}
