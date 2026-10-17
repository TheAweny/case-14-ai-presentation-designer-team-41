'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  MODEL_ID_MAX_LENGTH,
  isRoleOptional,
  usesWriterModelByDefault,
  knownModels,
  modelOffered,
  modelsLimited,
  type ModelConnection,
  type RoleAssignment,
} from '@/lib/model-settings';
import { cn } from '@/lib/utils';
import { MODEL_SEARCH_FROM, byFamily, shortModelName } from '@/lib/writer-models';
import { StatusDot } from './status-dot';

/** Значение пункта меню: пара «подключение, модель» без риска склеить разделитель с id. */
const modelValue = (connectionId: string, modelId: string) =>
  JSON.stringify([connectionId, modelId]);
const DISABLED_VALUE = 'disabled';

/** Атрибут поля, которое само решает, что делать с Esc: окно настроек от него не закрывается. */
export const OWN_ESCAPE_ATTRIBUTE = 'data-own-escape';

/**
 * Строка роли: что роль делает и кто её выполняет. Модель выбирают из списка последней проверки
 * подключения; если списка нет — или нужной модели в нём нет, — id вписывают вручную. Длинный
 * список подключения разложен по семействам, каждое — своим подменю. У подключения, где часть
 * моделей выключена, вписать id нельзя: так обходили бы выключение.
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
  const tFamilies = useTranslations('composer.model.families');
  const { role } = assignment;
  const [manualFor, setManualFor] = useState<string | null>(null);
  const manualAsked = useRef<string | null>(null);
  const optional = isRoleOptional(role);
  const name = primary ? t('primaryName') : t(`items.${role}.name`);
  // Подсказка о типе модели — там, где подойдёт не любая: у зрения и иллюстратора.
  const hint =
    role === 'vision'
      ? t('items.vision.hint')
      : role === 'image'
        ? t('items.image.hint')
        : role === 'speech'
          ? t('items.speech.hint')
          : null;

  const current =
    assignment.kind === 'model'
      ? modelValue(assignment.connectionId, assignment.modelId)
      : assignment.kind === 'disabled'
        ? DISABLED_VALUE
        : assignment.kind === 'default' ||
            (assignment.kind === 'unassigned' && usesWriterModelByDefault(role))
          ? 'default'
          : '';
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
          // Выбирать не из чего: почему — сказано один раз над списком ролей.
          <p className="flex h-8 items-center gap-2 text-xs text-muted-foreground sm:justify-end">
            <StatusDot tone="warning" />
            {t('unassigned')}
          </p>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="lg"
                className="relative h-10 w-full justify-between gap-2 rounded-lg bg-muted/25 px-3 font-normal shadow-xs transition-[background-color,border-color,box-shadow] duration-150 data-[state=open]:border-ring/50 data-[state=open]:bg-muted/60"
              >
                {/* Для чтения с экрана — какая роль, а видимое значение кнопки остаётся её именем. */}
                <span className="sr-only">{t('picker.label', { role: name })}: </span>
                <PickerValue assignment={assignment} connections={connections} />
                <ChevronDownIcon
                  data-icon="inline-end"
                  className="text-muted-foreground transition-transform duration-200 group-data-[state=open]/button:rotate-180 motion-reduce:transition-none"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 max-w-[calc(100vw-2rem)] p-1.5"
              onCloseAutoFocus={(event) => {
                if (manualAsked.current === null) return;
                // Поле открываем, когда меню закрылось: иначе оно вернуло бы фокус на кнопку.
                event.preventDefault();
                setManualFor(manualAsked.current);
                manualAsked.current = null;
              }}
            >
              <DropdownMenuRadioGroup
                value={current}
                onValueChange={(value) => {
                  if (value === DISABLED_VALUE) {
                    onChange({ role, kind: 'disabled' });
                    return;
                  }
                  if (value === 'default') {
                    onChange({ role, kind: 'default' });
                    return;
                  }
                  const [connectionId, modelId] = JSON.parse(value) as [string, string];
                  onChange({ role, kind: 'model', connectionId, modelId });
                }}
              >
                {usesWriterModelByDefault(role) ? (
                  <DropdownMenuRadioItem value="default">
                    {t('writerDefault')}
                  </DropdownMenuRadioItem>
                ) : null}
                {connections.map((connection, index) => {
                  const models = [...knownModels(connection)];
                  // Вписанная вручную модель тоже видна в списке и отмечена, пока её не выключили.
                  if (
                    assignment.kind === 'model' &&
                    assignment.connectionId === connection.connectionId &&
                    !models.includes(assignment.modelId) &&
                    modelOffered(connection, assignment.modelId)
                  ) {
                    models.unshift(assignment.modelId);
                  }
                  const families = byFamily(models);
                  const grouped = models.length >= MODEL_SEARCH_FROM && families.length > 1;
                  const item = (modelId: string) => (
                    <DropdownMenuRadioItem
                      key={modelId}
                      value={modelValue(connection.connectionId, modelId)}
                      className="font-normal data-[state=checked]:bg-accent/70"
                    >
                      <span className="truncate" title={modelId}>
                        {shortModelName(modelId)}
                      </span>
                    </DropdownMenuRadioItem>
                  );
                  return (
                    <div key={connection.connectionId} role="group" aria-label={connection.name}>
                      {index > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuLabel className="truncate">{connection.name}</DropdownMenuLabel>
                      {models.length === 0 ? (
                        <DropdownMenuItem disabled>{t('picker.noModels')}</DropdownMenuItem>
                      ) : grouped ? (
                        families.map((group) => (
                          <DropdownMenuSub key={group.family}>
                            <DropdownMenuSubTrigger>
                              <span className="min-w-0 flex-1 truncate">
                                {tFamilies(group.family)}
                              </span>
                              {group.models.some(
                                (modelId) =>
                                  modelValue(connection.connectionId, modelId) === current,
                              ) ? (
                                <CheckIcon aria-hidden />
                              ) : null}
                              <span className="text-muted-foreground tabular-nums">
                                {group.models.length}
                              </span>
                            </DropdownMenuSubTrigger>
                            <DropdownMenuPortal>
                              <DropdownMenuSubContent className="max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto">
                                {group.models.map(item)}
                              </DropdownMenuSubContent>
                            </DropdownMenuPortal>
                          </DropdownMenuSub>
                        ))
                      ) : (
                        models.map(item)
                      )}
                      {modelsLimited(connection) ? null : (
                        <DropdownMenuItem
                          className="text-muted-foreground"
                          onSelect={() => {
                            manualAsked.current = connection.connectionId;
                          }}
                        >
                          {t('picker.manual')}
                        </DropdownMenuItem>
                      )}
                    </div>
                  );
                })}
                {optional ? (
                  <>
                    {connections.length > 0 ? <DropdownMenuSeparator /> : null}
                    <DropdownMenuRadioItem value={DISABLED_VALUE}>
                      {t(role === 'speech' ? 'disabledSpeech' : 'disabled')}
                    </DropdownMenuRadioItem>
                  </>
                ) : null}
              </DropdownMenuRadioGroup>
              {assignment.kind !== 'unassigned' ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onChange({ role, kind: 'unassigned' })}>
                    {t('picker.clear')}
                  </DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
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
