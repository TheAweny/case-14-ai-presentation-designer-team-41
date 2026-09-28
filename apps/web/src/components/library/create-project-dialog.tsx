'use client';

import { useId, useRef, useState, useTransition, type FormEvent, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createProjectAction, type CreateProjectResult } from '@/app/(library)/actions';
import { ProjectAppearancePicker } from '@/components/library/project-appearance-picker';
import { ProjectIcon } from '@/components/library/project-icon';
import { PlusIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { projectHref } from '@/lib/library-menu';
import { PROJECT_NAME_MAX_LENGTH } from '@/lib/library-source';
import { DEFAULT_PROJECT_APPEARANCE, type ProjectAppearance } from '@/lib/project-appearance';
import { cn } from '@/lib/utils';

const FAILED: CreateProjectResult = { ok: false, reason: 'invalid' };

/** Кнопка с диалогом. Проект создают на странице проектов, а не из боковой панели. */
export function CreateProjectButton({ className }: { className?: string }) {
  const t = useTranslations('library');
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="lg" className={className} onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        {t('newProject')}
      </Button>
      <CreateProjectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Новый проект, как в ChatGPT: имя и слева от него иконка — щелчок по ней открывает выбор иконки
 * и цвета. Enter создаёт; пока имени нет, создавать нечего и кнопка неактивна. Созданный проект
 * сразу открывается: человек пришёл его наполнять.
 *
 * Пока сервер создаёт проект, диалог не закрывается: иначе переход на новый проект случился бы
 * уже после того, как человек передумал.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('libraryMenu');
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const create = (name: string, appearance: ProjectAppearance, fail: () => void) => {
    startTransition(async () => {
      const result = await createProjectAction({ name, appearance }).catch(() => FAILED);
      if (!result.ok) {
        fail();
        return;
      }
      router.push(projectHref(result.projectId));
      onOpenChange(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next || !pending) onOpenChange(next);
      }}
    >
      <DialogContent
        closeLabel={t('close')}
        className="max-w-sm gap-4"
        onOpenAutoFocus={(event) => {
          // Фокус — в имя, а не на кнопку иконки: сначала проект называют.
          event.preventDefault();
          input.current?.focus();
        }}
      >
        <CreateProjectForm
          inputRef={input}
          pending={pending}
          onCancel={() => onOpenChange(false)}
          onCreate={create}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Форма живёт, пока открыт диалог: каждое открытие начинается с пустого имени и папки. */
function CreateProjectForm({
  inputRef,
  pending,
  onCancel,
  onCreate,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  pending: boolean;
  onCancel: () => void;
  onCreate: (name: string, appearance: ProjectAppearance, fail: () => void) => void;
}) {
  const t = useTranslations('library.createProject');
  const tMenu = useTranslations('libraryMenu');
  const tLook = useTranslations('projectAppearance');
  const inputId = useId();
  const errorId = useId();
  const [name, setName] = useState('');
  const [appearance, setAppearance] = useState<ProjectAppearance>(DEFAULT_PROJECT_APPEARANCE);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const trimmed = name.trim();
  const ready = trimmed !== '' && !pending;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ready) return;
    setFailed(false);
    onCreate(trimmed, appearance, () => {
      setFailed(true);
      inputRef.current?.focus();
    });
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          {t('label')}
        </label>
        <div className="flex items-center gap-2">
          <ProjectAppearancePicker
            value={appearance}
            onChange={setAppearance}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          >
            <button
              type="button"
              aria-label={tLook('label')}
              title={tLook('label')}
              className={cn(
                'grid size-9 shrink-0 place-items-center rounded-md outline-none',
                'ring-1 ring-border transition-[box-shadow] duration-100 motion-reduce:transition-none',
                'hover:ring-foreground/25 focus-visible:ring-2 focus-visible:ring-ring',
                'aria-expanded:ring-foreground/25',
              )}
            >
              <ProjectIcon appearance={appearance} size="sm" />
            </button>
          </ProjectAppearancePicker>
          <input
            ref={inputRef}
            id={inputId}
            value={name}
            maxLength={PROJECT_NAME_MAX_LENGTH}
            placeholder={t('placeholder')}
            autoComplete="off"
            aria-invalid={failed || undefined}
            aria-describedby={failed ? errorId : undefined}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setFailed(false);
            }}
            className={cn(
              'h-9 min-w-0 flex-1 rounded-md bg-background px-2.5 text-sm text-foreground outline-none',
              'ring-1 ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-ring',
              'aria-invalid:ring-destructive',
            )}
          />
        </div>
        {failed ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {t('failed')}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="lg" disabled={pending} onClick={onCancel}>
          {tMenu('cancel')}
        </Button>
        <Button type="submit" size="lg" disabled={!ready}>
          {pending ? t('creating') : t('create')}
        </Button>
      </div>
    </form>
  );
}
