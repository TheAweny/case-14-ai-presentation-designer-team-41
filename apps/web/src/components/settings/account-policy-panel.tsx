'use client';
import { useEffect, useId, useState, useTransition } from 'react';
import { useLocale } from 'next-intl';
import { type AccountPolicy, type AccountUsageView, policyMetricSchema } from '@lct/contracts';
import {
  readAccountUsageAction,
  saveAccountPolicyAction,
  revokeAccountSessionsAction,
} from '@/app/account-policy-actions';
import { Button } from '@/components/ui/button';

const names = {
  ru: [
    'Успешные генерации',
    'Ответы ассистента',
    'Самостоятельные изображения',
    'Сохранённые редакции',
    'Параллельные сборки',
    'Хранение, байт',
  ],
  en: [
    'Successful generations',
    'Assistant responses',
    'Standalone images',
    'Saved revisions',
    'Concurrent builds',
    'Storage, bytes',
  ],
};
const field =
  'min-h-9 rounded-md bg-background px-2 text-sm ring-1 ring-border focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
export function AccountPolicyPanel({
  accountId,
  editable = false,
}: {
  accountId?: string;
  editable?: boolean;
}) {
  const english = useLocale() === 'en';
  const lang = english ? 'en' : 'ru';
  const prefix = useId();
  const [view, setView] = useState<AccountUsageView | null>(null);
  const [draft, setDraft] = useState<AccountPolicy>({});
  const [status, setStatus] = useState('');
  const [busy, start] = useTransition();
  useEffect(() => {
    let live = true;
    setView(null);
    setStatus('');
    readAccountUsageAction(accountId).then(
      (value) => {
        if (live) {
          setView(value);
          setDraft(value.override);
        }
      },
      () => {
        if (live)
          setStatus(
            english
              ? 'Could not load. Reopen settings to retry.'
              : 'Не удалось загрузить. Откройте настройки повторно.',
          );
      },
    );
    return () => {
      live = false;
    };
  }, [accountId, english]);
  if (!view)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {status || (english ? 'Loading activity…' : 'Загрузка активности…')}
      </p>
    );
  return (
    <section
      className="grid min-w-0 gap-4"
      aria-label={english ? 'Activity and limits' : 'Активность и ограничения'}
    >
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">
          {english ? 'Activity and limits' : 'Активность и ограничения'}
        </h3>
        <p className="text-xs text-muted-foreground">
          {english
            ? 'Limits are optional and set by an administrator. Three completed variants count as one generation.'
            : 'Лимиты необязательны и задаются администратором. Три готовых варианта — одна генерация.'}
        </p>
      </div>
      <div className="divide-y divide-border">
        {policyMetricSchema.options.map((metric, index) => {
          const row = view.metrics.find((item) => item.metric === metric);
          const config = draft[metric];
          const state =
            config === undefined ? 'inherit' : config === null ? 'unlimited' : 'limited';
          const used =
            metric === 'storage'
              ? view.storageBytes
              : metric === 'concurrency'
                ? row?.active
                : row?.completed;
          const effective = row?.limit;
          return (
            <div key={metric} className="grid min-w-0 gap-2 py-3">
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <label htmlFor={`${prefix}-${metric}`}>{names[lang][index]}</label>
                <span className="tabular-nums">
                  {used ?? 0}
                  {metric !== 'storage' && metric !== 'concurrency'
                    ? ` · ${english ? 'running' : 'выполняется'}: ${row?.active ?? 0}`
                    : ''}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {effective
                  ? `${english ? 'Administrator limit' : 'Лимит администратора'}: ${effective.limit} · ${english ? 'remaining' : 'осталось'}: ${Math.max(0, effective.limit - (used ?? 0) - (metric === 'concurrency' || metric === 'storage' ? 0 : (row?.active ?? 0)))}`
                  : english
                    ? 'Unlimited'
                    : 'Без ограничения'}
                {effective && row?.end
                  ? ` · ${english ? 'Resets' : 'Сброс'}: ${new Date(row.end).toLocaleString(english ? 'en' : 'ru', { timeZone: effective.timezone })} (${effective.timezone})`
                  : ''}
              </p>
              {metric === 'image' ? (
                <p className="text-xs text-muted-foreground">
                  {english
                    ? 'Images inside a deck do not count here. Standalone image generation is not currently available.'
                    : 'Картинки внутри колоды сюда не входят. Самостоятельная генерация изображений пока недоступна.'}
                </p>
              ) : null}
              {editable ? (
                <div className="flex min-w-0 flex-wrap gap-2">
                  <select
                    id={`${prefix}-${metric}`}
                    className={`${field} flex-1`}
                    value={state}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft((old) => {
                        const next = { ...old };
                        if (event.target.value === 'inherit') delete next[metric];
                        else
                          next[metric] =
                            event.target.value === 'unlimited'
                              ? null
                              : { limit: 0, period: 'lifetime', timezone: 'UTC' };
                        return next;
                      })
                    }
                  >
                    <option value="inherit">
                      {english ? 'Inherit common policy' : 'Наследовать общую политику'}
                    </option>
                    <option value="unlimited">{english ? 'Unlimited' : 'Без ограничения'}</option>
                    <option value="limited">{english ? 'Set limit' : 'Включить лимит'}</option>
                  </select>
                  {config ? (
                    <>
                      <input
                        aria-label={`${names[lang][index]}: ${english ? 'limit' : 'значение'}`}
                        className={`${field} w-28`}
                        type="number"
                        min="0"
                        step="1"
                        value={config.limit}
                        disabled={busy}
                        onChange={(event) =>
                          setDraft((old) => ({
                            ...old,
                            [metric]: { ...config, limit: Number(event.target.value) },
                          }))
                        }
                      />
                      {metric === 'storage' || metric === 'concurrency' ? null : (
                        <select
                          aria-label={english ? 'Period' : 'Период'}
                          className={field}
                          value={config.period}
                          disabled={busy}
                          onChange={(event) =>
                            setDraft((old) => ({
                              ...old,
                              [metric]: { ...config, period: event.target.value },
                            }))
                          }
                        >
                          <option value="lifetime">{english ? 'All time' : 'За всё время'}</option>
                          <option value="day">{english ? 'Day' : 'День'}</option>
                          <option value="month">{english ? 'Month' : 'Месяц'}</option>
                        </select>
                      )}
                      {config.period === 'lifetime' ? null : (
                        <input
                          aria-label={english ? 'IANA timezone' : 'Часовой пояс IANA'}
                          className={`${field} w-44`}
                          value={config.timezone}
                          disabled={busy}
                          onChange={(event) =>
                            setDraft((old) => ({
                              ...old,
                              [metric]: { ...config, timezone: event.target.value },
                            }))
                          }
                        />
                      )}
                      {config.limit === 0 ? (
                        <p className="w-full text-xs text-muted-foreground">
                          {english
                            ? 'Zero prevents new operations. Existing results stay available.'
                            : 'Ноль запрещает новые операции. Сохранённые результаты остаются доступны.'}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p role="status" className="text-xs text-muted-foreground">
        {status}
      </p>
      {editable && accountId ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              start(async () => {
                try {
                  const result = await saveAccountPolicyAction(accountId, draft);
                  if (result.ok) {
                    setView(result.view);
                    setStatus(english ? 'Saved' : 'Сохранено');
                  } else setStatus(result.message);
                } catch {
                  setStatus(
                    english ? 'Check values and timezone.' : 'Проверьте значения и часовой пояс.',
                  );
                }
              })
            }
          >
            {english ? 'Save limits' : 'Сохранить ограничения'}
          </Button>
          {accountId === 'default' ? null : (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                start(async () => {
                  const result = await revokeAccountSessionsAction(accountId);
                  setStatus(
                    result.ok
                      ? english
                        ? 'Sessions revoked'
                        : 'Сессии отозваны'
                      : english
                        ? 'Could not revoke sessions'
                        : 'Не удалось отозвать сессии',
                  );
                })
              }
            >
              {english ? 'Revoke all sessions' : 'Отозвать все сессии'}
            </Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
