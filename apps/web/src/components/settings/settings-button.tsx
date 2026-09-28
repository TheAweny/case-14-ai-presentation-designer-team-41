'use client';

import { useTranslations } from 'next-intl';
import { SettingsIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { openSettings, useIsMac } from './open-settings';

/**
 * Кнопка окна настроек с подсказкой о Ctrl+, (⌘+,). В подвале сайдбара — с подписью, как в
 * Claude и ChatGPT; в редакторе места мало, и там она одна иконка (`iconOnly`), а название
 * говорит подсказка и `aria-label`.
 */
export function SettingsButton({
  iconOnly = false,
  className,
}: {
  iconOnly?: boolean;
  className?: string;
}) {
  const t = useTranslations('settings');
  const mac = useIsMac();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={iconOnly ? 'icon-sm' : 'sm'}
            aria-label={iconOnly ? t('open') : undefined}
            aria-keyshortcuts="Control+Comma Meta+Comma"
            className={cn('text-muted-foreground', !iconOnly && 'justify-start', className)}
            onClick={() => openSettings()}
          >
            <SettingsIcon data-icon={iconOnly ? undefined : 'inline-start'} />
            {iconOnly ? null : t('open')}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-1.5">
          {t('open')}
          <span className="flex gap-0.5">
            <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
            <Kbd>,</Kbd>
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
