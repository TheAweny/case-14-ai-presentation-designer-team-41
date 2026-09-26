'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  BAR_OPTIONAL,
  EDITOR_PREFS_DEFAULT,
  LARGE_NUDGE_STEPS,
  RAIL_OPTIONAL,
  SELECTION_BAR_MODES,
  WHEEL_MODES,
  type EditorPrefs,
} from '@/components/editor/editor-prefs';
import { useEditorPrefs, useUpdateEditorPrefs } from '@/components/editor/use-editor-prefs';
import { ChoiceRow, Group, SectionHeader, SwitchRow } from './settings-rows';

/** Что сбрасывает кнопка раздела: только его поля, а не клавиши и не экспорт. */
const EDITOR_FIELDS = [
  'railHidden',
  'keepTool',
  'selectionBar',
  'barAssistant',
  'barHidden',
  'snap',
  'wheel',
  'largeNudge',
  'lockTemplate',
] as const satisfies readonly (keyof EditorPrefs)[];

/** Поменять состав списка: показать `id` или спрятать, сохранив порядок `all`. */
function toggled<T>(all: readonly T[], hidden: readonly T[], id: T, shown: boolean): readonly T[] {
  return shown
    ? hidden.filter((item) => item !== id)
    : all.filter((item) => item === id || hidden.includes(item));
}

/**
 * «Редактор»: рейка, полоса у объекта, холст и шаблон. Правка действует сразу — открытый за
 * окном редактор меняется на глазах — и запоминается в cookie.
 */
export function EditorSettingsPanel() {
  const t = useTranslations('settings.editor');
  const prefs = useEditorPrefs();
  const update = useUpdateEditorPrefs();
  const barOff = prefs.selectionBar === 'off';

  const isDefault = EDITOR_FIELDS.every(
    (field) => JSON.stringify(prefs[field]) === JSON.stringify(EDITOR_PREFS_DEFAULT[field]),
  );
  const reset = () =>
    update(Object.fromEntries(EDITOR_FIELDS.map((field) => [field, EDITOR_PREFS_DEFAULT[field]])));

  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <SectionHeader title={t('title')} description={t('description')} />

      <Group title={t('rail.title')}>
        {RAIL_OPTIONAL.map((id) => (
          <SwitchRow
            key={id}
            label={t(`rail.items.${id}`)}
            checked={!prefs.railHidden.includes(id)}
            onChange={(shown) =>
              update({ railHidden: toggled(RAIL_OPTIONAL, prefs.railHidden, id, shown) })
            }
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
          disabled={barOff}
          onChange={(barAssistant) => update({ barAssistant })}
        />
        {BAR_OPTIONAL.map((id) => (
          <SwitchRow
            key={id}
            label={t(`bar.items.${id}`)}
            hint={id === 'duplicate' ? t('bar.itemsHint') : undefined}
            checked={!prefs.barHidden.includes(id)}
            disabled={barOff}
            onChange={(shown) =>
              update({ barHidden: toggled(BAR_OPTIONAL, prefs.barHidden, id, shown) })
            }
          />
        ))}
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
        <Button variant="outline" size="lg" disabled={isDefault} onClick={reset}>
          {t('reset')}
        </Button>
      </div>
    </div>
  );
}
