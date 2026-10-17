import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { IconCheck, IconChevronDown } from '@tabler/icons-react';
import './ChoicePicker.css';

export interface ChoiceOption {
  key: string;
  name: string;
  description?: string;
  icon?: ReactNode;
}

export function ChoicePicker({
  label,
  options,
  value,
  onChange,
  open: controlledOpen,
  onOpenChange,
  compact = false,
}: {
  label: string;
  options: readonly ChoiceOption[];
  value: string;
  onChange: (key: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  compact?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  const keyboardOpen = useRef(false);
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.key === value),
  );
  const selected = options[selectedIndex];
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!open || !keyboardOpen.current) return;
    rows.current[selectedIndex]?.focus({ preventScroll: true });
  }, [open, selectedIndex]);

  // The composer closes its controlled pickers; the standalone picker owns dismissal itself.
  useLayoutEffect(() => {
    if (!open || controlledOpen !== undefined) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setLocalOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, controlledOpen]);

  return (
    <div
      ref={root}
      className="choice-picker"
      data-compact={compact ? '' : undefined}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="prompt-bar__pick choice-picker__trigger"
        aria-label={label}
        title={`${label}: ${selected?.name ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        data-on={open ? '' : undefined}
        onClick={(event) => {
          keyboardOpen.current = event.detail === 0;
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            keyboardOpen.current = true;
            setOpen(true);
            if (open) rows.current[selectedIndex]?.focus({ preventScroll: true });
          }
        }}
      >
        {selected?.icon ? <span className="choice-picker__icon">{selected.icon}</span> : null}
        <span className="choice-picker__value">{selected?.name}</span>
        <IconChevronDown className="choice-picker__chevron" size={12} aria-hidden />
      </button>
      {open ? (
        <div
          id={id}
          role="listbox"
          aria-label={label}
          className="choice-picker__menu"
          onKeyDown={(event) => {
            const current = rows.current.indexOf(document.activeElement as HTMLButtonElement);
            let next: number | undefined;
            if (event.key === 'ArrowDown') next = (current + 1) % options.length;
            if (event.key === 'ArrowUp') next = (current - 1 + options.length) % options.length;
            if (event.key === 'Home') next = 0;
            if (event.key === 'End') next = options.length - 1;
            if (next !== undefined) {
              event.preventDefault();
              rows.current[next]?.focus();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
        >
          {options.map((option, index) => (
            <button
              key={option.key}
              ref={(element) => {
                rows.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={option.key === value}
              tabIndex={-1}
              className="choice-picker__row"
              onClick={() => {
                onChange(option.key);
                close();
              }}
            >
              {option.icon ? <span className="choice-picker__icon">{option.icon}</span> : null}
              <span className="choice-picker__copy">
                <span className="choice-picker__name">{option.name}</span>
                {option.description ? (
                  <span className="choice-picker__description">{option.description}</span>
                ) : null}
              </span>
              <IconCheck size={15} className="choice-picker__check" aria-hidden />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
