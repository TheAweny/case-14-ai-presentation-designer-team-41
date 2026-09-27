'use client';

import {
  useActionState,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import { EyeIcon, EyeOffIcon } from '@/components/ui/icons';
import { signInAction, type SignInState } from '@/app/auth-actions';
import { useAurora } from '@/components/composer/use-aurora';
import { Button } from '@/components/ui/button';
import { NEXT_PARAM } from '@/lib/auth';
import { cn } from '@/lib/utils';

const INITIAL: SignInState = { error: null, email: '' };

/**
 * Вход в композиции «Горизонт»: заголовок и форма над краем планеты, по кромке которой идёт
 * свет в цветах палитры проектов (`.horizon-*` в globals.css). Свет живой — тот же движок, что у
 * поля генерации (`useAurora`): волна при открытии, импульс на каждый символ, ярче в фокусе и
 * когда оба поля заполнены, на полную — пока идёт вход.
 *
 * Ошибка — строкой под паролем, почта после неудачи остаётся в поле, пароль стирается, а фокус
 * встаёт туда, где исправлять.
 *
 * Форма работает и без JavaScript: это обычная отправка в серверное действие.
 */
export function LoginForm({ next, hasAccounts }: { next: string; hasAccounts: boolean }) {
  const t = useTranslations('auth');
  const [state, formAction, pending] = useActionState(signInAction, INITIAL);
  const [shown, setShown] = useState(false);
  const errorId = useId();
  const failed = state.error !== null && !pending;
  const [filled, setFilled] = useState(false);
  const root = useRef<HTMLElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const aurora = useAurora(root, { ready: filled, sending: pending });
  // Страница открылась — по горизонту проходит волна. Движок отдаёт функции заново на каждый
  // рендер, поэтому зовём через событие эффекта, а не зависимость.
  const greet = useEffectEvent(() => aurora.flash());
  useEffect(() => greet(), []);

  // После неудачи — в поле, которое правят: пустая почта или пароль.
  useEffect(() => {
    if (state.error === null) return;
    const target = state.email.trim() === '' ? emailInput.current : passwordInput.current;
    target?.focus();
    setFilled(false);
  }, [state]);

  return (
    <main
      ref={root}
      {...aurora.handlers}
      className="horizon-scene relative isolate grid min-h-dvh place-items-center overflow-hidden bg-background px-4 pt-12 text-foreground"
    >
      {/* «Горизонт»: звёзды, мягкий луч и край планеты со свечением. Чистый декор. */}
      <div aria-hidden className="horizon-stars" />
      <div aria-hidden className="horizon-beam" />
      <div aria-hidden className="horizon-planet" />

      <div
        className={cn(
          'flex w-full max-w-[22.5rem] flex-col items-center',
          'animate-in duration-700 fade-in slide-in-from-bottom-2 motion-reduce:animate-none',
        )}
      >
        <h1 className="bg-linear-to-b from-foreground from-30% to-[oklch(0.8_0.08_290)] bg-clip-text text-[2rem] leading-tight font-semibold tracking-tight text-transparent">
          {t('heading')}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">{t('subtitle')}</p>

        <form
          action={formAction}
          noValidate
          className="mt-8 grid w-full gap-4"
          onInput={(event) => {
            aurora.kick();
            const form = event.currentTarget;
            const value = (name: string) => String(new FormData(form).get(name) ?? '');
            setFilled(value('email').trim() !== '' && value('password') !== '');
          }}
        >
          <input type="hidden" name={NEXT_PARAM} value={next} />
          <Field label={t('email')}>
            {(id) => (
              <input
                ref={emailInput}
                id={id}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoFocus
                required
                // Ключ по ответу сервера: после неудачи поле получает почту из ответа заново.
                key={state.email}
                defaultValue={state.email}
                placeholder={t('emailPlaceholder')}
                aria-invalid={failed || undefined}
                aria-describedby={failed ? errorId : undefined}
                className={inputClass}
              />
            )}
          </Field>

          <Field label={t('password')}>
            {(id) => (
              <div className="relative">
                <input
                  ref={passwordInput}
                  id={id}
                  name="password"
                  type={shown ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  key={`${state.email}:${state.error ?? ''}`}
                  aria-invalid={failed || undefined}
                  aria-describedby={failed ? errorId : undefined}
                  className={cn(inputClass, 'pr-10')}
                />
                <button
                  type="button"
                  aria-label={shown ? t('hidePassword') : t('showPassword')}
                  aria-pressed={shown}
                  title={shown ? t('hidePassword') : t('showPassword')}
                  onClick={() => setShown((value) => !value)}
                  className={cn(
                    'absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md',
                    'text-muted-foreground outline-none hover:bg-muted hover:text-foreground',
                    'transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring/50',
                    'motion-reduce:transition-none',
                  )}
                >
                  {shown ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            )}
          </Field>

          {failed ? (
            <p
              id={errorId}
              role="alert"
              className="-mt-1 text-xs text-destructive animate-in duration-200 fade-in"
            >
              {t(`errors.${state.error}`)}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={pending} className="mt-2 h-10 w-full text-sm">
            {pending ? t('submitting') : t('submit')}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-balance text-muted-foreground">
          {hasAccounts ? t('noAccess') : t('noAccounts')}
        </p>
      </div>
    </main>
  );
}

const inputClass = cn(
  'h-10 w-full rounded-lg bg-background/70 px-3 text-sm text-foreground outline-none backdrop-blur-sm',
  'ring-1 ring-border transition-shadow duration-100 motion-reduce:transition-none',
  'placeholder:text-muted-foreground/70 hover:ring-foreground/25 focus:ring-2 focus:ring-ring',
  'aria-invalid:ring-destructive',
);

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children(id)}
    </div>
  );
}
