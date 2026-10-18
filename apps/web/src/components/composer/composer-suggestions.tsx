'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { promptToken } from './prompt-token';

export interface ComposerSuggestion {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
  readonly search?: string;
  readonly choose: () => void;
}

export function useComposerSuggestions({
  text,
  field,
  onText,
  commands,
  sources,
  disabled,
}: {
  text: string;
  field: RefObject<HTMLTextAreaElement | null>;
  onText: (text: string) => void;
  commands: readonly ComposerSuggestion[];
  sources: readonly ComposerSuggestion[];
  disabled?: boolean;
}) {
  const t = useTranslations('deckChat.input');
  const reduce = useReducedMotion();
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLSpanElement>(null);
  const fresh = useRef(true);
  const frame = useRef(0);
  const [caret, setCaret] = useState(text.length);
  const [cursor, setCursor] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const token = promptToken(text, Math.min(caret, text.length));
  const stamp = `${text}:${caret}`;
  const rows =
    !disabled && token && dismissed !== stamp
      ? (token.kind === 'command' ? commands : sources)
          .filter((row) =>
            `${row.name} ${row.description ?? ''} ${row.search ?? ''}`
              .toLocaleLowerCase()
              .includes(token.query),
          )
          .slice(0, 30)
      : [];
  const active = Math.min(cursor, Math.max(0, rows.length - 1));
  const rowSignature = rows.map((row) => row.key + ':' + (row.description?.length ?? 0)).join('|');
  useEffect(() => {
    if (!rows.length) return;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (field.current?.closest('form')?.contains(target)) return;
      if (document.getElementById(id)?.parentElement?.contains(target)) return;
      setDismissed(stamp);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [rows.length, field, id, stamp]);
  const placeGlow = (instant: boolean) => {
    const el = list.current;
    const mark = glow.current;
    const row = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!mark || !row) return;
    const snap =
      fresh.current || instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    mark.style.transition = snap
      ? 'none'
      : 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1), opacity 160ms ease';
    mark.style.transform = `translateY(${row.offsetTop}px)`;
    mark.style.height = `${row.offsetHeight}px`;
    mark.style.opacity = '1';
    fresh.current = false;
  };
  useLayoutEffect(() => {
    placeGlow(false);
  }, [active, rowSignature, stamp, reduce]);
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const onScroll = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => placeGlow(true));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    motionQuery.addEventListener('change', onScroll);
    let initialResize = true;
    const resize = new ResizeObserver(() => {
      if (initialResize) {
        initialResize = false;
        return;
      }
      onScroll();
    });
    resize.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      motionQuery.removeEventListener('change', onScroll);
      resize.disconnect();
      cancelAnimationFrame(frame.current);
    };
  }, [rows.length, reduce]);
  const choose = (row: ComposerSuggestion) => {
    if (!token) return;
    onText(text.slice(0, token.start) + text.slice(token.end));
    row.choose();
    setCursor(0);
    requestAnimationFrame(() => {
      field.current?.focus();
      field.current?.setSelectionRange(token.start, token.start);
      setCaret(token.start);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!rows.length || event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(stamp);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
      setCursor(next);
      document.getElementById(`${id}-${next}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && !event.shiftKey) {
      const row = rows[active];
      if (row) {
        event.preventDefault();
        choose(row);
      }
    }
  };
  return {
    onKeyDown,
    onValueChange: (value: string) => {
      setCaret(field.current?.selectionStart ?? value.length);
      setCursor(0);
      setDismissed(null);
      onText(value);
    },
    onSelect: () => {
      const next = field.current?.selectionStart ?? text.length;
      if (next !== caret) {
        setCaret(next);
        setCursor(0);
      }
    },
    fieldProps: {
      controls: rows.length ? id : undefined,
      activeDescendant: rows.length ? `${id}-${active}` : undefined,
      expanded: rows.length ? true : undefined,
    },
    menu: (
      <AnimatePresence>
        {rows.length > 0 ? (
          <motion.div
            key="suggestions"
            initial={{ opacity: 0, y: reduce ? 0 : 5, scale: reduce ? 1 : 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduce ? 0 : 3, scale: reduce ? 1 : 0.98 }}
            transition={{ duration: reduce ? 0 : 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-30 origin-bottom-left rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-border"
          >
            <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              {t(token?.kind === 'command' ? 'commands' : 'context')}
            </p>
            <div
              ref={list}
              id={id}
              role="listbox"
              aria-label={t(token?.kind === 'command' ? 'commands' : 'context')}
              className="relative max-h-64 overflow-y-auto overscroll-contain"
            >
              <span ref={glow} aria-hidden className="menu-glow" />
              {rows.map((row, index) => (
                <button
                  key={row.key}
                  id={`${id}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerEnter={() => setCursor(index)}
                  onClick={() => choose(row)}
                  className={cn(
                    'relative z-1 flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none',
                    index === active && 'text-accent-foreground',
                  )}
                >
                  <span className="truncate">{row.name}</span>
                  {row.description ? (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {row.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    ),
  };
}
