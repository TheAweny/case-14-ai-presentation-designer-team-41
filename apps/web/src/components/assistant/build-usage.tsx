'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { GenerationUsage } from '@lct/contracts';
import { readGenerationUsage } from '@/lib/generation-usage';

export function BuildUsage({ runId, running }: { runId: string; running: boolean }) {
  const t = useTranslations('assistant.build');
  const locale = useLocale();
  const [usage, setUsage] = useState<GenerationUsage | null>(null);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      const value = await readGenerationUsage(runId);
      if (!active) return;
      setUsage(value);
      if (running) timer = setTimeout(() => void read(), 5000);
    };
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [runId, running]);
  if (!usage) return null;
  const cost =
    usage.knownCost === null || !usage.currency
      ? t('costUnknown')
      : new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: usage.currency,
          maximumFractionDigits: 4,
        }).format(usage.knownCost);
  return (
    <p className="pl-6 text-xs text-muted-foreground tabular-nums" data-build-usage="">
      {t('usage', {
        requests: usage.httpAttempts,
        tasks: usage.logicalTasks,
        tokens: usage.knownInputTokens + usage.knownOutputTokens,
        unknown: usage.unknownUsageAttempts,
        cost,
        unknownCost: usage.unknownCostAttempts,
      })}
    </p>
  );
}
