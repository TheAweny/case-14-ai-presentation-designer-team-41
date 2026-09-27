'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type DragEvent,
} from 'react';
import { useRouter } from 'next/navigation';
import type { JobStage } from '@lct/contracts';
import { useTranslations } from 'next-intl';
import {
  CheckIcon,
  ChevronDownIcon,
  CloudUploadIcon,
  PlusIcon,
  RetryIcon,
  SpinnerIcon,
  TemplateIcon,
  UploadIcon,
  WarningIcon,
} from '@/components/ui/icons';
import { attachTemplateAction, type LibraryActionResult } from '@/app/(library)/actions';
import {
  templateImporter,
  templateImports,
  useTemplateImport,
} from '@/components/assistant/session';
import { FileDrop } from '@/components/library/file-drop';
import { useLibraryNotice } from '@/components/library/library-notices';
import { PaletteStrip } from '@/components/library/template-swatch';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  TEMPLATE_EXTENSIONS,
  templateFileProblem,
  type GenerationStage,
} from '@/lib/deck-generator';
import { isImportStage } from '@/lib/template-importer';
import type { TemplateImport } from '@/lib/template-imports';
import { cn } from '@/lib/utils';
import { replaceSearchParam, TEMPLATE_PARAM } from './project-tab';
import { TemplateCover, type TemplateThumb } from './template-thumb';

const ACCEPT = TEMPLATE_EXTENSIONS.join(',');
const FAILED: LibraryActionResult = { ok: false, reason: 'invalid' };

// Импорт, который идёт в проект

/**
 * Какой импорт шаблона идёт в какой проект. Живёт вне компонентов: вкладки проекта
 * размонтируют неактивное содержимое, а импорт не должен теряться, если во время разбора
 * человек заглянул на соседнюю вкладку. По одному импорту на проект — новый файл заменяет
 * прежний.
 */
const projectImports = new Map<string, string>();
/** Импорты, шаблон которых уже прикрепляется: второй раз прикреплять незачем. */
const attachedImports = new Set<string>();
const importListeners = new Set<() => void>();

function setProjectImport(projectId: string, importId: string | null) {
  if (importId === null) projectImports.delete(projectId);
  else projectImports.set(projectId, importId);
  for (const listener of importListeners) listener();
}

function subscribeProjectImports(listener: () => void) {
  importListeners.add(listener);
  return () => {
    importListeners.delete(listener);
  };
}

export interface TemplateAttach {
  /** Импорт, который идёт в проект; нет — undefined. */
  readonly item: TemplateImport | undefined;
  /** Шаблон уже разобран или выбран и прикрепляется к проекту. */
  readonly attaching: boolean;
  /** Проверить файл и начать импорт. Негодный файл объясняется уведомлением, импорта нет. */
  upload(file: File): void;
  /** Прикрепить шаблон библиотеки. */
  attach(template: Pick<TemplateThumb, 'templateId' | 'fileName'>): void;
  retry(): void;
  /** Убрать неудавшийся импорт с карточки. */
  dismiss(): void;
}

/**
 * Прикрепление шаблона к проекту: загрузкой файла или выбором из библиотеки. Файл сначала
 * импортируется (`templateImports`), и разобранный шаблон прикрепляется сам. Прикреплённый
 * шаблон раскрывается на вкладке «Шаблоны», а страница перерисовывается с сервера.
 */
export function useTemplateAttach(projectId: string): TemplateAttach {
  const t = useTranslations('projectPage.templates');
  const router = useRouter();
  const notice = useLibraryNotice();
  const [attaching, startAttach] = useTransition();
  const importId = useSyncExternalStore(
    subscribeProjectImports,
    () => projectImports.get(projectId) ?? null,
    () => null,
  );
  const item = useTemplateImport(importId);

  const attach = useCallback(
    (template: Pick<TemplateThumb, 'templateId' | 'fileName'>, fromImport?: string) => {
      startAttach(async () => {
        const result = await attachTemplateAction(projectId, template.templateId).catch(
          () => FAILED,
        );
        if (!result.ok) {
          notice.alert(t('attachFailed'));
          // Шаблон разобран и уже в библиотеке: его можно выбрать из загруженных.
          if (fromImport) setProjectImport(projectId, null);
          return;
        }
        replaceSearchParam(TEMPLATE_PARAM, template.templateId);
        if (fromImport) setProjectImport(projectId, null);
        notice.status(t('attached', { name: template.fileName }));
        router.refresh();
      });
    },
    [projectId, notice, router, t],
  );

  // Разбор закончился — шаблон прикрепляется сам, ровно один раз, даже если карточку за это
  // время перерисовали.
  useEffect(() => {
    if (item?.phase !== 'done' || !item.result || attachedImports.has(item.importId)) return;
    attachedImports.add(item.importId);
    attach(item.result, item.importId);
  }, [item, attach]);

  const upload = useCallback(
    (file: File) => {
      const problem = templateFileProblem(file);
      if (problem) {
        notice.alert(t(problem === 'type' ? 'wrongType' : 'emptyFile', { name: file.name }));
        return;
      }
      setProjectImport(projectId, templateImports.start(file));
    },
    [projectId, notice, t],
  );

  return {
    item,
    attaching: attaching || item?.phase === 'done',
    upload,
    attach,
    retry: () => {
      if (importId) templateImports.retry(importId);
    },
    dismiss: () => setProjectImport(projectId, null),
  };
}

// Части интерфейса

/**
 * Ход импорта: файл, этапы разбора и полоса прогресса; сбой — причина и «Повторить». Пока
 * разобранный шаблон прикрепляется, строка говорит об этом.
 */
export function ImportProgress({
  state,
  className,
}: {
  state: TemplateAttach;
  className?: string;
}) {
  const t = useTranslations('projectPage.templates.import');
  const stageLabel = useStageLabel();
  const { item } = state;
  if (!item) return null;
  const failed = item.phase === 'failed';
  const current = item.progress.stages.find((stage) => stage.state === 'running');
  const status = failed
    ? t('failed')
    : state.attaching
      ? t('attaching')
      : current
        ? stageLabel(current.stage)
        : t('starting');
  // Разобрано — полоса полная, пока шаблон прикрепляется.
  const percent = state.attaching ? 100 : item.progress.percent;

  return (
    <div className={cn('flex min-w-0 flex-col gap-2.5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {failed ? (
          <WarningIcon size={14} aria-hidden className="shrink-0 text-destructive" />
        ) : (
          <SpinnerIcon
            size={14}
            aria-hidden
            className="shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.file.name}</span>
        {failed ? null : (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{percent}%</span>
        )}
      </div>
      {/*
       * Текущий этап и так отмечен в списке ниже, поэтому видимой строкой — только сбой и
       * прикрепление; ход по этапам читается с экрана из той же живой области.
       */}
      <p
        role="status"
        className={cn(
          'text-xs',
          failed ? 'text-destructive' : 'text-muted-foreground',
          !failed && !state.attaching && 'sr-only',
        )}
      >
        {status}
        {failed && item.failure?.message ? `: ${item.failure.message}` : null}
      </p>
      <div
        role="progressbar"
        aria-label={t('progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className={cn('h-1 overflow-hidden rounded-full bg-muted', failed && 'hidden')}
      >
        <div
          className="h-full rounded-full bg-foreground transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
      <ol className="flex flex-col">
        {item.progress.stages.map((stage) => (
          <StageRow key={stage.stage} stage={stage} />
        ))}
      </ol>
      {failed ? (
        <div className="flex flex-wrap gap-2">
          {item.failure?.retryable !== false ? (
            <Button type="button" variant="outline" size="sm" onClick={state.retry}>
              <RetryIcon data-icon="inline-start" />
              {t('retry')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={state.dismiss}>
            {t('dismiss')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Название этапа импорта; незнакомый этап — общими словами. */
function useStageLabel(): (stage: JobStage) => string {
  const t = useTranslations('projectPage.templates.import');
  return (stage) => (isImportStage(stage) ? t(`stages.${stage}`) : t('working'));
}

function StageRow({ stage }: { stage: GenerationStage }) {
  const t = useTranslations('projectPage.templates.import');
  const stageLabel = useStageLabel();
  const count =
    stage.state === 'running' && stage.total !== null && stage.total > 1
      ? t('stageCount', { done: stage.done ?? 0, total: stage.total })
      : null;
  return (
    <li
      className={cn(
        'flex items-center gap-2 py-0.5 text-xs',
        stage.state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
        stage.state === 'failed' && 'text-destructive',
      )}
    >
      <span className="grid size-3.5 shrink-0 place-items-center" aria-hidden>
        {stage.state === 'done' ? (
          <CheckIcon size={13} />
        ) : stage.state === 'failed' ? (
          <WarningIcon size={13} />
        ) : (
          <span
            className={cn(
              'size-1.5 rounded-full',
              stage.state === 'running' ? 'bg-foreground' : 'bg-muted-foreground/60',
            )}
          />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {stageLabel(stage.stage)}
        <span className="sr-only">, {t(`stageStates.${stage.state}`)}</span>
      </span>
      {count ? <span className="text-muted-foreground tabular-nums">{count}</span> : null}
    </li>
  );
}

/** Шаблоны библиотеки, которых нет в проекте: миниатюра, имя файла и число макетов. */
function LibraryTemplateItems({
  library,
  onChoose,
}: {
  library: readonly TemplateThumb[];
  onChoose: (template: TemplateThumb) => void;
}) {
  const t = useTranslations('projectPage.templates');
  if (library.length === 0) {
    return <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('libraryEmpty')}</p>;
  }
  return library.map((template) => (
    <DropdownMenuItem
      key={template.templateId}
      // Поиск по буквам — по имени файла, а не по тексту миниатюры.
      textValue={template.fileName}
      onSelect={() => onChoose(template)}
      className="gap-2.5 py-1.5"
    >
      <TemplateCover template={template} className="w-14 shrink-0 rounded-sm" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate">{template.fileName}</span>
        <span className="flex items-center gap-2 text-[0.6875rem] text-muted-foreground">
          <span className="shrink-0 tabular-nums">
            {t('layouts', { count: template.layoutCount })}
          </span>
          <PaletteStrip system={template.designSystem} className="h-1.5 w-10" />
        </span>
      </span>
    </DropdownMenuItem>
  ));
}

/** Одна строка честности: демо не извлекает профиль из файла. У движка строки нет. */
function useDemoProfileNote(): string | null {
  const t = useTranslations('projectPage.templates');
  return templateImporter.profilesFiles ? null : t('demoProfile');
}

/** Скрытое поле выбора файла шаблона; открывается кнопкой или пунктом меню. */
function useTemplateFileInput(onFile: (file: File) => void) {
  const input = useRef<HTMLInputElement>(null);
  const element = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT}
      tabIndex={-1}
      aria-hidden
      className="sr-only"
      onChange={(event) => {
        const [file] = Array.from(event.currentTarget.files ?? []);
        // Сбрасываем, чтобы тот же файл можно было выбрать снова после сбоя.
        event.currentTarget.value = '';
        if (file) onFile(file);
      }}
    />
  );
  return { element, open: () => input.current?.click() };
}

/** Перетаскивание файла на карточку: подсветка и первый файл из брошенных. */
function useFileDropTarget(onFile: (file: File) => void, enabled: boolean) {
  const [over, setOver] = useState(false);
  const hasFiles = (event: DragEvent) => enabled && event.dataTransfer.types.includes('Files');
  return {
    over,
    handlers: {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (hasFiles(event)) setOver(true);
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        // Переход на дочерний элемент — ещё не уход из зоны.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setOver(false);
        const [file] = Array.from(event.dataTransfer.files);
        if (file) onFile(file);
      },
    },
  };
}

/**
 * Последняя карточка ряда шаблонов: «Прикрепить шаблон». Щелчок открывает меню с двумя путями —
 * загрузить файл или выбрать из загруженных; файл можно и перетащить на карточку. Пока файл
 * разбирается, карточка показывает ход разбора, а по его окончании шаблон прикрепляется сам.
 */
export function AttachTemplateCard({
  projectId,
  library,
}: {
  projectId: string;
  library: readonly TemplateThumb[];
}) {
  const t = useTranslations('projectPage.templates');
  const state = useTemplateAttach(projectId);
  const busy = state.item !== undefined && state.item.phase !== 'failed';
  const file = useTemplateFileInput(state.upload);
  const drop = useFileDropTarget(state.upload, !busy);

  const frame = cn(
    'flex min-h-full w-full flex-col rounded-lg border border-dashed p-3',
    'transition-colors duration-100 motion-reduce:transition-none',
    drop.over ? 'border-foreground/60 bg-muted' : 'border-border',
  );

  if (state.item) {
    return (
      <div {...drop.handlers} className={cn(frame, 'justify-center')}>
        <ImportProgress state={state} />
        {file.element}
      </div>
    );
  }

  return (
    <div {...drop.handlers} className="h-full">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              frame,
              'items-center justify-center gap-2 text-center outline-none',
              'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              'focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-muted/60',
            )}
          >
            <span className="grid size-9 place-items-center rounded-full bg-muted">
              {drop.over ? (
                <CloudUploadIcon size={18} aria-hidden />
              ) : (
                <PlusIcon size={18} aria-hidden />
              )}
            </span>
            <span className="text-sm font-medium text-foreground">
              {drop.over ? t('dropHere') : t('attach')}
            </span>
            <span className="flex items-center gap-1 text-xs">
              {t('attachHint')}
              <ChevronDownIcon size={12} aria-hidden />
            </span>
          </button>
        </DropdownMenuTrigger>
        <AttachMenuContent library={library} state={state} onUpload={file.open} />
      </DropdownMenu>
      {file.element}
    </div>
  );
}

/** Меню «Прикрепить шаблон»: загрузить файл или выбрать из загруженных. */
function AttachMenuContent({
  library,
  state,
  onUpload,
}: {
  library: readonly TemplateThumb[];
  state: TemplateAttach;
  /** Пункт «Загрузить файл»; без него в меню только загруженные шаблоны. */
  onUpload?: () => void;
}) {
  const t = useTranslations('projectPage.templates');
  const demoNote = useDemoProfileNote();
  return (
    <DropdownMenuContent align="start" className="w-72">
      {onUpload ? (
        <>
          <DropdownMenuItem onSelect={onUpload}>
            <UploadIcon />
            {t('upload')}
          </DropdownMenuItem>
          <div className="flex flex-col gap-1 px-2 pt-0.5 pb-1.5 text-xs text-muted-foreground">
            <p>{t('dropHint')}</p>
            {demoNote ? <p className="text-balance">{demoNote}</p> : null}
          </div>
          <DropdownMenuSeparator />
        </>
      ) : null}
      <DropdownMenuLabel>{t('fromLibrary')}</DropdownMenuLabel>
      {/* Шаблонов в библиотеке бывает много: список прокручивается, а не уходит за край. */}
      <div className="max-h-72 overflow-y-auto">
        <LibraryTemplateItems library={library} onChoose={(template) => state.attach(template)} />
      </div>
    </DropdownMenuContent>
  );
}

/**
 * Проект без шаблонов: крупное пустое состояние вместо списка. Презентации проекта собираются
 * по его шаблонам, поэтому начинать не с чего, пока шаблона нет. Файл перетаскивают в зону или
 * выбирают кнопкой; уже загруженные шаблоны — отдельной кнопкой. Пока файл разбирается, на
 * месте зоны — ход разбора.
 */
export function TemplateEmptyState({
  projectId,
  library,
}: {
  projectId: string;
  library: readonly TemplateThumb[];
}) {
  const t = useTranslations('projectPage.templates');
  const state = useTemplateAttach(projectId);
  const demoNote = useDemoProfileNote();
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-center gap-5 rounded-xl border border-dashed border-border px-6 py-12 text-center"
    >
      <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <TemplateIcon size={22} aria-hidden />
      </span>
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {t('empty.title')}
        </h2>
        <p className="text-sm text-balance text-muted-foreground">{t('empty.body')}</p>
      </div>

      <div className="flex w-full max-w-md flex-col gap-3">
        {state.item ? (
          <ImportProgress state={state} className="rounded-lg p-4 text-left ring-1 ring-border" />
        ) : (
          <FileDrop
            accept={ACCEPT}
            icon={CloudUploadIcon}
            title={
              <>
                <span>{t('empty.drop')}</span>
                <span className="text-muted-foreground">{t('empty.or')}</span>
              </>
            }
            chooseLabel={t('empty.choose')}
            hint={demoNote ?? TEMPLATE_EXTENSIONS.join(', ')}
            onFiles={(files) => {
              const [first] = files;
              if (first) state.upload(first);
            }}
            className="py-8"
          />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={state.attaching}
              className="self-center"
            >
              {t('chooseFromLibrary')}
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <AttachMenuContent library={library} state={state} />
        </DropdownMenu>
      </div>
    </section>
  );
}
