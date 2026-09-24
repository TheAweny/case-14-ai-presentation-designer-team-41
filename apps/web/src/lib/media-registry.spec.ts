import { describe, expect, it, vi } from 'vitest';
import { createMediaRegistry, isUploadPart, UPLOAD_PREFIX } from './media-registry';

function registry() {
  const created: string[] = [];
  const revoked: string[] = [];
  let seq = 0;
  return {
    revoked,
    created,
    media: createMediaRegistry({
      createUrl: (file) => {
        const url = `blob:${file.name}`;
        created.push(url);
        return url;
      },
      revokeUrl: (url) => revoked.push(url),
      nextId: () => `id-${(seq += 1)}`,
    }),
  };
}

function file(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe('media registry', () => {
  it('выдаёт часть с расширением файла и адрес по ней', () => {
    const { media } = registry();
    const part = media.register(file('Схема.PNG'));
    expect(part).toBe(`${UPLOAD_PREFIX}id-1.png`);
    expect(isUploadPart(part)).toBe(true);
    expect(media.url(part)).toBe('blob:Схема.PNG');
    expect(media.url('ppt/media/image1.png')).toBeNull();
  });

  it('берёт расширение из типа, когда в имени его нет', () => {
    const { media } = registry();
    expect(media.register(file('clipboard', 'image/jpeg'))).toBe(`${UPLOAD_PREFIX}id-1.jpg`);
    expect(media.register(file('clipboard', 'image/svg+xml'))).toBe(`${UPLOAD_PREFIX}id-2.svg`);
    expect(media.register(file('clipboard', 'application/octet-stream'))).toBe(
      `${UPLOAD_PREFIX}id-3.bin`,
    );
  });

  it('сообщает подписчикам о новом файле и растит версию', () => {
    const { media } = registry();
    const listener = vi.fn();
    const stop = media.subscribe(listener);
    expect(media.version()).toBe(0);
    media.register(file('a.png'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(media.version()).toBe(1);
    stop();
    media.register(file('b.png'));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(media.version()).toBe(2);
  });

  it('отпускает адреса по clear', () => {
    const { media, created, revoked } = registry();
    const part = media.register(file('a.png'));
    media.clear();
    expect(revoked).toEqual(created);
    expect(media.url(part)).toBeNull();
  });
});
