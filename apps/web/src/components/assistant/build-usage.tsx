'use client';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { GenerationUsage } from '@lct/contracts';
import { AgentIcon, MoneyIcon, TextIcon } from '@/components/ui/icons';
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
  const format = new Intl.NumberFormat(locale);
  return (
    <dl
      className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-6 text-xs text-muted-foreground tabular-nums"
      data-build-usage=""
      aria-label={t('usageLabel')}
    >
      <div className="flex items-center gap-1.5">
        <AgentIcon className="size-3.5" aria-hidden />
        <dt className="sr-only">{t('requestsLabel')}</dt>
        <dd>{t('requests', { count: usage.httpAttempts })}</dd>
      </div>
      <div
        className="flex items-center gap-1.5"
        title={t('tokenBreakdown', {
          input: format.format(usage.knownInputTokens),
          output: format.format(usage.knownOutputTokens),
        })}
      >
        <TextIcon className="size-3.5" aria-hidden />
        <dt className="sr-only">{t('tokensLabel')}</dt>
        <dd>
          {t('tokens', { count: format.format(usage.knownInputTokens + usage.knownOutputTokens) })}
          {usage.unknownUsageAttempts > 0 ? ` · ${t('partial')}` : ''}
        </dd>
      </div>
      <div className="flex items-center gap-1.5">
        <MoneyIcon className="size-3.5" aria-hidden />
        <dt className="sr-only">{t('costLabel')}</dt>
        <dd>
          {t('cost', { amount: cost })}
          {usage.knownCost !== null && usage.unknownCostAttempts > 0 ? ` · ${t('partial')}` : ''}
        </dd>
      </div>
    </dl>
  );
}
