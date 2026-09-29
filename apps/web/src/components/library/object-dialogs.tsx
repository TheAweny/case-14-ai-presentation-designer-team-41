'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Диалоги меню объектов: переименование и подтверждение удаления. Куда вернуть фокус после
 * закрытия, решает владелец объекта (`onCloseAutoFocus`): после отмены — на объект, после
 * удаления — на соседа.
 */

/**
 * Новое имя в диалоге. Enter сохраняет, пустое не принимается, длину держит само поле.
 * `onSave` получает обрезанное имя или null, если имя не изменилось.
 */
export function RenameDialog({
  open,
  onOpenChange,
  title,
  label,
  value,
  maxLength,
  onSave,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  label: string;
  value: string;
  maxLength: number;
  onSave: (next: string | null) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useTranslations('libraryMenu');
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('close')}
        className="max-w-sm gap-4"
        onOpenAutoFocus={(event) => {
          // Имя сразу выделено: новое печатают поверх, как в проводнике.
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <RenameForm
          inputRef={input}
          title={title}
          label={label}
          value={value}
          maxLength={maxLength}
          onCancel={() => onOpenChange(false)}
          onSave={(next) => {
            onOpenChange(false);
            onSave(next);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Форма живёт, пока открыт диалог: каждое открытие начинается с текущего имени. */
function RenameForm({
  inputRef,
  title,
  label,
  value,
  maxLength,
  onCancel,
  onSave,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  title: string;
  label: string;
  value: string;
  maxLength: number;
  onCancel: () => void;
  onSave: (next: string | null) => void;
}) {
  const t = useTranslations('libraryMenu');
  const inputId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (trimmed === '') {
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    onSave(trimmed === value ? null : trimmed);
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          value={draft}
          maxLength={maxLength}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            if (invalid && event.currentTarget.value.trim() !== '') setInvalid(false);
          }}
          className={cn(
            'h-9 w-full rounded-md bg-background px-2.5 text-sm text-foreground outline-none',
            'ring-1 ring-border focus:ring-2 focus:ring-ring',
            'aria-invalid:ring-destructive',
          )}
        />
        {invalid ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {t('rename.empty')}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="lg">
          {t('rename.save')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Подтверждение удаления. Удаление насовсем, поэтому фокус по умолчанию — на «Отмене»:
 * случайный Enter ничего не удалит.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const t = useTranslations('libraryMenu');
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="alertdialog"
        closeLabel={t('close')}
        className="max-w-sm gap-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="min-w-0 text-sm text-pretty [overflow-wrap:anywhere]">
            {body}
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button
            ref={cancel}
            type="button"
            variant="ghost"
            size="lg"
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="lg"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
