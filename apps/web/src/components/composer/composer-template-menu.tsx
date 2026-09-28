'use client';

import { useTranslations } from 'next-intl';
import { ChevronDownIcon, CloudUploadIcon, TemplateIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PaletteStrip, roleColor } from '@/components/library/template-swatch';
import { templateTitle, type TemplateGroups } from '@/lib/composer-templates';
import type { TemplateSummary } from '@/lib/library-source';
import { cn } from '@/lib/utils';
import { PROMPT_CHIP } from './prompt-box';

/**
 * Выбор шаблона в поле генерации. Шаблоны — библиотека: на странице проекта первыми идут
 * прикреплённые к нему («В проекте»), ниже — остальные, недавно загруженные первыми. Любой из
 * них годится: презентация попадёт туда, где стоит поле, а не в проект шаблона.
 *
 * «Загрузить шаблон…» кладёт файл в поле чипом, как скрепка: разбирать его будет агент в
 * разговоре. Пока чип есть, кнопка показывает новый файл, а выбор в меню убирает чип.
 */
export function ComposerTemplateMenu({
  groups,
  inProject,
  selected,
  pendingFile,
  onSelect,
  onUpload,
}: {
  groups: TemplateGroups;
  /** Поле стоит на странице проекта: группа «В проекте» видна, даже пустая. */
  inProject: boolean;
  /** Шаблон библиотеки, выбранный сейчас; null — выбрать нечего или ещё не выбрали. */
  selected: TemplateSummary | null;
  /** Новый файл шаблона из чипа поля: пока он есть, презентация соберётся на нём. */
  pendingFile: File | null;
  onSelect: (templateId: string) => void;
  /** Открыть выбор файла шаблона. */
  onUpload: () => void;
}) {
  const t = useTranslations('composer.template');
  const { own, others } = groups;
  const layouts = (template: TemplateSummary) => t('layouts', { count: template.layouts.length });
  const empty = !pendingFile && !selected;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className={cn(
            PROMPT_CHIP,
            // Без шаблона собирать не из чего: кнопка — первое, что нужно сделать, и выглядит
            // пустым местом, которое ждёт выбора.
            empty && 'border-dashed border-foreground/40 text-foreground',
          )}
          aria-label={
            pendingFile
              ? t('changeNew', { file: pendingFile.name })
              : selected
                ? t('change', { file: selected.fileName })
                : t('chooseLabel')
          }
        >
          {selected && !pendingFile ? (
            <PaletteStrip
              system={selected.designSystem}
              className="w-7 shrink-0 ring-1 ring-border"
            />
          ) : (
            <TemplateIcon data-icon="inline-start" />
          )}
          <span className="truncate">
            {pendingFile
              ? t('newFile', { file: pendingFile.name })
              : selected
                ? templateTitle(selected.fileName)
                : t('choose')}
          </span>
          <ChevronDownIcon className="opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 max-w-[calc(100vw-2rem)]" aria-label={t('menu')}>
        <DropdownMenuRadioGroup
          value={pendingFile ? '' : (selected?.templateId ?? '')}
          onValueChange={onSelect}
        >
          {inProject ? (
            <>
              <DropdownMenuLabel>{t('own')}</DropdownMenuLabel>
              {own.length > 0 ? (
                own.map((template) => (
                  <TemplateItem
                    key={template.templateId}
                    template={template}
                    meta={layouts(template)}
                  />
                ))
              ) : (
                <p className="px-2 pb-1.5 text-xs text-muted-foreground">{t('ownEmpty')}</p>
              )}
            </>
          ) : null}
          {others.length > 0 ? (
            <>
              {inProject ? <DropdownMenuSeparator /> : null}
              <DropdownMenuLabel>{inProject ? t('others') : t('library')}</DropdownMenuLabel>
              {/* Библиотека растёт без предела: длинный список прокручивается внутри меню. */}
              <div className="max-h-60 overflow-y-auto">
                {others.map((template) => (
                  <TemplateItem
                    key={template.templateId}
                    template={template}
                    meta={layouts(template)}
                  />
                ))}
              </div>
            </>
          ) : inProject ? null : (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('libraryEmpty')}</p>
          )}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2.5" onSelect={onUpload}>
          <span className="grid h-6.5 w-11 shrink-0 place-items-center rounded-sm ring-1 ring-border">
            <CloudUploadIcon />
          </span>
          <span className="flex min-w-0 flex-col">
            <span>{t('upload')}</span>
            <span className="text-muted-foreground">{t('uploadHint')}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Пункт шаблона: миниатюра в цветах фона и текста шаблона с полоской палитры, имя и подпись. */
function TemplateItem({ template, meta }: { template: TemplateSummary; meta: string }) {
  const { designSystem, fileName } = template;
  const ink = roleColor(designSystem, 'text') ?? 'currentColor';
  return (
    <DropdownMenuRadioItem value={template.templateId} className="gap-2.5">
      {template.previewDataUrl ? (
        <img
          src={template.previewDataUrl}
          alt=""
          aria-hidden
          className="h-6.5 w-11 shrink-0 rounded-sm object-cover ring-1 ring-border"
        />
      ) : (
        <span
          aria-hidden
          className="relative h-6.5 w-11 shrink-0 overflow-hidden rounded-sm ring-1 ring-border"
          style={{ backgroundColor: roleColor(designSystem, 'background') ?? undefined }}
        >
          <span
            className="absolute top-1.5 left-1.5 h-0.75 w-5 rounded-full"
            style={{ backgroundColor: ink }}
          />
          <span
            className="absolute top-3 left-1.5 h-0.5 w-7 rounded-full opacity-50"
            style={{ backgroundColor: ink }}
          />
          <PaletteStrip
            system={designSystem}
            max={designSystem.palette.length}
            className="absolute inset-x-0.75 bottom-0.75 h-1"
          />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{fileName}</span>
        <span className="truncate text-muted-foreground">{meta}</span>
      </span>
    </DropdownMenuRadioItem>
  );
}
