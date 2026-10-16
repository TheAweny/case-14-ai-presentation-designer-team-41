'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { FileIcon, PlusIcon, SlideIcon } from '@/components/ui/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The same source picker on the home page, in a chat and in the editor. */
export function ComposerSourceMenu({
  onFiles,
  onContext,
  compact = false,
  disabled = false,
}: {
  onFiles: () => void;
  onContext?: () => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('deckChat.input');
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={compact ? 'icon' : 'icon-lg'}
          disabled={disabled}
          aria-label={t('attach')}
          className="rounded-full bg-muted/40 text-muted-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground transition-[background-color,color,transform] duration-200 active:scale-95 motion-reduce:transform-none"
        >
          <motion.span
            className="inline-flex"
            initial={false}
            animate={{ rotate: reduce ? 0 : open ? 45 : 0 }}
            transition={{ type: 'spring', stiffness: 440, damping: 28 }}
          >
            <PlusIcon className="size-4" />
          </motion.span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        aria-label={t('attach')}
        className="w-72 max-w-[calc(100vw-2rem)] rounded-xl p-1.5 duration-200 motion-reduce:animate-none"
      >
        <DropdownMenuItem
          onSelect={onFiles}
          className="items-start gap-2.5 rounded-lg px-2.5 py-2.5"
        >
          <FileIcon className="mt-0.5 size-4" />
          <span className="flex flex-col gap-0.5">
            <span>{t('materials')}</span>
            <span className="text-xs text-muted-foreground">{t('materialsHint')}</span>
          </span>
        </DropdownMenuItem>
        {onContext ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onContext} className="rounded-lg px-2.5 py-2">
              <SlideIcon />
              {t('context')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
