'use client';

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { isSubmitKey, type PromptActionState } from './prompt-keys';
import { useAurora, type Aurora } from './use-aurora';
import { SendGlyph } from './send-glyph';

/**
 * Поле запроса к агенту — одно на главной, в чате колоды и в панели редактора. Собирается из
 * частей, как в чатах Codex и Claude: сверху вложения, под ними текст, внизу ряд контролов, справа
 * модель и круглая кнопка. Что лежит в ряду и что делает отправка, решает место, где поле стоит.
 *
 * ```tsx
 * const box = usePromptBox({ ready, busy });
 * <PromptBox box={box} onSubmit={send} onFiles={addFiles}>
 *   <PromptField value={text} onValueChange={setText} label="…" placeholder="…" />
 *   <PromptToolbar end={<PromptSubmit state={promptAction(…)} label="…" />}>…</PromptToolbar>
 * </PromptBox>
 * ```
 */

/**
 * Кнопки параметров в ряду поля — шаблон, число слайдов: без рамки, приглушённые, как
 * «Запрашивать разрешение» у Codex. Открытое меню подсвечивает свою кнопку.
 */
export const PROMPT_CHIP =
  'min-w-0 rounded-full px-2.5 font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground';

/** Выбор модели у кнопки отправки — залитая «таблетка», как выбор усилия у Codex. */
export const PROMPT_PILL =
  'min-w-0 rounded-full bg-muted/70 px-3 font-normal text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground';

/** Размер поля: крупное на главной, обычное в чате, плотное в узкой панели редактора. */
export type PromptSize = 'large' | 'default' | 'compact';

interface PromptBoxContext {
  readonly aurora: Aurora;
  readonly size: PromptSize;
}

const Context = createContext<PromptBoxContext | null>(null);

function usePromptBoxContext(): PromptBoxContext {
  const context = useContext(Context);
  if (!context) throw new Error('Prompt parts must be inside <PromptBox>');
  return context;
}

export interface PromptBoxHandle {
  readonly root: RefObject<HTMLDivElement | null>;
  /** Свечение рамки: `flash()` — волна от смены шаблона, `kick()` — от вложения. */
  readonly aurora: Aurora;
}

/**
 * Состояние рамки. Живёт у места, где стоит поле: оттуда виднее, когда вспыхнуть — например,
 * при смене шаблона в меню.
 */
export function usePromptBox({ ready, busy }: { ready: boolean; busy: boolean }): PromptBoxHandle {
  const root = useRef<HTMLDivElement>(null);
  const aurora = useAurora(root, { ready, sending: busy });
  return { root, aurora };
}

export function PromptBox({
  box,
  onSubmit,
  onFiles,
  dropLabel,
  size = 'default',
  busy = false,
  className,
  style,
  children,
}: {
  box: PromptBoxHandle;
  onSubmit: () => void;
  /** Файлы, перетащенные на поле. Без обработчика поле файлы не принимает. */
  onFiles?: (files: File[]) => void;
  /** Подпись над полем, пока над ним держат файлы. */
  dropLabel?: string;
  size?: PromptSize;
  /** Запрос ушёл и ждёт ответа — для программ чтения экрана. */
  busy?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const carriesFiles = (event: DragEvent) =>
    onFiles !== undefined && event.dataTransfer.types.includes('Files');

  return (
    <div
      ref={box.root}
      {...box.aurora.handlers}
      onDragOver={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        onFiles?.(Array.from(event.dataTransfer.files));
      }}
      className={cn('aurora', size === 'compact' ? 'rounded-xl' : 'rounded-2xl', className)}
      style={style}
    >
      <div aria-hidden className="aurora-halo" />
      <div aria-hidden className="aurora-ring" />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        aria-busy={busy}
        className={cn(
          'relative z-1 flex flex-col rounded-[inherit] bg-card ring-1 ring-border',
          size === 'compact' ? 'gap-1 p-2' : 'gap-1.5 p-2.5',
        )}
      >
        <Context.Provider value={{ aurora: box.aurora, size }}>
          <TooltipProvider>{children}</TooltipProvider>
        </Context.Provider>
      </form>
      {dragging ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-3 grid place-items-center rounded-[inherit] border border-dashed border-foreground/40 bg-card/90 text-sm text-foreground"
        >
          {dropLabel}
        </div>
      ) : null}
    </div>
  );
}

/** Вложения и контекст над текстом: чипы файлов, шаблона, объектов слайда. */
export function PromptChips({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5 px-1 pt-0.5">
      {children}
    </ul>
  );
}

/** Поле растёт по содержимому до своего max-height, дальше прокручивается. */
function fitHeight(element: HTMLTextAreaElement): void {
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

const FIELD_SIZE: Record<PromptSize, string> = {
  large: 'min-h-14 max-h-64 text-[0.9375rem]/relaxed',
  default: 'min-h-7 max-h-48 text-[0.9375rem]/relaxed',
  compact: 'min-h-7 max-h-40 text-[0.8125rem]/relaxed',
};

/**
 * Текст запроса. Растёт по содержимому до своего потолка, дальше прокручивается. Enter отправляет
 * форму, Shift+Enter — новая строка.
 */
export function PromptField({
  value,
  onValueChange,
  label,
  placeholder,
  fieldRef,
  describedBy,
  onKeyDown,
  onSelect,
  controls,
  activeDescendant,
  expanded,
  submitOnEnter = true,
  maxRows = 5,
}: {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
  placeholder: string;
  fieldRef?: RefObject<HTMLTextAreaElement | null>;
  describedBy?: string;
  /** Свои клавиши поля — раньше отправки; `preventDefault` отменяет её. */
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect?: () => void;
  controls?: string;
  activeDescendant?: string;
  expanded?: boolean;
  submitOnEnter?: boolean;
  maxRows?: number;
}) {
  const { aurora, size } = usePromptBoxContext();
  const own = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? own;

  useLayoutEffect(() => {
    const element = field.current;
    if (element) fitHeight(element);
  }, [field, value]);

  // Высота зависит и от ширины: поле могло измериться, пока колонка ещё раскладывалась, и
  // плейсхолдер перенёсся на много строк. Сменилась ширина — меряем заново.
  useEffect(() => {
    const element = field.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      fitHeight(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [field]);

  return (
    <textarea
      ref={field}
      value={value}
      rows={size === 'large' ? 2 : 1}
      aria-label={label}
      aria-describedby={describedBy}
      role={controls ? 'combobox' : undefined}
      aria-autocomplete={controls ? 'list' : undefined}
      aria-controls={controls}
      aria-activedescendant={activeDescendant}
      aria-expanded={expanded}
      onSelect={onSelect}
      style={{ maxHeight: `calc(${maxRows}lh + 0.5rem)` }}
      placeholder={placeholder}
      onChange={(event) => {
        onValueChange(event.currentTarget.value);
        aurora.kick();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (!isSubmitKey({ ...event, isComposing: event.nativeEvent.isComposing })) return;
        event.preventDefault();
        if (submitOnEnter) event.currentTarget.form?.requestSubmit();
      }}
      className={cn(
        'w-full resize-none overflow-y-auto bg-transparent px-1.5 pt-1 text-foreground outline-none placeholder:text-muted-foreground',
        FIELD_SIZE[size],
      )}
    />
  );
}

/**
 * Ряд контролов под текстом. `end` — модель и кнопка: они держатся справа вместе, даже когда ряд
 * переносится на узком экране.
 */
export function PromptToolbar({ children, end }: { children?: ReactNode; end: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {children}
      <div className="ml-auto flex min-w-0 items-center gap-1.5">{end}</div>
    </div>
  );
}

/**
 * Круглая кнопка поля: отправить, остановить сборку или ждать ухода запроса. Подсказка объясняет,
 * почему кнопка не нажимается (`blockedHint`), или показывает клавишу.
 */
export function PromptSubmit({
  state,
  label,
  stopLabel,
  blockedHint,
  onStop,
  stoppingLabel,
}: {
  state: PromptActionState;
  /** Что делает отправка здесь: «Отправить», «Сгенерировать». */
  label: string;
  stopLabel?: string;
  /** Почему отправлять нельзя, хотя текст есть. */
  blockedHint?: string;
  onStop?: () => void;
  stoppingLabel?: string;
}) {
  const t = useTranslations('composer.prompt');
  const { size } = usePromptBoxContext();
  const { action, disabled } = state;
  const name =
    action === 'stop'
      ? disabled && stoppingLabel
        ? stoppingLabel
        : (stopLabel ?? t('stop'))
      : action === 'sending'
        ? t('sending')
        : label;

  return (
    <Tooltip>
      {/*
       * Подсказка висит на обёртке: у недоступной кнопки нет событий указателя, а объяснить,
       * почему она не нажимается, нужно как раз тогда.
       */}
      <TooltipTrigger asChild>
        <span className="inline-flex rounded-full">
          <Button
            type={action === 'stop' && onStop ? 'button' : 'submit'}
            onClick={action === 'stop' ? onStop : undefined}
            size={size === 'compact' ? 'icon' : 'icon-lg'}
            disabled={disabled}
            aria-label={name}
            aria-keyshortcuts={action === 'send' ? 'Enter' : undefined}
            className={cn(
              // Акцент — цвет проекта, как свечение рамки; вне проекта — нейтральный.
              'rounded-full bg-[var(--aurora-color,var(--primary))] text-background hover:bg-[var(--aurora-color,var(--primary))]/85',
              'disabled:opacity-35',
              'transition-[transform,background-color,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.96] motion-reduce:transform-none motion-reduce:transition-none',
              // Пока запрос уходит, кнопка не блёкнет: это ответ на нажатие, а не запрет.
              action === 'sending' && 'disabled:opacity-100',
            )}
          >
            <SendGlyph stopped={action !== 'send'} />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {action === 'send' && disabled && blockedHint ? (
          blockedHint
        ) : (
          <>
            {name}
            {action === 'send' ? <Kbd>Enter</Kbd> : null}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** Строка под полем: отклонённые файлы и прочее, что нужно сказать о вводе. */
export function PromptNote({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="mt-1.5 px-1 text-xs text-destructive">
      {children}
    </p>
  );
}
