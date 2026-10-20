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
import type { ComposerBrandbook } from '@/lib/brandbooks';

/** Пустое значение группы — «Без брендбука». */
const NONE = '';

/**
 * Брендбуки внутри меню «+», сразу под шаблонами: выбрать уже разобранный из библиотеки, снять
 * выбор или загрузить новый файл — он разберётся и тоже ляжет в библиотеку.
 */
export function BrandbookMenuSection({
  brandbooks,
  selectedId,
  onSelect,
  onUpload,
}: {
  brandbooks: readonly ComposerBrandbook[];
  selectedId: string | null;
  onSelect: (brandbookId: string | null) => void;
  onUpload: () => void;
}) {
  const t = useTranslations('composer.brandbook');
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>{t('menu')}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={selectedId ?? NONE}
        onValueChange={(value) => onSelect(value === NONE ? null : value)}
      >
        <DropdownMenuRadioItem value={NONE} className="gap-2.5">
          <span
            aria-hidden
            className="h-6.5 w-11 shrink-0 rounded-sm border border-dashed border-border"
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{t('none')}</span>
            <span className="truncate text-muted-foreground">{t('noneHint')}</span>
          </span>
        </DropdownMenuRadioItem>
        {brandbooks.length > 0 ? (
          <div className="max-h-48 overflow-y-auto">
            {brandbooks.map((brandbook) => (
              <DropdownMenuRadioItem
                key={brandbook.brandbookId}
                value={brandbook.brandbookId}
                className="gap-2.5"
              >
                <span
                  aria-hidden
                  className="flex h-6.5 w-11 shrink-0 overflow-hidden rounded-sm bg-muted ring-1 ring-border"
                >
                  {brandbook.colors.map((hex) => (
                    <span key={hex} className="flex-1" style={{ backgroundColor: `#${hex}` }} />
                  ))}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{brandbook.name}</span>
                  <span className="truncate text-muted-foreground">
                    {t('summary', { colors: brandbook.colorCount, fonts: brandbook.fontCount })}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </div>
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('empty')}</p>
        )}
      </DropdownMenuRadioGroup>
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
