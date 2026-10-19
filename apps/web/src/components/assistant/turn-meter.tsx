'use client';

import { useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
} from 'motion/react';
import type { TurnUsage } from '@/lib/chat-store';
import { formatElapsed, useNow } from './elapsed';

/**
 * Сколько идёт ответ и сколько токенов он потратил: ↑ — отправлено модели, ↓ — получено от неё.
 * Числа приходят с сервера несколько раз в секунду и докатываются до нового значения.
 */
export function TurnMeter({ startedAt, usage }: { startedAt: number; usage: TurnUsage | null }) {
  const t = useTranslations('deckChat.usage');
  const now = useNow(true);
  const reduce = useReducedMotion();
  return (
    <span
      aria-hidden
      title={
        usage ? t('title', { input: usage.inputTokens, output: usage.outputTokens }) : undefined
      }
      className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums text-muted-foreground/80"
    >
      <span>{formatElapsed(now - startedAt)}</span>
      {usage ? (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={reduce ? { duration: 0 } : { duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="flex items-center gap-1.5"
        >
          <span aria-hidden>·</span>
          <span>
            ↑ <RollingNumber value={usage.inputTokens} />
          </span>
          <span>
            ↓ <RollingNumber value={usage.outputTokens} />{' '}
            {/* «1,2 тыс. токенов»: после тысяч слово всегда во множественном числе. */}
            {t('tokens', { count: Math.min(usage.outputTokens, 1000) })}
          </span>
        </motion.span>
      ) : null}
    </span>
  );
}

/** Число, которое докатывается до нового значения, а не перескакивает. */
function RollingNumber({ value }: { value: number }) {
  const format = useFormatter();
  const reduce = useReducedMotion();
  const shown = useMotionValue(value);
  const ref = useRef<HTMLSpanElement>(null);
  const text = (amount: number) =>
    format.number(Math.round(amount), { notation: 'compact', maximumFractionDigits: 1 });
  // Текст после первого рендера пишет только анимация: React его не перезаписывает.
  const [initial] = useState(() => text(value));
  useEffect(() => {
    if (reduce) {
      shown.set(value);
      return;
    }
    const controls = animate(shown, value, { duration: 0.4, ease: [0.23, 1, 0.32, 1] });
    return () => controls.stop();
  }, [reduce, shown, value]);
  useMotionValueEvent(shown, 'change', (latest) => {
    if (ref.current) ref.current.textContent = text(latest);
  });
  return <span ref={ref}>{initial}</span>;
}
