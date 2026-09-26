'use client';

import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  EDITOR_PREFS_DEFAULT,
  LARGE_NUDGE_STEPS,
  RAIL_OPTIONAL,
  SELECTION_BAR_MODES,
  WHEEL_MODES,
  type RailOptional,
} from '@/components/editor/editor-prefs';
import { useEditorPrefs, useUpdateEditorPrefs } from '@/components/editor/use-editor-prefs';

/**
 * «Редактор»: рейка, полоса у объекта, холст и шаблон. Правка действует сразу — открытый за
 * окном редактор меняется на глазах — и запоминается в cookie.
 */
export function EditorSettingsPanel() {
  const t = useTranslations('settings.editor');
  const prefs = useEditorPrefs();
  const update = useUpdateEditorPrefs();

  const toggleRail = (id: RailOptional, shown: boolean) =>
    update({
      railHidden: shown
        ? prefs.railHidden.filter((hidden) => hidden !== id)
        : RAIL_OPTIONAL.filter((item) => item === id || prefs.railHidden.includes(item)),
    });

  const isDefault = JSON.stringify(prefs) === JSON.stringify(EDITOR_PREFS_DEFAULT);

  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <div className="grid gap-1 md:pr-8">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <Group title={t('rail.title')}>
        {RAIL_OPTIONAL.map((id) => (
          <SwitchRow
            key={id}
            label={t(`rail.items.${id}`)}
            checked={!prefs.railHidden.includes(id)}
            onChange={(shown) => toggleRail(id, shown)}
          />
        ))}
        <SwitchRow
          label={t('rail.keepTool')}
          hint={t('rail.keepToolHint')}
          checked={prefs.keepTool}
          onChange={(keepTool) => update({ keepTool })}
        />
      </Group>

      <Group title={t('bar.title')}>
        <ChoiceRow
          label={t('bar.mode')}
          hint={t(`bar.modeHint.${prefs.selectionBar}`)}
          value={prefs.selectionBar}
          options={SELECTION_BAR_MODES.map((id) => ({ id, label: t(`bar.modes.${id}`) }))}
          onChange={(selectionBar) => update({ selectionBar })}
        />
        <SwitchRow
          label={t('bar.assistant')}
          checked={prefs.barAssistant}
          disabled={prefs.selectionBar === 'off'}
          onChange={(barAssistant) => update({ barAssistant })}
        />
      </Group>

      <Group title={t('canvas.title')}>
        <SwitchRow
          label={t('canvas.snap')}
          hint={t('canvas.snapHint')}
          checked={prefs.snap}
          onChange={(snap) => update({ snap })}
        />
        <ChoiceRow
          label={t('canvas.wheel')}
          hint={t(`canvas.wheelHint.${prefs.wheel}`)}
          value={prefs.wheel}
          options={WHEEL_MODES.map((id) => ({ id, label: t(`canvas.wheelModes.${id}`) }))}
          onChange={(wheel) => update({ wheel })}
        />
        <ChoiceRow
          label={t('canvas.largeNudge')}
          hint={t('canvas.largeNudgeHint', { steps: prefs.largeNudge })}
          value={prefs.largeNudge}
          options={LARGE_NUDGE_STEPS.map((id) => ({ id, label: String(id) }))}
          onChange={(largeNudge) => update({ largeNudge })}
        />
      </Group>

      <Group title={t('template.title')}>
        <SwitchRow
          label={t('template.lock')}
          hint={t('template.lockHint')}
          checked={prefs.lockTemplate}
          onChange={(lockTemplate) => update({ lockTemplate })}
        />
      </Group>

      <div>
        <Button
          variant="outline"
          size="lg"
          disabled={isDefault}
          onClick={() => update(EDITOR_PREFS_DEFAULT)}
        >
          {t('reset')}
        </Button>
      </div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h3 id={id} className="pb-1 text-xs font-medium text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** Строка настройки: подпись и пояснение слева, управление справа, как строка языка в «Общих». */
function Row({
  label,
  hint,
  labelId,
  children,
}: {
  label: ReactNode;
  hint?: string;
  labelId: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border py-2.5">
      <div className="grid gap-0.5">
        <span id={labelId} className="text-sm">
          {label}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const labelId = useId();
  return (
    <Row label={label} hint={hint} labelId={labelId}>
      <Switch
        aria-labelledby={labelId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </Row>
  );
}

/** Выбор из двух-трёх значений — сегменты в ряд: всё видно сразу, без выпадающего списка. */
function ChoiceRow<T extends string | number>({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const labelId = useId();
  return (
    <Row label={label} hint={hint} labelId={labelId}>
      <ToggleGroupPrimitive.Root
        type="single"
        aria-labelledby={labelId}
        value={String(value)}
        onValueChange={(next) => {
          // Повторный клик по выбранному сегменту снимает выбор — у нас значение есть всегда.
          const option = options.find((candidate) => String(candidate.id) === next);
          if (option) onChange(option.id);
        }}
        className="flex shrink-0 rounded-lg bg-muted p-0.5"
      >
        {options.map((option) => (
          <ToggleGroupPrimitive.Item
            key={String(option.id)}
            value={String(option.id)}
            className={cn(
              'h-7 min-w-8 rounded-md px-2.5 text-xs text-muted-foreground outline-none',
              'transition-colors duration-100 motion-reduce:transition-none',
              'hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
              'data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm',
            )}
          >
            {option.label}
          </ToggleGroupPrimitive.Item>
        ))}
      </ToggleGroupPrimitive.Root>
    </Row>
  );
}
