'use client';

import { useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AvatarMark } from '@/components/auth/avatar-mark';
import { PlusIcon, SpinnerIcon } from '@/components/ui/icons';
import { updateOwnAvatarAction } from '@/app/users-actions';
import { AvatarImageError, avatarFromFile } from '@/lib/avatar-image';
import { AVATAR_PRESETS, avatarView, defaultAvatarIndex, presetAvatar } from '@/lib/avatars';
import type { Account } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** Кружок выбора: портрет или фото, отмеченный — с кольцом, нажатие — лёгкое сжатие. */
const optionClass = cn(
  'relative block size-10 shrink-0 overflow-hidden rounded-full outline-none',
  'ring-1 ring-black/5 dark:ring-white/10',
  'transition-[transform,box-shadow] duration-150 ease-out motion-reduce:transition-none',
  'active:scale-95 motion-reduce:active:scale-100',
  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
  'aria-checked:ring-2 aria-checked:ring-foreground aria-checked:ring-offset-2 aria-checked:ring-offset-background',
  '[@media(hover:hover)]:hover:ring-foreground/40',
);

/**
 * Аватар в настройках аккаунта: один из десяти портретов или своё фото. Выбор сохраняется сразу,
 * без кнопки «Сохранить»; не сохранился — возвращается прежний и видно почему. Портрет по умолчанию
 * помечен: к нему можно вернуться, и он же у всех, кто ничего не выбирал.
 */
export function AvatarPicker({ account }: { account: Account }) {
  const t = useTranslations('settings.account.avatar');
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [value, setValue] = useState<string | null>(account.avatar ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const view = avatarView(value, account.userId);
  const ownIndex = defaultAvatarIndex(account.userId);
  // Фото остаётся в ряду, пока человек не загрузил другое: к нему можно вернуться после портрета.
  const [photo, setPhoto] = useState<string | null>(view.kind === 'image' ? view.src : null);

  const save = (next: string | null) => {
    const previous = value;
    setValue(next);
    setError(null);
    startSaving(async () => {
      const result = await updateOwnAvatarAction(next).catch(() => null);
      if (result?.ok) {
        router.refresh();
        return;
      }
      setValue(previous);
      setError(result?.reason === 'invalid' ? t('rejected') : t('failed'));
    });
  };

  const pickMark = (index: number) =>
    // Свой портрет по умолчанию храним как пустое значение: так он и останется «по id».
    save(index === ownIndex ? null : presetAvatar(index));

  const upload = async (file: File) => {
    setError(null);
    try {
      const src = await avatarFromFile(file);
      setPhoto(src);
      save(src);
    } catch (problem) {
      setError(t(problem instanceof AvatarImageError ? problem.problem : 'unreadable'));
    }
  };

  const options: readonly { key: string; checked: boolean; select: () => void }[] = [
    ...Array.from({ length: AVATAR_PRESETS }, (_, index) => ({
      key: `mark-${index}`,
      checked: view.kind === 'mark' && view.index === index,
      select: () => pickMark(index),
    })),
    ...(photo ? [{ key: 'photo', checked: view.kind === 'image', select: () => save(photo) }] : []),
  ];

  // Стрелки ходят по кружкам, как в любой группе переключателей.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const at = options.findIndex((option) => option.checked);
    const next = options[(at + step + options.length) % options.length];
    if (!next) return;
    next.select();
    event.currentTarget.querySelector<HTMLElement>(`[data-option="${next.key}"]`)?.focus();
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={titleId}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={titleId} className="text-sm font-medium">
          {t('title')}
        </h3>
        <span
          aria-live="polite"
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          {saving ? (
            <>
              <SpinnerIcon className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
              {t('saving')}
            </>
          ) : null}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="flex flex-wrap items-center gap-3"
      >
        {Array.from({ length: AVATAR_PRESETS }, (_, index) => {
          const option = options[index];
          return (
            <button
              key={index}
              type="button"
              role="radio"
              data-option={option?.key}
              aria-checked={option?.checked ?? false}
              aria-label={
                index === ownIndex
                  ? t('markOwn', { number: index + 1 })
                  : t('mark', { number: index + 1 })
              }
              title={index === ownIndex ? t('ownHint') : undefined}
              tabIndex={option?.checked ? 0 : -1}
              onClick={() => pickMark(index)}
              className={optionClass}
            >
              <AvatarMark index={index} />
              {index === ownIndex ? (
                // Точка у своего портрета: тот, что выдан по id, и к нему вернёт любой выбор.
                <span
                  aria-hidden
                  className="absolute right-0.5 bottom-0.5 size-2 rounded-full bg-background ring-2 ring-foreground/70"
                />
              ) : null}
            </button>
          );
        })}
        {photo ? (
          <button
            type="button"
            role="radio"
            data-option="photo"
            aria-checked={view.kind === 'image'}
            aria-label={t('photo')}
            tabIndex={view.kind === 'image' ? 0 : -1}
            onClick={() => save(photo)}
            className={optionClass}
          >
            {/* Картинка — квадрат 256 px из браузера. */}
            <img src={photo} alt="" className="block size-full object-cover" draggable={false} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-full border border-dashed border-border',
            'text-muted-foreground outline-none transition-[transform,color,border-color] duration-150 ease-out',
            'active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
            'focus-visible:ring-2 focus-visible:ring-ring',
            '[@media(hover:hover)]:hover:border-foreground/40 [@media(hover:hover)]:hover:text-foreground',
          )}
          aria-label={photo ? t('replacePhoto') : t('uploadPhoto')}
          title={photo ? t('replacePhoto') : t('uploadPhoto')}
        >
          <PlusIcon className="size-4" aria-hidden />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/heic,image/avif"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void upload(file);
          }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {error ? (
          <span className="text-destructive">{error}</span>
        ) : view.kind === 'image' ? (
          t('photoHint')
        ) : view.index === ownIndex ? (
          t('ownHint')
        ) : (
          t('pickedHint')
        )}
      </p>
    </section>
  );
}
