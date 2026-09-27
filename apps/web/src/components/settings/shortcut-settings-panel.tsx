'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { UndoIcon } from '@/components/ui/icons';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import {
  REMAPPABLE_SHORTCUTS,
  SHORTCUT_GROUPS,
  chordFromEvent,
  chordOwner,
  chordProblem,
  defaultShortcutSpec,
  encodeChord,
  shortcutDisplays,
  shortcutLabel,
  type ChordProblem,
  type ShortcutId,
} from '@/components/editor/editor-shortcuts';
import { useEditorPrefs, useUpdateEditorPrefs } from '@/components/editor/use-editor-prefs';
import { useIsMac } from './open-settings';
import { OWN_ESCAPE_ATTRIBUTE } from './role-row';
import { Group, SectionHeader } from './settings-rows';

/** Что сказать под строкой после записи: почему не вышло или у кого сочетание забрали. */
type Notice =
  | { kind: 'problem'; id: ShortcutId; problem: ChordProblem }
  | { kind: 'moved'; id: ShortcutId; from: ShortcutId };

/**
 * «Клавиши»: свои сочетания для команд редактора. Кнопка записывает следующее нажатие; занятое
 * сочетание переходит к новой команде, а у прежней остаётся «не назначено» — два действия на
 * одной клавише не бывают. Ctrl и Cmd — одно и то же, как их и слушает редактор.
 */
export function ShortcutSettingsPanel() {
  const t = useTranslations('settings.shortcuts');
  const items = useTranslations('shortcuts.items');
  const groups = useTranslations('shortcuts.groups');
  const prefs = useEditorPrefs();
  const update = useUpdateEditorPrefs();
  const mac = useIsMac();
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const overridden = Object.keys(prefs.shortcuts).length > 0;

  const assign = (id: ShortcutId, event: KeyboardEvent) => {
    const chord = chordFromEvent(event);
    const problem = chordProblem(chord);
    // Одни модификаторы — человек ещё набирает сочетание.
    if (problem === 'modifier') return;
    setRecording(null);
    if (problem) {
      setNotice({ kind: 'problem', id, problem });
      return;
    }
    const owner = chordOwner(chord, id);
    const next: Record<string, string | null> = { ...prefs.shortcuts, [id]: encodeChord(chord) };
    if (owner) next[owner] = null;
    // Вернули исходное сочетание — своей записи больше не нужно.
    const [original] = defaultShortcutSpec(id).chords;
    if (original && encodeChord({ ...original, label: undefined }) === encodeChord(chord)) {
      delete next[id];
    }
    update({ shortcuts: next });
    setNotice(owner ? { kind: 'moved', id, from: owner } : null);
  };

  const resetOne = (id: ShortcutId) => {
    const next = { ...prefs.shortcuts };
    delete next[id];
    update({ shortcuts: next });
    setNotice(null);
  };

  return (
    <div className="flex flex-col gap-6 px-5 py-5 md:px-7 md:pt-6">
      <SectionHeader title={t('title')} description={t('description')} />

      {SHORTCUT_GROUPS.map((group) => {
        const specs = REMAPPABLE_SHORTCUTS.filter((spec) => spec.group === group);
        if (specs.length === 0) return null;
        return (
          <Group key={group} title={groups(group)}>
            {specs.map(({ id }) => (
              <ShortcutRow
                key={id}
                id={id}
                label={items(id)}
                mac={mac}
                recording={recording === id}
                custom={id in prefs.shortcuts}
                notice={notice?.id === id ? notice : null}
                noticeText={
                  notice?.id !== id
                    ? null
                    : notice.kind === 'problem'
                      ? t(`problems.${notice.problem}`)
                      : t('moved', { command: items(notice.from) })
                }
                onRecord={() => {
                  setNotice(null);
                  setRecording(id);
                }}
                onCancel={() => setRecording(null)}
                onKey={(event) => assign(id, event)}
                onReset={() => resetOne(id)}
              />
            ))}
          </Group>
        );
      })}

      <div>
        <Button
          variant="outline"
          size="lg"
          disabled={!overridden}
          onClick={() => {
            update({ shortcuts: {} });
            setNotice(null);
          }}
        >
          {t('resetAll')}
        </Button>
      </div>
    </div>
  );
}

function ShortcutRow({
  id,
  label,
  mac,
  recording,
  custom,
  notice,
  noticeText,
  onRecord,
  onCancel,
  onKey,
  onReset,
}: {
  id: ShortcutId;
  label: string;
  mac: boolean;
  recording: boolean;
  custom: boolean;
  notice: Notice | null;
  noticeText: string | null;
  onRecord: () => void;
  onCancel: () => void;
  onKey: (event: KeyboardEvent) => void;
  onReset: () => void;
}) {
  const t = useTranslations('settings.shortcuts');
  const labelId = useId();
  const noticeId = useId();
  const [keys] = shortcutDisplays(id);

  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-border py-2">
      <div className="grid gap-0.5">
        <span id={labelId} className="text-sm">
          {label}
        </span>
        {noticeText ? (
          <span
            id={noticeId}
            role="status"
            className={cn(
              'text-xs',
              notice?.kind === 'problem' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {noticeText}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {custom ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('reset', { command: label })}
            title={t('reset', { command: label })}
            onClick={onReset}
          >
            <UndoIcon />
          </Button>
        ) : null}
        <button
          type="button"
          aria-labelledby={labelId}
          aria-describedby={noticeText ? noticeId : undefined}
          aria-pressed={recording}
          {...(recording ? { [OWN_ESCAPE_ATTRIBUTE]: '' } : {})}
          onClick={recording ? onCancel : onRecord}
          onBlur={recording ? onCancel : undefined}
          onKeyDown={(event) => {
            if (!recording) return;
            // Нажатие записывается, а не уходит редактору, окну или браузеру.
            event.preventDefault();
            event.stopPropagation();
            const bare = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
            if (bare && event.key === 'Escape') onCancel();
            else onKey(event);
          }}
          className={cn(
            'flex h-8 min-w-24 items-center justify-center gap-0.5 rounded-md border border-border px-2',
            'text-xs text-muted-foreground outline-none hover:bg-muted',
            'focus-visible:ring-2 focus-visible:ring-ring/50',
            recording && 'border-ring bg-muted text-foreground',
          )}
        >
          {recording
            ? t('press')
            : keys && keys.length > 0
              ? keys.map((key, index) => (
                  <Kbd key={`${key}-${index}`}>{shortcutLabel([key], mac)}</Kbd>
                ))
              : t('none')}
        </button>
      </div>
    </div>
  );
}
