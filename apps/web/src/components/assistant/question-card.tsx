'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { ChatAnswer, ChatPart } from '@lct/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type QuestionPart = Extract<ChatPart, { type: 'question' }>;

/**
 * Вопрос агента с вариантами, как `AskUserQuestion`: выбрать вариант (цифрой, стрелками или
 * мышью) и ответить, или написать ответ своими словами в поле ввода. Отвеченный вопрос бледнеет
 * и показывает ответ.
 */
export function QuestionCard({
  part,
  active,
  onAnswer,
}: {
  part: QuestionPart;
  /** Вопрос ждёт ответа и на него можно ответить сейчас. */
  active: boolean;
  onAnswer: (answer: ChatAnswer) => void;
}) {
  const t = useTranslations('deckChat.question');
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<readonly number[]>(
    part.options.length > 0 && !part.multiSelect ? [0] : [],
  );
  const answered = part.answer !== null;
  const open = active && !answered;
  const chosen = answered
    ? part.options.flatMap((option, index) =>
        part.answer?.optionLabels.includes(option.label) ? [index] : [],
      )
    : picked;

  const toggle = (index: number) =>
    setPicked((current) =>
      part.multiSelect
        ? current.includes(index)
          ? current.filter((at) => at !== index)
          : [...current, index]
        : [index],
    );
  const confirm = (indexes = picked) => {
    if (!open || indexes.length === 0) return;
    onAnswer({
      optionLabels: indexes.flatMap((index) => part.options[index]?.label ?? []),
      text: '',
    });
  };

  // Цифры выбирают вариант, пока вопрос ждёт ответа и человек не печатает в поле.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable]')) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < part.options.length) {
        event.preventDefault();
        toggle(index);
        box.current?.querySelectorAll<HTMLElement>('[data-option]')[index]?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' && open && picked.length > 0) {
      event.preventDefault();
      confirm();
    }
  };

  const answerText = part.answer
    ? [...part.answer.optionLabels, part.answer.text].filter(Boolean).join(', ')
    : '';

  return (
    <div
      ref={box}
      role="group"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={cn(
        'rounded-2xl bg-card/70 p-3 ring-1 ring-border transition-opacity duration-300',
        !open && 'opacity-70',
      )}
    >
      <p id={titleId} className="text-[0.8125rem] font-semibold text-pretty text-foreground">
        {part.question}
      </p>
      {part.multiSelect && open ? (
        <p className="mt-0.5 text-xs text-muted-foreground">{t('pickSeveral')}</p>
      ) : null}
      {part.options.length > 0 ? (
        <div
          role={part.multiSelect ? 'group' : 'radiogroup'}
          aria-labelledby={titleId}
          className="mt-2.5 flex flex-col gap-1.5"
        >
          {part.options.map((option, index) => {
            const checked = chosen.includes(index);
            return (
              <button
                key={`${option.label}-${index}`}
                type="button"
                data-option
                role={part.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={checked}
                disabled={!open}
                onClick={() => toggle(index)}
                onDoubleClick={() => (part.multiSelect ? undefined : confirm([index]))}
                className={cn(
                  'grid grid-cols-[auto_1fr] items-center gap-x-2.5 rounded-xl px-2.5 py-2 text-left outline-none',
                  'ring-1 ring-border transition-[box-shadow,background-color] duration-100 motion-reduce:transition-none',
                  'enabled:hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
                  'aria-checked:bg-muted/50 aria-checked:ring-[1.5px] aria-checked:ring-foreground',
                )}
              >
                <kbd
                  aria-hidden
                  className={cn(
                    'row-span-2 grid size-5 place-items-center rounded-md font-mono text-[0.6875rem] text-muted-foreground ring-1 ring-border',
                    checked && 'bg-foreground text-background ring-0',
                  )}
                >
                  {index + 1}
                </kbd>
                <span className="col-start-2 text-[0.8125rem] font-medium text-foreground">
                  {option.label}
                </span>
                {option.description ? (
                  <span className="col-start-2 text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {answered ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('answered', { answer: answerText })}
        </p>
      ) : open && part.options.length > 0 ? (
        <div className="mt-2.5 flex justify-end">
          <Button type="button" size="sm" disabled={picked.length === 0} onClick={() => confirm()}>
            {t('answer')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
