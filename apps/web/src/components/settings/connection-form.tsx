'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { BackIcon, SpinnerIcon, SuccessIcon, WarningIcon } from '@/components/ui/icons';
import { probeConnectionAction, saveConnectionAction } from '@/app/settings-actions';
import { Button } from '@/components/ui/button';
import {
  API_KEY_MAX_LENGTH,
  BASE_URL_MAX_LENGTH,
  CONNECTION_HEADERS_MAX,
  CONNECTION_NAME_MAX_LENGTH,
  CONNECTION_PRESETS,
  PRESET_BASE_URLS,
  PRESET_NAMES,
  apiKeyProblem,
  baseUrlProblem,
  connectionInputProblems,
  connectionLocation,
  hasProblems,
  headersProblem,
  normalizeBaseUrl,
  normalizeHeaders,
  parseHeaderLines,
  suggestedConnectionName,
  VK_PROJECT_HEADER,
  type ConnectionCheck,
  type ConnectionHeader,
  type ConnectionPreset,
  type ModelConnection,
  type ModelSettings,
} from '@/lib/model-settings';
import { cn } from '@/lib/utils';
import { useCheckErrorText } from './use-model-settings';

type CheckState =
  | { readonly state: 'idle' }
  | { readonly state: 'running' }
  | {
      readonly state: 'done';
      readonly result: ConnectionCheck;
      /** Для каких адреса и ключа проверка: сохранится с подключением, только если они те же. */
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly headers: string;
    };

const IDLE: CheckState = { state: 'idle' };

/** Заголовки так, как их пишут в поле: по одному на строку, «Имя: значение». */
function headerLines(headers: readonly ConnectionHeader[]): string {
  return headers.map(({ name, value }) => `${name}: ${value}`).join('\n');
}

const inputClass = cn(
  'h-9 w-full rounded-md bg-background px-2.5 text-sm text-foreground outline-none',
  'ring-1 ring-border placeholder:text-muted-foreground focus:ring-2 focus:ring-ring',
  'aria-invalid:ring-destructive',
);

/**
 * Форма подключения — новое или правка. Пресет подставляет адрес и имя, пока человек их не
 * поменял сам. «Проверить подключение» спрашивает сервер моделей с сервера приложения и ничего не
 * сохраняет; сохранить можно и без проверки.
 *
 * Ключ в форму не приходит: при правке видно только «Ключ задан …abcd». Пустое поле ключа ключ
 * не стирает, «Заменить» открывает поле для нового.
 */
export function ConnectionForm({
  connection,
  canShare = false,
  onDone,
}: {
  /** null — новое подключение. */
  connection: ModelConnection | null;
  /**
   * Форму открыл администратор: подключение можно открыть всем аккаунтам. Новое у него общее по
   * умолчанию — ради этого администратор его и заводит.
   */
  canShare?: boolean;
  /** Форма закрыта: с новыми настройками после сохранения или null — отмена. */
  onDone: (settings: ModelSettings | null) => void;
}) {
  const t = useTranslations('settings.models.form');
  const tModels = useTranslations('settings.models');
  const errorText = useCheckErrorText();
  const ids = { name: useId(), url: useId(), key: useId(), headers: useId() };
  const [preset, setPreset] = useState<ConnectionPreset>(connection?.preset ?? 'vk-ai-space');
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? PRESET_BASE_URLS['vk-ai-space']);
  // null — имя не трогали: его предлагает форма по пресету и адресу.
  const [nameDraft, setNameDraft] = useState<string | null>(connection?.name ?? null);
  const [replacingKey, setReplacingKey] = useState(connection?.hasKey !== true);
  const [apiKey, setApiKey] = useState('');
  const [showProblems, setShowProblems] = useState(false);
  const [check, setCheck] = useState<CheckState>(IDLE);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [shared, setShared] = useState(connection ? connection.shared === true : canShare);
  const [headersText, setHeadersText] = useState(headerLines(connection?.headers ?? []));
  // У VK AI Space из заголовков нужен только проект: он вводится отдельным полем.
  const [projectId, setProjectId] = useState(
    connection?.headers?.find((header) => header.name === VK_PROJECT_HEADER)?.value ?? '',
  );
  const checkRun = useRef(0);
  const nameInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const firstPreset = useRef<HTMLInputElement>(null);
  const headersInput = useRef<HTMLTextAreaElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);

  const name = nameDraft ?? suggestedConnectionName(preset, baseUrl);
  const enteredKey = replacingKey ? apiKey : undefined;
  const problems = connectionInputProblems({ name, baseUrl, apiKey: enteredKey });
  const visible = showProblems ? problems : {};
  const location = baseUrlProblem(baseUrl) === null ? connectionLocation(baseUrl) : null;
  const vk = preset === 'vk-ai-space';
  const headers = vk
    ? projectId.trim()
      ? [{ name: VK_PROJECT_HEADER, value: projectId.trim() }]
      : []
    : normalizeHeaders(parseHeaderLines(headersText));
  const headerIssue = headersProblem(headers);
  const projectIdMissing = vk && projectId.trim() === '';
  const formIssue = projectIdMissing || headerIssue !== null;
  const focusHeaders = () => (vk ? projectInput : headersInput).current?.focus();
  // По нему проверка помнит, с какими заголовками она прошла.
  const headersKey = JSON.stringify(headers);

  useEffect(() => {
    // Новое подключение начинают с выбора сервера, правку — с имени.
    if (connection) nameInput.current?.focus();
    else firstPreset.current?.focus();
  }, [connection]);

  /** Адрес или ключ поменялись: прошлая проверка больше ничего не говорит. */
  const forgetCheck = () => {
    checkRun.current += 1;
    setCheck(IDLE);
  };

  const choosePreset = (next: ConnectionPreset) => {
    // Адрес меняется вместе с пресетом, только пока он пресетный или пустой: свой не затираем.
    const untouched =
      baseUrl.trim() === '' || normalizeBaseUrl(baseUrl) === PRESET_BASE_URLS[preset];
    const nextUrl = untouched ? PRESET_BASE_URLS[next] : baseUrl;
    if (untouched) {
      setBaseUrl(nextUrl);
      forgetCheck();
    }
    if (nameDraft !== null && nameDraft === suggestedConnectionName(preset, baseUrl)) {
      setNameDraft(null);
    }
    setPreset(next);
  };

  const focusFirstProblem = () => {
    if (problems.name) nameInput.current?.focus();
    else if (problems.baseUrl) urlInput.current?.focus();
    else if (problems.apiKey) keyInput.current?.focus();
    else if (formIssue) focusHeaders();
  };

  const runCheck = () => {
    setFailure(null);
    if (baseUrlProblem(baseUrl) || (enteredKey !== undefined && apiKeyProblem(enteredKey))) {
      setShowProblems(true);
      if (baseUrlProblem(baseUrl)) urlInput.current?.focus();
      else keyInput.current?.focus();
      return;
    }
    if (formIssue) {
      setShowProblems(true);
      focusHeaders();
      return;
    }
    const run = ++checkRun.current;
    const target = { baseUrl: normalizeBaseUrl(baseUrl), apiKey: enteredKey ?? '' };
    setCheck({ state: 'running' });
    probeConnectionAction({
      connectionId: connection?.connectionId,
      baseUrl: target.baseUrl,
      headers,
      apiKey: enteredKey,
    })
      .then((result) => {
        if (run !== checkRun.current) return;
        if (result.ok) {
          setCheck({ state: 'done', result: result.check, ...target, headers: headersKey });
          return;
        }
        setCheck(IDLE);
        setFailure(
          result.reason === 'notFound'
            ? t('gone')
            : result.reason === 'keysUnavailable'
              ? t('keysUnavailable')
              : null,
        );
        if (result.reason === 'invalid') setShowProblems(true);
      })
      .catch(() => {
        if (run !== checkRun.current) return;
        setCheck(IDLE);
        setFailure(tModels('actionFailed'));
      });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    if (hasProblems(problems) || formIssue) {
      setShowProblems(true);
      focusFirstProblem();
      return;
    }
    const lastCheck =
      check.state === 'done' &&
      check.baseUrl === normalizeBaseUrl(baseUrl) &&
      check.headers === headersKey &&
      check.apiKey === (enteredKey ?? '')
        ? check.result
        : undefined;
    setSaving(true);
    saveConnectionAction({
      connectionId: connection?.connectionId,
      name,
      preset,
      baseUrl,
      apiKey: enteredKey,
      lastCheck,
      headers,
      ...(canShare ? { shared } : {}),
    })
      .then((result) => {
        if (result.ok) {
          onDone(result.settings);
          return;
        }
        setSaving(false);
        if (result.reason === 'notFound') setFailure(t('gone'));
        else if (result.reason === 'keysUnavailable') setFailure(t('keysUnavailable'));
        else setShowProblems(true);
      })
      .catch(() => {
        setSaving(false);
        setFailure(tModels('actionFailed'));
      });
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-6">
      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="ghost"
          className="-ml-2 text-muted-foreground"
          onClick={() => onDone(null)}
        >
          <BackIcon data-icon="inline-start" />
          {t('back')}
        </Button>
        <h2 className="text-base font-semibold md:pr-8">
          {connection ? t('editTitle') : t('newTitle')}
        </h2>
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-xs text-muted-foreground">{t('preset.label')}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {/* VK AI Space — модель финала: отдельной строкой сверху, остальные под ней. */}
          {CONNECTION_PRESETS.map((option, index) => (
            <label
              key={option}
              className={cn(
                'relative flex min-h-14 cursor-pointer flex-col justify-center gap-0.5 rounded-lg px-3 py-2',
                option === 'vk-ai-space' && 'col-span-2 sm:col-span-4',
                'ring-1 ring-border transition-[box-shadow,background-color] duration-100',
                'motion-reduce:transition-none hover:bg-muted/50',
                'has-checked:bg-muted has-checked:ring-2 has-checked:ring-foreground/40',
                'has-focus-visible:ring-2 has-focus-visible:ring-ring',
              )}
            >
              <input
                ref={index === 0 ? firstPreset : undefined}
                type="radio"
                name="preset"
                value={option}
                checked={preset === option}
                onChange={() => choosePreset(option)}
                className="sr-only"
              />
              <span className="text-sm leading-tight font-medium">
                {option === 'custom' ? t('preset.custom') : PRESET_NAMES[option]}
              </span>
              {option === 'custom' || option === 'vk-ai-space' ? (
                <span className="text-[0.6875rem] leading-tight text-muted-foreground">
                  {option === 'custom' ? t('preset.customHint') : t('preset.vkHint')}
                </span>
              ) : (
                <span className="truncate font-mono text-[0.6875rem] text-muted-foreground">
                  {new URL(PRESET_BASE_URLS[option]).host}
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>

      <Field
        id={ids.name}
        label={t('name.label')}
        problem={
          visible.name && t(`problems.name.${visible.name}`, { max: CONNECTION_NAME_MAX_LENGTH })
        }
      >
        <input
          ref={nameInput}
          id={ids.name}
          value={name}
          maxLength={CONNECTION_NAME_MAX_LENGTH}
          placeholder={t('name.placeholder')}
          autoComplete="off"
          aria-invalid={visible.name ? true : undefined}
          aria-describedby={visible.name ? `${ids.name}-problem` : undefined}
          onChange={(event) => setNameDraft(event.currentTarget.value)}
          className={inputClass}
        />
      </Field>

      <Field
        id={ids.url}
        label={t('baseUrl.label')}
        aside={
          location ? (
            <span className="rounded-sm px-1 text-[0.6875rem] text-muted-foreground ring-1 ring-border">
              {/* Та же подпись, что на карточке подключения. */}
              {tModels(`connections.location.${location}`)}
            </span>
          ) : null
        }
        hint={t('baseUrl.hint')}
        problem={visible.baseUrl && t(`problems.baseUrl.${visible.baseUrl}`)}
      >
        <input
          ref={urlInput}
          id={ids.url}
          type="url"
          inputMode="url"
          value={baseUrl}
          maxLength={BASE_URL_MAX_LENGTH}
          placeholder={t('baseUrl.placeholder')}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={visible.baseUrl ? true : undefined}
          aria-describedby={`${ids.url}-hint${visible.baseUrl ? ` ${ids.url}-problem` : ''}`}
          onChange={(event) => {
            setBaseUrl(event.currentTarget.value);
            forgetCheck();
          }}
          className={cn(inputClass, 'font-mono text-xs')}
        />
      </Field>

      <Field
        id={ids.key}
        label={
          <>
            {t('apiKey.label')}
            {vk ? null : (
              <>
                {' '}
                <span className="text-muted-foreground/70">· {t('apiKey.optional')}</span>
              </>
            )}
          </>
        }
        hint={t('apiKey.hint')}
        problem={
          visible.apiKey && t(`problems.apiKey.${visible.apiKey}`, { max: API_KEY_MAX_LENGTH })
        }
      >
        {replacingKey ? (
          <div className="flex items-center gap-2">
            <input
              ref={keyInput}
              id={ids.key}
              type="password"
              value={apiKey}
              maxLength={API_KEY_MAX_LENGTH * 2}
              // Не «off»: его браузеры для паролей не слушают и подставили бы сюда пароль входа.
              autoComplete="new-password"
              spellCheck={false}
              aria-invalid={visible.apiKey ? true : undefined}
              aria-describedby={`${ids.key}-hint${visible.apiKey ? ` ${ids.key}-problem` : ''}`}
              onChange={(event) => {
                setApiKey(event.currentTarget.value);
                forgetCheck();
              }}
              className={cn(inputClass, 'font-mono')}
            />
            {connection?.hasKey ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={() => {
                  setReplacingKey(false);
                  setApiKey('');
                  forgetCheck();
                }}
              >
                {t('apiKey.keep')}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex h-9 items-center justify-between gap-2 rounded-md px-2.5 ring-1 ring-border">
            <span id={ids.key} className="truncate font-mono text-xs text-muted-foreground">
              {connection?.keyHint
                ? t('apiKey.setHint', { hint: connection.keyHint })
                : t('apiKey.set')}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setReplacingKey(true);
                forgetCheck();
                // Поле появится после перерисовки.
                setTimeout(() => keyInput.current?.focus());
              }}
            >
              {t('apiKey.replace')}
            </Button>
          </div>
        )}
      </Field>

      {vk ? (
        <Field
          id={ids.headers}
          label={t('projectId.label')}
          hint={t('projectId.hint')}
          problem={showProblems && projectIdMissing && t('projectId.missing')}
        >
          <input
            ref={projectInput}
            id={ids.headers}
            value={projectId}
            maxLength={200}
            placeholder={t('projectId.placeholder')}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={showProblems && projectIdMissing ? true : undefined}
            aria-describedby={`${ids.headers}-hint${showProblems && projectIdMissing ? ` ${ids.headers}-problem` : ''}`}
            onChange={(event) => {
              setProjectId(event.currentTarget.value);
              forgetCheck();
            }}
            className={cn(inputClass, 'font-mono text-xs')}
          />
        </Field>
      ) : (
        <Field
          id={ids.headers}
          label={
            <>
              {t('headers.label')}{' '}
              <span className="text-muted-foreground/70">· {t('apiKey.optional')}</span>
            </>
          }
          hint={t('headers.hint')}
          problem={
            showProblems &&
            headerIssue !== null &&
            t(`problems.headers.${headerIssue}`, { max: CONNECTION_HEADERS_MAX })
          }
        >
          <textarea
            ref={headersInput}
            id={ids.headers}
            value={headersText}
            rows={2}
            placeholder={t('headers.placeholder')}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={showProblems && headerIssue ? true : undefined}
            aria-describedby={`${ids.headers}-hint${showProblems && headerIssue ? ` ${ids.headers}-problem` : ''}`}
            onChange={(event) => {
              setHeadersText(event.currentTarget.value);
              forgetCheck();
            }}
            className={cn(inputClass, 'h-auto min-h-16 resize-y py-2 font-mono text-xs')}
          />
        </Field>
      )}

      <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 ring-1 ring-border">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={check.state === 'running'}
            onClick={runCheck}
          >
            {check.state === 'running' ? (
              <SpinnerIcon
                data-icon="inline-start"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {check.state === 'running' ? t('checking') : t('check')}
          </Button>
          {check.state === 'idle' ? (
            <span className="text-xs text-muted-foreground">{t('unsavedHint')}</span>
          ) : null}
        </div>
        <div aria-live="polite" className="empty:hidden">
          {check.state === 'done' ? (
            <CheckResult check={check.result} errorText={errorText} />
          ) : null}
        </div>
      </div>

      {canShare ? (
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={shared}
            onChange={(event) => setShared(event.currentTarget.checked)}
            className="mt-0.5 accent-foreground"
          />
          <span className="grid gap-0.5">
            {t('shared.label')}
            <span className="text-xs text-pretty text-muted-foreground">{t('shared.hint')}</span>
          </span>
        </label>
      ) : null}

      {failure ? (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="lg" onClick={() => onDone(null)}>
          {t('cancel')}
        </Button>
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
      </div>
    </form>
  );
}

/** Поле формы: подпись, само поле, пояснение и проблема — связаны с полем через id. */
function Field({
  id,
  label,
  aside,
  hint,
  problem,
  children,
}: {
  id: string;
  label: ReactNode;
  aside?: ReactNode;
  hint?: string;
  problem?: string | false;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {problem ? (
        <p id={`${id}-problem`} role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      ) : null}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-pretty text-muted-foreground/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Итог проверки в форме: найденные модели списком или причина неудачи. */
function CheckResult({
  check,
  errorText,
}: {
  check: ConnectionCheck;
  errorText: ReturnType<typeof useCheckErrorText>;
}) {
  const t = useTranslations('settings.models.form');
  if (!check.ok) {
    return (
      <p className="flex items-start gap-2 text-xs text-destructive">
        <WarningIcon size={14} className="mt-px shrink-0" />
        {t('checkFailed', { reason: errorText(check.error) })}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2 text-xs">
        <SuccessIcon size={14} className="shrink-0 text-(--project-green)" />
        {t('checkOk', { count: check.models.length })}
      </p>
      {check.models.length > 0 ? (
        <ul className="flex max-h-32 flex-wrap gap-1 overflow-y-auto">
          {check.models.map((model) => (
            <li
              key={model}
              className="max-w-full truncate rounded-sm bg-background px-1.5 py-0.5 font-mono text-[0.6875rem] text-muted-foreground ring-1 ring-border"
            >
              {model}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
