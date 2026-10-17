'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ScrollDownIcon } from '@/components/ui/icons';

/** Shared by the full chat and the narrow editor panel. */
export function JumpToLatest({ onJump }: { onJump: () => void }) {
  const t = useTranslations('deckChat');
  return (
    <div className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center">
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={onJump}
        aria-label={t('toBottom')}
        title={t('toBottom')}
        className="assistant-rise pointer-events-auto rounded-full bg-background shadow-sm motion-reduce:animate-none"
      >
        <ScrollDownIcon />
      </Button>
    </div>
  );
}
