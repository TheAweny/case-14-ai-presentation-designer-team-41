'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Как закончилась правка: с клавиатуры (Enter, Esc) или уходом фокуса из поля. */
export type InlineNameEnd = 'keyboard' | 'blur';

/**
 * Имя на месте подписи: в шапке проекта и в сайдбаре. Enter или уход из поля — сохранить,
 * Esc — отменить. Пустое имя и имя без изменений не сохраняются: `onDone` получает null.
 *
 * Как закончилась правка, важно вызывающему: после Enter фокус возвращают на объект, а после
 * щелчка мимо он остаётся там, куда щёлкнули.
 */
export function InlineNameInput({
  name,
  label,
  maxLength,
  className,
  onDone,
}: {
  name: string;
  label: string;
  maxLength: number;
  className?: string;
  onDone: (name: string | null, end: InlineNameEnd) => void;
}) {
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  // Enter и Esc закрывают поле, а за ними может прийти ещё и blur: второй раз не решаем.
  const settled = useRef(false);
  const settle = (next: string | null, end: InlineNameEnd) => {
    if (settled.current) return;
    settled.current = true;
    onDone(next, end);
  };
  const finish = (end: InlineNameEnd) => {
    const trimmed = draft.trim();
    settle(trimmed === '' || trimmed === name ? null : trimmed, end);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finish('keyboard');
    } else if (event.key === 'Escape') {
      event.preventDefault();
      settle(null, 'keyboard');
    }
  };
  return (
    <input
      ref={input}
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={() => finish('blur')}
      onKeyDown={onKeyDown}
      className={className}
    />
  );
}
