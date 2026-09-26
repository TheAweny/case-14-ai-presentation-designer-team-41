'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { LanguageSkillIcon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setLocale } from '@/i18n/actions';
import { LOCALES, LOCALE_NAMES, isLocale } from '@/i18n/config';
import { cn } from '@/lib/utils';

/**
 * Выбор языка интерфейса. Смена языка — серверное действие: оно пишет cookie, и Next
 * перерисовывает страницу с новым словарём, не сбрасывая состояние редактора.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('localeSwitcher');
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          title={t('label')}
          disabled={pending}
          className={cn('text-muted-foreground', className)}
        >
          <HugeiconsIcon
            icon={LanguageSkillIcon}
            strokeWidth={1.5}
            color="currentColor"
            data-icon="inline-start"
          />
          <span className="sr-only">{t('label')}</span>
          <span aria-hidden className="uppercase">
            {locale}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-auto">
        <DropdownMenuLabel>{t('label')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={locale}
          onValueChange={(next) => {
            if (!isLocale(next) || next === locale) return;
            startTransition(() => setLocale(next));
          }}
        >
          {LOCALES.map((option) => (
            // Название языка написано на нём самом, так и помечаем — для чтения с экрана.
            <DropdownMenuRadioItem key={option} value={option} lang={option}>
              {LOCALE_NAMES[option]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
