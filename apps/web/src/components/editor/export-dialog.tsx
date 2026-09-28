'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, SpinnerIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import { RadioGroup as RadioGroupPrimitive, ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import type { LayoutVariantName } from '@lct/contracts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  EXPORT_EXTENSION,
  EXPORT_FORMATS,
  type ExportFormat,
  type StageProgress,
} from '@/lib/deck-export';
import type { DeckExportJob } from '@/components/editor/use-deck-export';

export type SlideRange = 'all' | 'current';

export interface ExportOptions {
  readonly format: ExportFormat;
  readonly fileName: string;
  readonly range: SlideRange;
  readonly audit: boolean;
}

/**
 * Диалог экспорта. Пока экспорт идёт, окно можно свернуть: работа живёт в редакторе
 * (`useDeckExport`), а открытый снова диалог покажет её ход.
 */
export function ExportDialog({
  open,
  onOpenChange,
  job,
  initialFormat,
  defaultFileName,
  defaultAudit = false,
  slideCount,
  currentIndex,
  variant,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: DeckExportJob;
  initialFormat: ExportFormat;
  defaultFileName: string;
  /** Отчёт аудита отмечен заранее — так в настройках. */
  defaultAudit?: boolean;
  slideCount: number;
  currentIndex: number;
  variant: LayoutVariantName;
  onStart: (options: ExportOptions) => void;
}) {
  const t = useTranslations('exportDialog');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeLabel={t('close')}
        className="flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="px-5 pt-4 pr-12">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>
            {t('description', { variant: t(`variants.${variant}`) })}
          </DialogDescription>
        </DialogHeader>
        {job.phase === 'idle' ? (
          <ExportForm
            key={initialFormat}
            initialFormat={initialFormat}
            defaultFileName={defaultFileName}
            defaultAudit={defaultAudit}
            slideCount={slideCount}
            currentIndex={currentIndex}
            onCancel={() => onOpenChange(false)}
            onStart={onStart}
          />
        ) : job.phase === 'running' ? (
          <Running job={job} onHide={() => onOpenChange(false)} />
        ) : job.phase === 'done' ? (
          <Done job={job} onClose={() => onOpenChange(false)} />
        ) : (
          <Failed job={job} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ExportForm({
  initialFormat,
  defaultFileName,
  defaultAudit = false,
  slideCount,
  currentIndex,
  onCancel,
  onStart,
}: {
  initialFormat: ExportFormat;
  defaultFileName: string;
  /** Отчёт аудита отмечен заранее — так в настройках. */
  defaultAudit?: boolean;
  slideCount: number;
  currentIndex: number;
  onCancel: () => void;
  onStart: (options: ExportOptions) => void;
}) {
  const t = useTranslations('exportDialog');
  const [format, setFormat] = useState<ExportFormat>(initialFormat);
  const [fileName, setFileName] = useState(defaultFileName);
  const [range, setRange] = useState<SlideRange>('all');
  const [audit, setAudit] = useState(defaultAudit);
  const nameId = useId();
  const formatsId = useId();
  const rangeId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onStart({ format, fileName, range, audit });
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-5 pt-4 pb-5">
        <fieldset className="flex flex-col gap-2">
          <legend id={formatsId} className="mb-2 text-xs text-muted-foreground">
            {t('format')}
          </legend>
          <RadioGroupPrimitive.Root
            aria-labelledby={formatsId}
            value={format}
            onValueChange={(next) => setFormat(next as ExportFormat)}
            className="grid grid-cols-2 gap-2 max-sm:grid-cols-1"
          >
            {EXPORT_FORMATS.map((option) => (
              <RadioGroupPrimitive.Item
                key={option}
                value={option}
                className={cn(
                  'group flex items-start gap-2.5 rounded-lg p-3 text-left outline-none',
                  'ring-1 ring-border transition-colors duration-100 motion-reduce:transition-none',
                  'hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring',
                  'data-[state=checked]:bg-muted data-[state=checked]:ring-foreground/30',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 rounded-full ring-[1.5px] ring-muted-foreground ring-inset',
                    'group-data-[state=checked]:ring-4 group-data-[state=checked]:ring-foreground',
                  )}
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs font-medium text-foreground">
                    {t(`formats.${option}.title`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`formats.${option}.description`)}
                  </span>
                </span>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
        </fieldset>

        <div className="flex flex-col gap-2">
          <span id={rangeId} className="text-xs text-muted-foreground">
            {t('slides')}
          </span>
          <ToggleGroupPrimitive.Root
            type="single"
            aria-labelledby={rangeId}
            value={range}
            onValueChange={(next) => {
              // Radix снимает выбор повторным щелчком, а диапазон нужен всегда.
              if (next === 'all' || next === 'current') setRange(next);
            }}
            className="flex h-8 items-center gap-0.5 rounded-md bg-muted/60 p-0.5"
          >
            <RangeItem value="all" label={t('allSlides', { count: slideCount })} />
            <RangeItem value="current" label={t('currentSlide', { number: currentIndex + 1 })} />
          </ToggleGroupPrimitive.Root>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor={nameId} className="text-xs text-muted-foreground">
            {t('fileName')}
          </label>
          <div
            className={cn(
              'flex h-8 items-center gap-1 rounded-md bg-muted/60 px-2.5 text-xs',
              'ring-1 ring-transparent focus-within:bg-background focus-within:ring-ring',
            )}
          >
            <input
              id={nameId}
              value={fileName}
              maxLength={120}
              onChange={(event) => setFileName(event.currentTarget.value)}
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
            />
            <span className="shrink-0 text-muted-foreground select-none">
              {EXPORT_EXTENSION[format]}
            </span>
          </div>
        </div>

        <label className="flex items-start gap-2 text-xs text-foreground">
          <input
            type="checkbox"
            checked={audit}
            onChange={(event) => setAudit(event.currentTarget.checked)}
            className="mt-0.5 size-3.5 accent-foreground"
          />
          <span className="flex flex-col gap-0.5">
            {t('audit')}
            <span className="text-muted-foreground">{t('auditHint')}</span>
          </span>
        </label>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit">{t('start', { extension: EXPORT_EXTENSION[format] })}</Button>
      </DialogFooter>
    </form>
  );
}

function RangeItem({ value, label }: { value: SlideRange; label: string }) {
  return (
    <ToggleGroupPrimitive.Item
      value={value}
      className={cn(
        'h-full flex-1 rounded-[5px] px-2 text-xs text-muted-foreground outline-none',
        'transition-colors duration-100 motion-reduce:transition-none',
        'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        'data-[state=on]:bg-foreground/15 data-[state=on]:text-foreground',
      )}
    >
      {label}
    </ToggleGroupPrimitive.Item>
  );
}

function Running({ job, onHide }: { job: DeckExportJob; onHide: () => void }) {
  const t = useTranslations('exportDialog');
  const { request, progress } = job;
  const percent = progress?.percent ?? 0;
  return (
    <>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
        {request ? (
          <p className="text-xs text-foreground">
            {t('runningFile', {
              file: request.fileName + EXPORT_EXTENSION[request.format],
              count: request.slides.length,
            })}
          </p>
        ) : null}
        <div
          role="progressbar"
          aria-label={t('progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-foreground transition-[width] duration-200 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <ol className="flex flex-col gap-1.5" aria-live="polite">
          {progress?.stages.map((stage) => (
            <StageRow key={stage.stage} stage={stage} />
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{t('hideHint')}</p>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={job.cancel}>
          {t('stop')}
        </Button>
        <Button type="button" variant="secondary" onClick={onHide}>
          {t('hide')}
        </Button>
      </DialogFooter>
    </>
  );
}

function StageRow({ stage }: { stage: StageProgress }) {
  const t = useTranslations('exportDialog');
  const count =
    stage.total !== null && stage.total > 1
      ? t('stageCount', { done: stage.done ?? 0, total: stage.total })
      : null;
  return (
    <li
      className={cn(
        'flex items-center gap-2 text-xs',
        stage.state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span className="grid size-4 place-items-center" aria-hidden>
        {stage.state === 'done' ? (
          <CheckIcon size={14} className="[--icon-stroke:2]" />
        ) : stage.state === 'running' ? (
          <SpinnerIcon size={14} className="animate-spin motion-reduce:animate-none" />
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/60" />
        )}
      </span>
      <span className="flex-1">{t(`stages.${stage.stage}`)}</span>
      <span className="sr-only">{t(`stageStates.${stage.state}`)}</span>
      {count ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
    </li>
  );
}

function Done({ job, onClose }: { job: DeckExportJob; onClose: () => void }) {
  const t = useTranslations('exportDialog');
  const { result, progress } = job;
  return (
    <>
      <div className="flex flex-col gap-3 px-5 pt-4 pb-5">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <SuccessIcon size={18} />
          {t('done', { file: result?.fileName ?? '' })}
        </p>
        <ol className="flex flex-col gap-1.5">
          {progress?.stages.map((stage) => (
            <StageRow key={stage.stage} stage={stage} />
          ))}
        </ol>
        {result?.url ? (
          <a
            href={result.url}
            download={result.fileName}
            className="self-start text-xs text-foreground underline underline-offset-4"
          >
            {t('downloadAgain')}
          </a>
        ) : (
          <p className="text-xs text-balance text-muted-foreground">{t('demoResult')}</p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={job.reset}>
          {t('another')}
        </Button>
        <Button type="button" onClick={onClose}>
          {t('close')}
        </Button>
      </DialogFooter>
    </>
  );
}

function Failed({ job, onClose }: { job: DeckExportJob; onClose: () => void }) {
  const t = useTranslations('exportDialog');
  const { failure, request } = job;
  return (
    <>
      <div className="flex flex-col gap-2 px-5 pt-4 pb-5">
        <p className="flex items-center gap-2 text-sm text-foreground">
          <WarningIcon size={18} className="text-destructive" />
          {t('failed')}
        </p>
        <p className="text-xs text-balance text-muted-foreground">
          {failure?.message || t('failedUnknown')}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('close')}
        </Button>
        {failure?.retryable && request ? (
          <Button type="button" onClick={() => job.start(request)}>
            {t('retry')}
          </Button>
        ) : (
          <Button type="button" onClick={job.reset}>
            {t('another')}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
