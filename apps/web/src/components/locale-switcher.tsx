'use client';

import { useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { LanguageSkillIcon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { setLocale } from '@/i18n/actions';
import { LOCALES, LOCALE_NAMES, isLocale } from '@/i18n/config';

/**
 * Выбор языка интерфейса. Смена языка — серверное действие: оно пишет cookie, и Next
 * перерисовывает страницу с новым словарём, не сбрасывая состояние редактора.
 *
 * Живёт в настройках, в разделе «Общие»: кнопка называет язык целиком, на нём самом.
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
          className={className}
        >
          <HugeiconsIcon
            icon={LanguageSkillIcon}
            strokeWidth={1.5}
            color="currentColor"
            data-icon="inline-start"
          />
          <span className="sr-only">{t('label')}</span>
          <span aria-hidden lang={locale}>
            {isLocale(locale) ? LOCALE_NAMES[locale] : locale}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-auto">
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
