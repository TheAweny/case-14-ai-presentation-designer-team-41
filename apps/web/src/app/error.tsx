'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  const t = useTranslations('serviceStatus');
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 text-foreground">
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-lg">
        <h1 className="text-lg font-semibold">{t('pageTitle')}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t('pageDescription')}</p>
        <Button type="button" onClick={reset} className="mt-5">
          {t('reload')}
        </Button>
      </div>
    </main>
  );
}
