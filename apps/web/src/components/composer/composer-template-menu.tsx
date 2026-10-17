'use client';

import { useTranslations } from 'next-intl';
import { CloudUploadIcon } from '@/components/ui/icons';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { PaletteStrip, roleColor } from '@/components/library/template-swatch';
import type { TemplateGroups } from '@/lib/composer-templates';
import type { TemplateSummary } from '@/lib/library-source';

/**
 * Шаблоны внутри меню «+». На странице проекта первыми идут прикреплённые к нему, ниже —
 * остальные. «Загрузить шаблон…» кладёт файл чипом над полем: разбирать его будет агент.
 */
export function TemplateMenuSection({
  groups,
  inProject,
  selectedId,
  pendingFile,
  onSelect,
  onUpload,
}: {
  groups: TemplateGroups;
  /** Поле стоит на странице проекта: группа «В проекте» видна, даже пустая. */
  inProject: boolean;
  /** Id шаблона библиотеки, который сейчас выбран; null — человек ещё не выбирал. */
  selectedId: string | null;
  /** Новый файл шаблона уже лежит чипом: отметка в списке снята, файл важнее. */
  pendingFile: boolean;
  onSelect: (templateId: string) => void;
  /** Открыть выбор файла шаблона. */
  onUpload: () => void;
}) {
  const t = useTranslations('composer.template');
  const { own, others } = groups;
  const layouts = (template: TemplateSummary) => t('layouts', { count: template.layouts.length });

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuRadioGroup
        value={pendingFile ? '' : (selectedId ?? '')}
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
    </>
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
