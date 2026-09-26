'use client';

import { useTranslations } from 'next-intl';
import { EXPORT_NAMES } from '@/components/editor/editor-prefs';
import { useEditorPrefs, useUpdateEditorPrefs } from '@/components/editor/use-editor-prefs';
import { EXPORT_FORMATS } from '@/lib/deck-export';
import { SLIDE_COUNT_RANGE } from '@/lib/deck-generator';
import { ChoiceRow, Group, SectionHeader, SwitchRow } from './settings-rows';

/** «Авто» и каждое число из контракта прогона. */
const SLIDE_COUNTS = [
  'auto',
  ...Array.from(
    { length: SLIDE_COUNT_RANGE.max - SLIDE_COUNT_RANGE.min + 1 },
    (_, index) => SLIDE_COUNT_RANGE.min + index,
  ),
] as const;

/**
 * «Презентации»: с чего начинают поле генерации и окно экспорта. Это только начальные значения —
 * в самом поле и в окне их можно поменять для одной колоды.
 */
export function DeckSettingsPanel() {
  const t = useTranslations('settings.decks');
  const formats = useTranslations('exportDialog.formats');
  const prefs = useEditorPrefs();
  const update = useUpdateEditorPrefs();

  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <SectionHeader title={t('title')} description={t('description')} />

      <Group title={t('generation.title')}>
        <ChoiceRow
          label={t('generation.slideCount')}
          hint={t('generation.slideCountHint')}
          value={prefs.slideCount ?? 'auto'}
          options={SLIDE_COUNTS.map((id) => ({
            id,
            label: id === 'auto' ? t('generation.auto') : String(id),
          }))}
          onChange={(value) => update({ slideCount: value === 'auto' ? null : value })}
        />
      </Group>

      <Group title={t('export.title')}>
        <ChoiceRow
          label={t('export.format')}
          hint={formats(`${prefs.exportFormat}.description`)}
          value={prefs.exportFormat}
          options={EXPORT_FORMATS.map((id) => ({ id, label: id.toUpperCase() }))}
          onChange={(exportFormat) => update({ exportFormat })}
        />
        <ChoiceRow
          label={t('export.name')}
          hint={t(`export.nameHint.${prefs.exportName}`)}
          value={prefs.exportName}
          options={EXPORT_NAMES.map((id) => ({ id, label: t(`export.names.${id}`) }))}
          onChange={(exportName) => update({ exportName })}
        />
        <SwitchRow
          label={t('export.audit')}
          hint={t('export.auditHint')}
          checked={prefs.exportAudit}
          onChange={(exportAudit) => update({ exportAudit })}
        />
      </Group>
    </div>
  );
}
