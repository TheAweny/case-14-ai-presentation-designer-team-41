'use client';

import { useRef, useState, useTransition, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  CloudIcon,
  ComputerIcon,
  DeleteIcon,
  EditIcon,
  MoreIcon,
  PlusIcon,
  RetryIcon,
  SpinnerIcon,
} from '@/components/ui/icons';
import {
  checkConnectionAction,
  deleteConnectionAction,
  setRoleAction,
  type SettingsResult,
} from '@/app/settings-actions';
import { ConfirmDeleteDialog } from '@/components/library/object-dialogs';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  PIPELINE_ROLES,
  assignmentFor,
  connectionLocation,
  rolesUsingConnection,
  unassignedRequiredRoles,
  type ModelConnection,
  type ModelSettings,
  type RoleAssignment,
} from '@/lib/model-settings';
import { ConnectionForm } from './connection-form';
import { RoleRow } from './role-row';
import { StatusDot } from './status-dot';
import { useCheckErrorText, useModelSettings } from './use-model-settings';

type Screen =
  { readonly kind: 'list' } | { readonly kind: 'form'; readonly connectionId: string | null };

/**
 * Раздел «Модели»: подключения к серверам моделей и роли пайплайна. Форма подключения открывается
 * вторым экраном того же раздела: ей нужно место, а список за ней не нужен.
 */
export function ModelSettingsPanel() {
  const t = useTranslations('settings.models');
  const { settings, failed, reload, setSettings } = useModelSettings();
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const addButton = useRef<HTMLButtonElement>(null);

  /**
   * Действие с ответом-настройками: при успехе — новые настройки, иначе — строка внизу и настройки
   * с сервера заново (на случай, если окно уже показало изменение заранее).
   */
  const apply = (run: () => Promise<SettingsResult>) =>
    new Promise<void>((resolve) => {
      startTransition(async () => {
        setNotice(null);
        const result = await run().catch(() => null);
        if (result?.ok) {
          setSettings(result.settings);
        } else {
          setNotice(t('actionFailed'));
          reload();
        }
        resolve();
      });
    });

  const check = async (connectionId: string) => {
    setChecking((current) => new Set(current).add(connectionId));
    await apply(() => checkConnectionAction(connectionId));
    setChecking((current) => {
      const next = new Set(current);
      next.delete(connectionId);
      return next;
    });
  };

  if (settings === null) {
    return (
      <PanelBody>
        <PanelHeader />
        {failed ? (
          <div role="alert" className="flex items-center gap-3 text-sm text-muted-foreground">
            {t('loadFailed')}
            <Button variant="outline" size="sm" onClick={reload}>
              {t('retry')}
            </Button>
          </div>
        ) : (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <SpinnerIcon size={14} className="animate-spin motion-reduce:animate-none" />
            {t('loading')}
          </p>
        )}
      </PanelBody>
    );
  }

  if (screen.kind === 'form') {
    const editing =
      screen.connectionId === null
        ? null
        : (settings.connections.find((item) => item.connectionId === screen.connectionId) ?? null);
    return (
      <PanelBody>
        <ConnectionForm
          // Новое подключение и каждое редактируемое — своя форма с чистым состоянием.
          key={screen.connectionId ?? 'new'}
          connection={editing}
          onDone={(next) => {
            if (next) setSettings(next);
            setScreen({ kind: 'list' });
          }}
        />
      </PanelBody>
    );
  }

  const missing = unassignedRequiredRoles(settings);

  return (
    <PanelBody>
      <PanelHeader />

      <section aria-labelledby="settings-connections" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 id="settings-connections" className="text-sm font-medium">
            {t('connections.title')}
          </h3>
          {settings.connections.length > 0 ? (
            <Button
              ref={addButton}
              variant="outline"
              onClick={() => setScreen({ kind: 'form', connectionId: null })}
            >
              <PlusIcon data-icon="inline-start" />
              {t('connections.add')}
            </Button>
          ) : null}
        </div>

        {settings.connections.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border px-4 py-5">
            <div className="grid gap-1">
              <p className="text-sm font-medium">{t('connections.emptyTitle')}</p>
              <p className="max-w-md text-xs text-pretty text-muted-foreground">
                {t('connections.emptyBody')}
              </p>
            </div>
            <Button ref={addButton} onClick={() => setScreen({ kind: 'form', connectionId: null })}>
              <PlusIcon data-icon="inline-start" />
              {t('connections.add')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-border">
            {settings.connections.map((connection) => (
              <li key={connection.connectionId}>
                <ConnectionCard
                  connection={connection}
                  settings={settings}
                  checking={checking.has(connection.connectionId)}
                  onCheck={() => void check(connection.connectionId)}
                  onEdit={() => setScreen({ kind: 'form', connectionId: connection.connectionId })}
                  onDelete={() => apply(() => deleteConnectionAction(connection.connectionId))}
                  // Карточки больше нет: фокус — на «Добавить», когда список перерисуется.
                  onDeleted={() => setTimeout(() => addButton.current?.focus())}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="settings-roles" className="flex flex-col gap-3">
        <div className="grid gap-1">
          <h3 id="settings-roles" className="text-sm font-medium">
            {t('roles.title')}
          </h3>
          <p className="text-xs text-pretty text-muted-foreground">{t('roles.description')}</p>
        </div>
        {settings.connections.length === 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusDot tone="warning" />
            {t('roles.needsConnection')}
          </p>
        ) : missing.length > 0 ? (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusDot tone="warning" />
            {t('roles.missing', { count: missing.length })}
          </p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border rounded-lg ring-1 ring-border">
          {PIPELINE_ROLES.map((role) => (
            <li key={role}>
              <RoleRow
                assignment={assignmentFor(settings, role)}
                connections={settings.connections}
                onChange={(next: RoleAssignment) => {
                  // Выбор виден сразу, не дожидаясь сервера: меню закрылось — роль уже другая.
                  setSettings((current) =>
                    current
                      ? {
                          ...current,
                          roles: current.roles.map((item) =>
                            item.role === next.role ? next : item,
                          ),
                        }
                      : current,
                  );
                  void apply(() => setRoleAction(next));
                }}
              />
            </li>
          ))}
        </ul>
      </section>

      {notice ? (
        <p role="alert" className="text-xs text-destructive">
          {notice}
        </p>
      ) : null}
    </PanelBody>
  );
}

function PanelBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-7 px-5 py-5 md:px-7 md:pt-6">{children}</div>;
}

function PanelHeader() {
  const t = useTranslations('settings.models');
  return (
    <div className="grid gap-1 md:pr-8">
      <h2 className="text-base font-semibold">{t('title')}</h2>
      <p className="max-w-xl text-xs text-pretty text-muted-foreground">{t('description')}</p>
    </div>
  );
}

/** Карточка подключения: имя, где работает, адрес, итог последней проверки и меню. */
function ConnectionCard({
  connection,
  settings,
  checking,
  onCheck,
  onEdit,
  onDelete,
  onDeleted,
}: {
  connection: ModelConnection;
  settings: ModelSettings;
  checking: boolean;
  onCheck: () => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onDeleted: () => void;
}) {
  const t = useTranslations('settings.models.connections');
  const tRoles = useTranslations('settings.models.roles.items');
  const errorText = useCheckErrorText();
  const format = useFormatter();
  const [confirming, setConfirming] = useState(false);
  const deleting = useRef(false);
  const location = connectionLocation(connection.baseUrl);
  const roles = rolesUsingConnection(settings, connection.connectionId);
  const check = connection.lastCheck;

  return (
    <div className="flex items-start gap-3 px-3 py-3">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        {location === 'local' ? <ComputerIcon size={16} /> : <CloudIcon size={16} />}
      </span>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">{connection.name}</span>
          <span className="shrink-0 rounded-sm px-1 text-[0.6875rem] font-normal text-muted-foreground ring-1 ring-border">
            {t(`location.${location}`)}
          </span>
        </p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate font-mono">{connection.baseUrl}</span>
          {connection.hasKey ? (
            <span className="shrink-0">
              ·{' '}
              {connection.keyHint === null
                ? t('keySetShort')
                : t('keySet', { hint: connection.keyHint })}
            </span>
          ) : null}
        </p>
        <p
          role="status"
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          {checking ? (
            <>
              <SpinnerIcon size={12} className="animate-spin motion-reduce:animate-none" />
              {t('status.checking')}
            </>
          ) : check === null ? (
            <>
              <StatusDot tone="idle" />
              {t('status.unchecked')}
            </>
          ) : check.ok ? (
            <>
              <StatusDot tone="ok" />
              {t('status.ok', { count: check.models.length })}
            </>
          ) : (
            <>
              <StatusDot tone="error" />
              <span className="min-w-0 break-words text-destructive">
                {t('status.failed', { reason: errorText(check.error) })}
              </span>
            </>
          )}
        </p>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('menu.label', { name: connection.name })}
            className="shrink-0 text-muted-foreground"
          >
            <MoreIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem disabled={checking} onSelect={onCheck}>
            <RetryIcon />
            {t('menu.check')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onEdit}>
            <EditIcon />
            {t('menu.edit')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <DeleteIcon />
            {t('menu.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('delete.title')}
        body={
          <>
            {t('delete.body', { name: connection.name })}
            {roles.length > 0 ? (
              <>
                {' '}
                {t('delete.roles', {
                  count: roles.length,
                  roles: format.list(
                    roles.map((role) => tRoles(`${role}.name`)),
                    { type: 'conjunction' },
                  ),
                })}
              </>
            ) : null}
          </>
        }
        confirmLabel={t('delete.confirm')}
        onConfirm={() => {
          deleting.current = true;
          void onDelete().then(onDeleted);
        }}
        // После отмены фокус возвращается на «⋯»; после удаления кнопки уже нет — им займётся
        // `onDeleted`.
        onCloseAutoFocus={(event) => {
          if (deleting.current) event.preventDefault();
        }}
      />
    </div>
  );
}
