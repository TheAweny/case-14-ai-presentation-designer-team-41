'use client';

import { useOptimistic, useRef, useTransition, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DetachIcon, MoreIcon } from '@/components/ui/icons';
import { detachTemplateAction, type LibraryActionResult } from '@/app/(library)/actions';
import { useLibraryNotice } from '@/components/library/library-notices';
import { PaletteStrip } from '@/components/library/template-swatch';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { replaceSearchParam, selectedTemplateId, TEMPLATE_PARAM } from './project-tab';
import { AttachTemplateCard } from './template-attach';
import { TemplateCover, type TemplateThumb } from './template-thumb';

const FAILED: LibraryActionResult = { ok: false, reason: 'invalid' };

/** Прикреплённый шаблон и его подробный профиль, нарисованный сервером (`TemplatePanel`). */
export interface ProjectTemplateEntry extends TemplateThumb {
  readonly panel: ReactNode;
}

/**
 * Вкладка «Шаблоны»: ряд компактных карточек прикреплённых шаблонов и последней — «Прикрепить
 * шаблон»; под рядом — профиль выбранного. Выбор живёт в `?template=`, как вкладка в `?tab=`:
 * переключение мгновенное, ссылкой можно поделиться. У карточки меню «⋯» и правая кнопка —
 * «Открепить от проекта».
 *
 * Открепляемый шаблон пропадает из ряда сразу, до ответа сервера; не вышло — возвращается, и
 * уведомление объясняет почему.
 */
export function ProjectTemplates({
  projectId,
  templates,
  library,
}: {
  projectId: string;
  templates: readonly ProjectTemplateEntry[];
  /** Шаблоны библиотеки, которых нет в проекте: из них выбирают в «Прикрепить шаблон». */
  library: readonly TemplateThumb[];
}) {
  const t = useTranslations('projectPage.templates');
  const router = useRouter();
  const notice = useLibraryNotice();
  const [, startDetach] = useTransition();
  // Открепляемый шаблон пропадает сразу. Когда действие закончится, ряд снова идёт от сервера:
  // вышло — шаблона там уже нет, не вышло — он возвращается сам.
  const [shown, hide] = useOptimistic(templates, (current, templateId: string) =>
    current.filter((template) => template.templateId !== templateId),
  );
  const selectedId = selectedTemplateId(
    useSearchParams().get(TEMPLATE_PARAM),
    shown.map((template) => template.templateId),
  );
  const selected = shown.find((template) => template.templateId === selectedId);

  const detach = (template: ProjectTemplateEntry, card: HTMLElement | null) => {
    const { templateId } = template;
    // Карточка сейчас пропадёт вместе с кнопкой «⋯», которой меню вернуло бы фокус: фокус —
    // соседней карточке, а после последней — предыдущей.
    const item = card?.closest('li');
    const neighbor = [item?.nextElementSibling, item?.previousElementSibling]
      .map((element) => element?.querySelector<HTMLElement>('button'))
      .find((button) => button != null);
    neighbor?.focus();
    startDetach(async () => {
      hide(templateId);
      const result = await detachTemplateAction(projectId, templateId).catch(() => FAILED);
      if (!result.ok) {
        notice.alert(t('detachFailed'));
        return;
      }
      notice.status(t('detached', { name: template.fileName }));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <ul
        aria-label={t('label')}
        className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,11rem),1fr))] gap-3"
      >
        {shown.map((template) => (
          <li key={template.templateId} className="min-w-0">
            <TemplateCard
              template={template}
              selected={template.templateId === selectedId}
              onSelect={() => replaceSearchParam(TEMPLATE_PARAM, template.templateId)}
              onDetach={(card) => detach(template, card)}
            />
          </li>
        ))}
        <li className="min-w-0">
          <AttachTemplateCard projectId={projectId} library={library} />
        </li>
      </ul>
      {/* Ключ — шаблон: профиль другого шаблона начинается сверху, без чужой прокрутки. */}
      {selected ? <div key={selected.templateId}>{selected.panel}</div> : null}
    </div>
  );
}

/**
 * Карточка прикреплённого шаблона: титульный макет, имя файла, число макетов и палитра.
 * Щелчок раскрывает профиль шаблона под рядом; раскрытая карточка отмечена рамкой.
 */
function TemplateCard({
  template,
  selected,
  onSelect,
  onDetach,
}: {
  template: TemplateThumb;
  selected: boolean;
  onSelect: () => void;
  /** Открепить; вызывается, когда меню уже закрылось. `card` — корень карточки. */
  onDetach: (card: HTMLElement | null) => void;
}) {
  const t = useTranslations('projectPage.templates');
  const root = useRef<HTMLDivElement>(null);
  // Открепление — после закрытия меню: иначе меню вернуло бы фокус кнопке, которой уже нет.
  const pending = useRef(false);
  const closeAutoFocus = (event: Event) => {
    if (!pending.current) return;
    pending.current = false;
    event.preventDefault();
    onDetach(root.current);
  };
  const request = () => {
    pending.current = true;
  };
  const item = (
    <>
      <DetachIcon />
      {t('detach')}
    </>
  );

  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <div ref={root} className="group/object relative min-w-0">
          <button
            type="button"
            aria-current={selected || undefined}
            onClick={onSelect}
            className={cn(
              'group/template flex w-full min-w-0 flex-col gap-2 rounded-lg p-1.5 text-left outline-none',
              'transition-colors duration-150 motion-reduce:transition-none',
              'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <TemplateCover
              template={template}
              className={cn(
                'transition-[box-shadow] duration-150 motion-reduce:transition-none',
                selected ? 'ring-2 ring-primary' : 'group-hover/template:ring-foreground/30',
              )}
            />
            <span className="flex min-w-0 flex-col gap-1 px-0.5">
              <span className="truncate text-sm font-medium">{template.fileName}</span>
              <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0 tabular-nums">
                  {t('layouts', { count: template.layoutCount })}
                </span>
                <PaletteStrip system={template.designSystem} className="h-1.5 min-w-6 flex-1" />
              </span>
            </span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t('menu', { name: template.fileName })}
                className={cn(
                  'absolute top-3 right-3 grid size-7 place-items-center rounded-md outline-none',
                  'bg-popover/90 text-muted-foreground shadow-sm ring-1 ring-border backdrop-blur-sm',
                  'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  'aria-expanded:text-foreground',
                  // Скрыта, пока не нужна; на сенсорном экране навести нечем — видна всегда.
                  'opacity-0 transition-opacity duration-100 motion-reduce:transition-none',
                  'group-focus-within/object:opacity-100 group-hover/object:opacity-100',
                  'pointer-coarse:opacity-100 aria-expanded:opacity-100',
                )}
              >
                <MoreIcon size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" onCloseAutoFocus={closeAutoFocus}>
              <DropdownMenuItem onSelect={request}>{item}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={closeAutoFocus}>
        <ContextMenuItem onSelect={request}>{item}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
