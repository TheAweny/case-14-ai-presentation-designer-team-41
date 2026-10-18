'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDownIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ModelList } from '@/components/composer/model-menu';
import {
  MODEL_ID_MAX_LENGTH,
  isRoleOptional,
  usesWriterModelByDefault,
  modelsForRole,
  modelOffered,
  modelsLimited,
  type ModelConnection,
  type RoleAssignment,
} from '@/lib/model-settings';
import { shortModelName, writerModels } from '@/lib/writer-models';
import { useModelSettingsSnapshot } from './model-settings-store';
import { cn } from '@/lib/utils';
import { StatusDot } from './status-dot';

/** Атрибут поля, которое само решает, что делать с Esc: окно настроек от него не закрывается. */
export const OWN_ESCAPE_ATTRIBUTE = 'data-own-escape';

/**
 * Строка роли: что роль делает и кто её выполняет. Модель выбирают тем же списком, что и в
 * композере: поиск и производители. Если списка нет — или нужной модели в нём нет, — id вписывают
 * вручную. У подключения, где часть моделей выключена, вписать id нельзя: так обходили бы выключение.
 */
export function RoleRow({
  assignment,
  connections,
  onChange,
  primary = false,
}: {
  assignment: RoleAssignment;
  connections: readonly ModelConnection[];
  onChange: (next: RoleAssignment) => void;
  primary?: boolean;
}) {
  const t = useTranslations('settings.models.roles');
  const { role } = assignment;
  const [open, setOpen] = useState(false);
  const [manualFor, setManualFor] = useState<string | null>(null);
  const optional = isRoleOptional(role);
  const name = primary ? t('primaryName') : t(`items.${role}.name`);
  const hint =
    role === 'vision'
      ? t('items.vision.hint')
      : role === 'image'
        ? t('items.image.hint')
        : role === 'speech'
          ? t('items.speech.hint')
          : null;

  const settings = useModelSettingsSnapshot();
  const catalog = writerModels(
    settings ?? { connections: [...connections], roles: [assignment] },
    role,
  );
  const selected =
    assignment.kind === 'model'
      ? { connectionId: assignment.connectionId, modelId: assignment.modelId }
      : null;
  const models = { ...catalog, assigned: null };
  const manualConnection = connections.find((item) => item.connectionId === manualFor) ?? null;

  return (
    <div className="flex flex-col gap-2.5 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="grid min-w-0 gap-0.5">
        <p className="flex items-baseline gap-2 text-sm font-medium">
          {name}
          {primary ? null : (
            <code className="font-mono text-[0.6875rem] font-normal text-muted-foreground">
              {role}
            </code>
          )}
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          {primary ? t('primaryDescription') : t(`items.${role}.description`)}
        </p>
        {hint ? <p className="text-xs text-pretty text-muted-foreground/80">{hint}</p> : null}
      </div>

      <div className="flex shrink-0 flex-col sm:w-64">
        {manualConnection ? (
          <ManualModelInput
            connection={manualConnection}
            initial={
              assignment.kind === 'model' && assignment.connectionId === manualFor
                ? assignment.modelId
                : ''
            }
            onCancel={() => setManualFor(null)}
            onSave={(modelId) => {
              setManualFor(null);
              onChange({
                role,
                kind: 'model',
                connectionId: manualConnection.connectionId,
                modelId,
              });
            }}
          />
        ) : connections.length === 0 && !optional ? (
          <p className="flex h-8 items-center gap-2 text-xs text-muted-foreground sm:justify-end">
            <StatusDot tone="warning" />
            {t('unassigned')}
          </p>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="lg"
                className="relative h-10 w-full justify-between gap-2 rounded-lg bg-muted/25 px-3 font-normal shadow-xs transition-[background-color,border-color,box-shadow] duration-150 data-[state=open]:border-ring/50 data-[state=open]:bg-muted/60"
              >
                <span className="sr-only">{t('picker.label', { role: name })}: </span>
                <PickerValue assignment={assignment} connections={connections} />
                <ChevronDownIcon
                  data-icon="inline-end"
                  className="text-muted-foreground transition-transform duration-200 group-data-[state=open]/button:rotate-180 motion-reduce:transition-none"
                />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="flex max-h-[calc(100dvh-2rem)] w-[22rem] max-w-[calc(100vw-2rem)] flex-col p-0"
            >
              <ModelList
                models={models}
                selected={selected}
                followingDefault={false}
                depth={false}
                effort="high"
                onEffort={() => undefined}
                onPick={(ref) => {
                  onChange({
                    role,
                    kind: 'model',
                    connectionId: ref.connectionId,
                    modelId: ref.modelId,
                  });
                  setOpen(false);
                }}
                onUseDefault={() => undefined}
              />
              <div className="grid max-h-40 shrink-0 gap-0.5 overflow-y-auto border-t border-border p-1.5">
                {connections
                  .filter((connection) => !modelsLimited(connection))
                  .map((connection) => (
                    <Button
                      key={connection.connectionId}
                      type="button"
                      variant="ghost"
                      className="h-8 w-full min-w-0 justify-start overflow-hidden px-2 font-normal text-muted-foreground"
                      onClick={() => {
                        setOpen(false);
                        setTimeout(() => setManualFor(connection.connectionId), 0);
                      }}
                    >
                      <span className="min-w-0 truncate">
                        {t('picker.manual')} · {connection.name}
                      </span>
                    </Button>
                  ))}
                {usesWriterModelByDefault(role) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 w-full justify-start px-2 font-normal"
                    onClick={() => {
                      onChange({ role, kind: 'default' });
                      setOpen(false);
                    }}
                  >
                    {t('writerDefault')}
                  </Button>
                ) : null}
                {optional ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 w-full justify-start px-2 font-normal"
                    onClick={() => {
                      onChange({ role, kind: 'disabled' });
                      setOpen(false);
                    }}
                  >
                    {t(role === 'speech' ? 'disabledSpeech' : 'disabled')}
                  </Button>
                ) : null}
                {assignment.kind !== 'unassigned' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-8 w-full justify-start px-2 font-normal"
                    onClick={() => {
                      onChange({ role, kind: 'unassigned' });
                      setOpen(false);
                    }}
                  >
                    {t('picker.clear')}
                  </Button>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}

/** Что написано на кнопке роли: модель и подключение, «выключено» или «не назначена». */
function PickerValue({
  assignment,
  connections,
}: {
  assignment: RoleAssignment;
  connections: readonly ModelConnection[];
}) {
  const t = useTranslations('settings.models.roles');
  // Dictation without a model of its own takes the first speech model of the connections, as
  // the API does: the row says which one rather than "not assigned".
  const auto =
    assignment.kind === 'unassigned' && assignment.role === 'speech'
      ? connections
          .map((connection) => ({ connection, modelId: modelsForRole(connection, 'speech')[0] }))
          .find((item) => item.modelId !== undefined)
      : undefined;
  if (auto?.modelId) {
    return (
      <span className="flex min-w-0 items-center gap-1.5" title={auto.modelId}>
        <span className="truncate font-medium">{shortModelName(auto.modelId)}</span>
        <span className="max-w-24 shrink-0 truncate text-muted-foreground">
          {t('auto', { connection: auto.connection.name })}
        </span>
      </span>
    );
  }
  if (assignment.kind === 'disabled') {
    return (
      <span className="truncate text-muted-foreground">
        {t(assignment.role === 'speech' ? 'disabledSpeech' : 'disabled')}
      </span>
    );
  }
  if (assignment.kind === 'unassigned' || assignment.kind === 'default') {
    return (
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        <StatusDot
          tone={
            isRoleOptional(assignment.role) || usesWriterModelByDefault(assignment.role)
              ? 'idle'
              : 'warning'
          }
        />
        <span className="truncate">
          {usesWriterModelByDefault(assignment.role) ? t('writerDefault') : t('unassigned')}
        </span>
      </span>
    );
  }
  const connection = connections.find((item) => item.connectionId === assignment.connectionId);
  // Модель выключили уже после назначения: прогон с ней не начнётся, роль надо переназначить.
  const off = connection !== undefined && !modelOffered(connection, assignment.modelId);
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={off ? t('picker.off') : undefined}>
      {off ? <StatusDot tone="warning" /> : null}
      <span
        title={assignment.modelId}
        className={cn('truncate font-medium', off && 'text-muted-foreground line-through')}
      >
        {shortModelName(assignment.modelId)}
      </span>
      {connection ? (
        <span className="max-w-24 shrink-0 truncate text-muted-foreground">{connection.name}</span>
      ) : null}
    </span>
  );
}

/**
 * Id модели вручную: когда сервер не отдал список или нужной модели в нём нет. Enter сохраняет,
 * Esc возвращает кнопку выбора.
 */
function ManualModelInput({
  connection,
  initial,
  onCancel,
  onSave,
}: {
  connection: ModelConnection;
  initial: string;
  onCancel: () => void;
  onSave: (modelId: string) => void;
}) {
  const t = useTranslations('settings.models.roles.manual');
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const trimmed = draft.trim();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (trimmed !== '') onSave(trimmed);
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-1.5">
      <label htmlFor={id} className="truncate text-xs text-muted-foreground">
        {t('label', { connection: connection.name })}
      </label>
      <input
        id={id}
        // Поле появляется по выбору в меню: фокус сразу в нём.
        autoFocus
        value={draft}
        maxLength={MODEL_ID_MAX_LENGTH}
        placeholder={t('placeholder')}
        autoComplete="off"
        spellCheck={false}
        {...{ [OWN_ESCAPE_ATTRIBUTE]: '' }}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        className={cn(
          'h-8 w-full rounded-md bg-background px-2.5 font-mono text-xs text-foreground outline-none',
          'ring-1 ring-border placeholder:font-sans placeholder:text-muted-foreground',
          'focus:ring-2 focus:ring-ring',
        )}
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={trimmed === ''}>
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
