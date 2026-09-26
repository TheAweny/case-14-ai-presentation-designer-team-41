'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { HugeiconsIcon } from '@hugeicons/react';
import { Layers01Icon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { SLIDE_COUNT_RANGE } from '@/lib/deck-generator';
import { cn } from '@/lib/utils';

const TICKS = Array.from(
  { length: SLIDE_COUNT_RANGE.max - SLIDE_COUNT_RANGE.min + 1 },
  (_, index) => SLIDE_COUNT_RANGE.min + index,
);

/** С этого числа ползунок начинает, когда «Авто» выключают. */
const MIDDLE = Math.round((SLIDE_COUNT_RANGE.min + SLIDE_COUNT_RANGE.max) / 2);

/**
 * Сколько слайдов собрать: «Авто» — сколько потребует материал, или точное число ползунком.
 * Границы — из контракта прогона, а не из интерфейса.
 */
export function SlideCountMenu({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (count: number | null) => void;
}) {
  const t = useTranslations('composer.slides');
  const autoId = useId();
  // Число, к которому вернётся ползунок, если снова выключить «Авто».
  const [last, setLast] = useState(value ?? MIDDLE);
  const auto = value === null;
  const shown = value ?? last;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="shrink-0 rounded-full pr-3 pl-2.5 font-normal text-muted-foreground tabular-nums"
          aria-label={t('label')}
        >
          <HugeiconsIcon icon={Layers01Icon} strokeWidth={1.75} />
          {auto ? t('auto') : t('count', { count: value })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" aria-label={t('label')}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="flex items-baseline gap-1.5">
            <span
              className={cn(
                'text-2xl font-semibold tracking-tight tabular-nums text-foreground',
                auto && 'text-muted-foreground',
              )}
            >
              {auto ? t('autoShort') : shown}
            </span>
            <span className="text-xs text-muted-foreground">
              {auto ? t('autoNote') : t('unit', { count: shown })}
            </span>
          </p>
          <label htmlFor={autoId} className="flex items-center gap-2 text-xs text-muted-foreground">
            {t('autoSwitch')}
            <Switch
              id={autoId}
              checked={auto}
              onCheckedChange={(checked) => onChange(checked ? null : last)}
            />
          </label>
        </div>
        <Slider
          className="mt-4"
          min={SLIDE_COUNT_RANGE.min}
          max={SLIDE_COUNT_RANGE.max}
          step={1}
          value={[shown]}
          disabled={auto}
          aria-label={t('label')}
          onValueChange={([next]) => {
            if (next === undefined) return;
            setLast(next);
            onChange(next);
          }}
        />
        <div
          aria-hidden
          className="mt-1.5 flex justify-between px-1.5 text-[0.6875rem] text-muted-foreground tabular-nums"
        >
          {TICKS.map((tick) => (
            <span key={tick}>{tick}</span>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {auto ? t('autoHint') : t('hint', SLIDE_COUNT_RANGE)}
        </p>
      </PopoverContent>
    </Popover>
  );
}
