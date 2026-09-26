'use client';

import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { PanelRightOpenIcon } from '@hugeicons/core-free-icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { keepCanvasFocus } from '@/components/editor/chrome-focus';

/**
 * Кнопка, возвращающая правую панель. Стоит в верхнем углу холста и помечена как
 * препятствие: рейка инструментов на неё не встаёт.
 */
export function InspectorToggle({ onOpen, className }: { onOpen: () => void; className?: string }) {
  const t = useTranslations('editor');

  return (
    <div data-dock-obstacle="" className={cn('absolute top-3 right-3 z-30', className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={t('inspectorShow')}
              onMouseDown={keepCanvasFocus}
              onClick={onOpen}
              className={cn(
                'grid size-8 place-items-center rounded-lg bg-card text-muted-foreground outline-none',
                'shadow-lg ring-1 shadow-black/25 ring-border',
                'transition-colors duration-100 motion-reduce:transition-none',
                'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              )}
            >
              <HugeiconsIcon
                icon={PanelRightOpenIcon}
                size={16}
                strokeWidth={1.5}
                color="currentColor"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('inspectorShow')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}
