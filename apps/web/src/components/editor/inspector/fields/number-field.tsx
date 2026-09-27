'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { Icon } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import {
  clampNumber,
  formatNumber,
  parseFieldInput,
  roundTo,
  stepNumber,
} from '@/components/editor/inspector/number-input';
import { evaluateExpression } from '@/components/editor/inspector/fields/expression';
import { FIELD_CLASS } from '@/components/editor/inspector/fields/field-chrome';
import { scrubFactor } from '@/components/editor/inspector/fields/scrub';
import { useScrub } from '@/components/editor/inspector/fields/use-scrub';

export interface NumberFieldProps {
  /** Буква слева (X, Y, W, H). Без неё нужна `icon`. */
  label?: string;
  icon?: Icon;
  /** `null` — у выделенных объектов значения разные. */
  value: number | null;
  onCommit: (value: number) => void;
  /**
   * Правка «разных» значений: относительный ввод (`+10`, `*2`), стрелки и перетаскивание
   * применяются к каждому объекту от его собственного значения. Без неё такие правки
   * при `value === null` не делаются, а абсолютное число задаётся всем через `onCommit`.
   */
  onCommitEach?: (apply: (old: number) => number) => void;
  /** Живой вид во время перетаскивания. В историю не пишется. */
  onPreview?: (value: number) => void;
  /** То же для «разных» значений. */
  onPreviewEach?: (apply: (old: number) => number) => void;
  /** Жест закончен (после `onCommit` или отмены по Esc): живой вид пора убрать. */
  onPreviewEnd?: () => void;
  step?: number;
  min?: number;
  max?: number;
  /** Знаков после запятой в поле и в применённом значении. */
  precision?: number;
  suffix?: string;
  mixedLabel: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Для составных полей: что делать, если поле очистили. Без него пустое поле откатывается. */
  onClear?: () => void;
  /** Для составных полей: элемент справа внутри плашки (шеврон списка). */
  trailing?: ReactNode;
  fieldRef?: Ref<HTMLLabelElement>;
  className?: string;
}

/**
 * Числовое поле как в Figma.
 *
 * - Ввод применяется по Enter или уходу из поля, Esc возвращает прежнее значение.
 * - Понимает выражения (`100+20`, `(10+5)/3`) и правку от текущего (`+10`, `- 10`, `*2`, `/2`),
 *   единицы после числа (`12pt`, `45°`) пропускает.
 * - Стрелки меняют на шаг, с Shift — на десять, с Alt — на десятую; одно нажатие — одна
 *   запись в истории, как у стрелок на холсте.
 * - Подпись или иконку можно тянуть мышью влево-вправо (см. `useScrub`).
 */
export function NumberField({
  label,
  icon: FieldIcon,
  value,
  onCommit,
  onCommitEach,
  onPreview,
  onPreviewEach,
  onPreviewEnd,
  step = 1,
  min,
  max,
  precision = 1,
  suffix,
  mixedLabel,
  ariaLabel,
  disabled,
  onClear,
  trailing,
  fieldRef,
  className,
}: NumberFieldProps) {
  const [draft, setDraftState] = useState<string | null>(null);
  // Enter и Esc сами уводят фокус, и blur приходит в том же событии, со старым `draft` в
  // замыкании. Ссылка видит сброс сразу, и ввод не применяется дважды.
  const draftRef = useRef<string | null>(null);
  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const scrub = useScrub({
    value,
    enabled: !disabled,
    step,
    min,
    max,
    precision,
    onCommit,
    onCommitEach,
    onPreview,
    onPreviewEach,
    onPreviewEnd,
  });

  const shown = value === null ? '' : formatNumber(value, precision);
  const text = scrub.text ?? draft ?? shown;
  const bound = (next: number) => clampNumber(roundTo(next, precision), min, max);

  const commitValue = (next: number) => {
    const bounded = bound(next);
    if (!Number.isFinite(bounded)) return;
    if (value !== null && Math.abs(bounded - value) < 1e-9) return;
    onCommit(bounded);
  };

  const commitEach = (apply: (old: number) => number) => {
    onCommitEach?.((old) => bound(apply(old)));
  };

  const commitText = (raw: string) => {
    setDraft(null);
    const input = parseFieldInput(raw);
    if (input === null) return;
    if (input.kind === 'empty') {
      onClear?.();
      return;
    }
    if (input.kind === 'absolute') {
      commitValue(input.value);
      return;
    }
    if (value !== null) commitValue(input.apply(value));
    else if (onCommitEach) commitEach(input.apply);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (draftRef.current !== null) commitText(draftRef.current);
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
      event.currentTarget.blur();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const delta = step * scrubFactor(event) * (event.key === 'ArrowUp' ? 1 : -1);
      const typed = draftRef.current === null ? null : evaluateExpression(draftRef.current);
      setDraft(null);
      if (typed === null && value === null) {
        commitEach((old) => stepNumber(old, delta));
        return;
      }
      commitValue(stepNumber(typed ?? value ?? 0, delta));
    }
  };

  const handleClass = cn(
    'shrink-0 text-muted-foreground select-none',
    scrub.draggable && 'cursor-ew-resize hover:text-foreground',
  );

  return (
    <label
      ref={fieldRef}
      className={cn(FIELD_CLASS, disabled && 'pointer-events-none opacity-50', className)}
    >
      {FieldIcon ? (
        <span className={cn(handleClass, 'grid h-full place-items-center')} {...scrub.handleProps}>
          <FieldIcon size={13} />
        </span>
      ) : (
        <span
          className={cn(handleClass, 'grid h-full w-3 place-items-center')}
          {...scrub.handleProps}
        >
          {label}
        </span>
      )}
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={ariaLabel}
        disabled={disabled}
        value={text}
        placeholder={value === null ? mixedLabel : undefined}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={() => {
          if (draftRef.current !== null) commitText(draftRef.current);
        }}
        onKeyDown={onKeyDown}
        className="min-w-0 flex-1 bg-transparent tabular-nums text-foreground outline-none placeholder:text-muted-foreground"
      />
      {suffix ? <span className="shrink-0 text-muted-foreground select-none">{suffix}</span> : null}
      {trailing}
    </label>
  );
}
