'use client';

import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ModelOption } from '@/lib/deck-generator';

/**
 * Выбор модели, которая пишет текст. Стоит у кнопки отправки, как в чатах. Одна модель —
 * выбирать не из чего, и кнопки нет.
 */
export function ModelMenu({
  models,
  value,
  onChange,
}: {
  models: readonly ModelOption[];
  /** Выбранная модель; null — первая, модель по умолчанию. */
  value: string | null;
  onChange: (modelId: string) => void;
}) {
  const t = useTranslations('composer.model');
  if (models.length < 2) return null;
  const selected = models.find((model) => model.modelId === value) ?? models[0];
  if (!selected) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          className="max-w-40 min-w-0 rounded-full pr-2 pl-3 font-normal text-muted-foreground"
          aria-label={t('change', { model: selected.name })}
        >
          <span className="truncate">{selected.name}</span>
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" aria-label={t('menu')}>
        <DropdownMenuLabel>{t('menu')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={selected.modelId} onValueChange={onChange}>
          {models.map((model, index) => (
            <DropdownMenuRadioItem key={model.modelId} value={model.modelId}>
              <span className="truncate">{model.name}</span>
              {index === 0 ? (
                <span className="ml-auto shrink-0 text-muted-foreground">{t('default')}</span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
