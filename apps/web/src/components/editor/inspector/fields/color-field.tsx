'use client';

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { HexColorPicker } from 'react-colorful';
import { HugeiconsIcon } from '@hugeicons/react';
import { ColorPickerIcon } from '@hugeicons/core-free-icons';
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ColorRole, ColorValue, PaletteEntry } from '@lct/contracts';
import { cn } from '@/lib/utils';
import {
  colorHex,
  isColorRole,
  normalizeHex,
  parseCssColor,
} from '@/components/editor/inspector/fields/color';
import {
  FIELD_CLASS,
  FieldPopoverContent,
  useFocusReturn,
} from '@/components/editor/inspector/fields/field-chrome';

/**
 * Вид пикера под панель. Стили react-colorful вставляются без слоя и перебивают утилиты
 * Tailwind из `@layer`, поэтому правки — тоже обычным CSS, с областью по классу обёртки.
 */
const PICKER_CSS = `
.inspector-color-picker .react-colorful { width: 100%; height: 168px; gap: 10px; }
.inspector-color-picker .react-colorful__saturation { border-bottom: 0; border-radius: 6px; }
.inspector-color-picker .react-colorful__hue { height: 12px; border-radius: 999px; }
.inspector-color-picker .react-colorful__pointer { width: 14px; height: 14px; border-width: 2px; }
`;

interface EyeDropperResult {
  readonly sRGBHex: string;
}
type EyeDropperConstructor = new () => { open(): Promise<EyeDropperResult> };

function eyeDropper(): EyeDropperConstructor | null {
  if (typeof window === 'undefined' || !('EyeDropper' in window)) return null;
  return (window as unknown as { EyeDropper: EyeDropperConstructor }).EyeDropper;
}

export interface ColorFieldProps {
  palette: readonly PaletteEntry[];
  /** Роль палитры или свой HEX; `null` — без цвета; `undefined` — у выделенных цвета разные. */
  value: ColorValue | null | undefined;
  /** Одна запись в историю: выбор роли, ввод HEX, отпускание мыши в пикере, пипетка. */
  onChange: (value: ColorValue | null) => void;
  /** Живой вид, пока тянут мышью в пикере. */
  onPreview?: (hex: string) => void;
  /** Перетаскивание в пикере закончено: живой вид пора убрать. */
  onPreviewEnd?: () => void;
  roleLabel: (role: ColorRole) => string;
  /** Подпись «без цвета». Без неё этот вариант не предлагается. */
  noneLabel?: string;
  /** Подпись «разные»; по умолчанию общая «Разные». */
  mixedLabel?: string;
  ariaLabel: string;
  disabled?: boolean;
}

/**
 * Цвет как в Figma: квадратик, HEX (или имя роли палитры, как Figma показывает имя стиля),
 * по квадратику — пикер, пипетка и цвета шаблона. Роли идут первыми: они держат колоду
 * в фирменных цветах; свой HEX разрешён, если человек его выбрал.
 */
export function ColorField({
  palette,
  value,
  onChange,
  onPreview,
  onPreviewEnd,
  roleLabel,
  noneLabel,
  mixedLabel,
  ariaLabel,
  disabled,
}: ColorFieldProps) {
  const t = useTranslations('inspectorFields');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraftState] = useState<string | null>(null);
  // Как в числовом поле: blur после Enter приходит со старым `draft` в замыкании.
  const draftRef = useRef<string | null>(null);
  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  /** Цвет под мышью в пикере, пока жест не закончен. */
  const [live, setLive] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const focus = useFocusReturn({ focusOnOpen: false });

  const hex = value ? colorHex(palette, value) : null;
  const shownHex = live ?? hex;
  const role = value && isColorRole(value) ? value : null;

  const commitPending = () => {
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    setLive(null);
    if (next !== value) onChange(next);
    onPreviewEnd?.();
  };

  const commitDraft = () => {
    setEditing(false);
    const typed = draftRef.current;
    if (typed === null) return;
    setDraft(null);
    const next = normalizeHex(typed);
    // Мусор откатывается; тот же цвет роли не превращается в HEX.
    if (next === null || next === hex) return;
    onChange(next);
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
      setEditing(false);
      event.currentTarget.blur();
    }
  };

  const pickFromScreen = async () => {
    const EyeDropper = eyeDropper();
    if (!EyeDropper) return;
    try {
      const result = await new EyeDropper().open();
      const next = parseCssColor(result.sRGBHex);
      if (next && next !== value) onChange(next);
    } catch {
      // Esc в режиме пипетки — не ошибка, а отказ.
    }
  };

  const showInput = editing || (value !== undefined && value !== null && !role);
  const caption =
    value === undefined ? (mixedLabel ?? t('mixed')) : value === null ? noneLabel : null;

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) commitPending();
        setOpen(next);
      }}
    >
      <div
        role="group"
        aria-label={ariaLabel}
        className={cn(FIELD_CLASS, 'pl-1.5', disabled && 'pointer-events-none opacity-50')}
      >
        <PopoverPrimitive.Trigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={t('color.openPicker')}
            title={t('color.openPicker')}
            {...focus.trigger}
            className="grid size-5 shrink-0 place-items-center rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ColorChip hex={shownHex} none={value === null} mixed={value === undefined} />
          </button>
        </PopoverPrimitive.Trigger>
        {showInput ? (
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={7}
            aria-label={t('color.hex')}
            autoFocus={editing}
            value={draft ?? shownHex ?? ''}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={commitDraft}
            onKeyDown={onInputKeyDown}
            className="min-w-0 flex-1 bg-transparent uppercase tabular-nums text-foreground outline-none"
          />
        ) : (
          <button
            type="button"
            title={t('color.editHex')}
            onClick={() => setEditing(true)}
            className={cn(
              'min-w-0 flex-1 truncate text-left outline-none',
              role ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {role ? roleLabel(role) : caption}
          </button>
        )}
      </div>

      <FieldPopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="flex w-60 flex-col gap-3 p-3"
        onOpenAutoFocus={focus.content.onOpenAutoFocus}
        onCloseAutoFocus={focus.content.onCloseAutoFocus}
        onInteractOutside={focus.content.onInteractOutside}
      >
        <style>{PICKER_CSS}</style>
        <div onKeyUp={commitPending} className="inspector-color-picker">
          <HexColorPicker
            color={`#${shownHex ?? 'FFFFFF'}`}
            onChange={(next) => {
              const normalized = normalizeHex(next);
              if (!normalized) return;
              pending.current = normalized;
              setLive(normalized);
              onPreview?.(normalized);
            }}
            onChangeEnd={commitPending}
          />
        </div>

        {eyeDropper() ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={pickFromScreen}
            className={cn(
              'flex h-7 items-center gap-2 rounded-md bg-muted/60 px-2 text-xs text-foreground outline-none',
              'hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50',
            )}
          >
            <HugeiconsIcon
              icon={ColorPickerIcon}
              size={14}
              strokeWidth={1.5}
              color="currentColor"
            />
            {t('color.eyedropper')}
          </button>
        ) : null}

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{t('color.templateColors')}</p>
          <div
            role="radiogroup"
            aria-label={t('color.templateColors')}
            className="flex flex-wrap gap-1.5"
          >
            {noneLabel ? (
              <PaletteSwatch
                label={noneLabel}
                selected={value === null}
                onSelect={() => {
                  if (value !== null) onChange(null);
                }}
              >
                <ColorChip hex={null} none round />
              </PaletteSwatch>
            ) : null}
            {palette.map((entry) => (
              <PaletteSwatch
                key={entry.role}
                label={roleLabel(entry.role)}
                selected={value === entry.role}
                onSelect={() => {
                  if (value !== entry.role) onChange(entry.role);
                }}
              >
                <ColorChip hex={entry.hex} round />
              </PaletteSwatch>
            ))}
          </div>
        </div>
      </FieldPopoverContent>
    </PopoverPrimitive.Root>
  );
}

/** Образец цвета: заливка, «без цвета» (красная диагональ) или пустой — «разные». */
function ColorChip({
  hex,
  none,
  mixed,
  round,
}: {
  hex: string | null;
  none?: boolean;
  mixed?: boolean;
  round?: boolean;
}) {
  return (
    <span
      className={cn(
        'relative block overflow-hidden ring-1 ring-foreground/15 ring-inset',
        round ? 'size-5 rounded-full' : 'size-4 rounded-[3px]',
        (none || mixed || !hex) && 'bg-background',
      )}
      style={hex && !none ? { backgroundColor: `#${hex}` } : undefined}
    >
      {none ? (
        <span className="absolute top-1/2 left-1/2 h-px w-[140%] -translate-x-1/2 -translate-y-1/2 -rotate-45 bg-destructive" />
      ) : null}
    </span>
  );
}

function PaletteSwatch({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      // Кнопка не забирает фокус: выделение в открытом наборе текста остаётся.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        'grid size-6 place-items-center rounded-full outline-none',
        'ring-offset-1 ring-offset-popover transition-shadow duration-100 motion-reduce:transition-none',
        'hover:ring-1 hover:ring-muted-foreground focus-visible:ring-2 focus-visible:ring-ring',
        selected && 'ring-2 ring-foreground hover:ring-2 hover:ring-foreground',
      )}
    >
      {children}
    </button>
  );
}
