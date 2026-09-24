'use client';

import { useTranslations } from 'next-intl';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import type { CanvasCommand } from '@/components/editor/editor-keymap';
import { shortcutKeys, shortcutLabel } from '@/components/editor/editor-shortcuts';

type MenuId =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'front'
  | 'forward'
  | 'backward'
  | 'back'
  | 'selectAll'
  | 'unlockAll'
  | 'remove';

type Entry = {
  readonly id: MenuId;
  readonly command: CanvasCommand;
  readonly keys: readonly string[];
  readonly needsSelection?: boolean;
  readonly destructive?: boolean;
};

const GROUPS: readonly (readonly Entry[])[] = [
  [
    { id: 'cut', command: { kind: 'cut' }, keys: shortcutKeys('cut'), needsSelection: true },
    { id: 'copy', command: { kind: 'copy' }, keys: shortcutKeys('copy'), needsSelection: true },
    { id: 'paste', command: { kind: 'paste' }, keys: shortcutKeys('paste') },
    {
      id: 'duplicate',
      command: { kind: 'duplicate' },
      keys: shortcutKeys('duplicate'),
      needsSelection: true,
    },
  ],
  [
    {
      id: 'front',
      command: { kind: 'arrange', to: 'front' },
      keys: shortcutKeys('bring-front'),
      needsSelection: true,
    },
    {
      id: 'forward',
      command: { kind: 'arrange', to: 'forward' },
      keys: shortcutKeys('bring-forward'),
      needsSelection: true,
    },
    {
      id: 'backward',
      command: { kind: 'arrange', to: 'backward' },
      keys: shortcutKeys('send-backward'),
      needsSelection: true,
    },
    {
      id: 'back',
      command: { kind: 'arrange', to: 'back' },
      keys: shortcutKeys('send-back'),
      needsSelection: true,
    },
  ],
  [
    { id: 'selectAll', command: { kind: 'select-all' }, keys: shortcutKeys('select-all') },
    { id: 'unlockAll', command: { kind: 'unlock-all' }, keys: [] },
  ],
  [
    {
      id: 'remove',
      command: { kind: 'remove' },
      keys: shortcutKeys('remove'),
      needsSelection: true,
      destructive: true,
    },
  ],
];

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * Меню правой кнопки на холсте, как в Figma: буфер обмена, слои, выделить всё, удалить.
 * Пункты, которым нужно выделение, без него неактивны, а не спрятаны: место каждого пункта
 * в меню постоянно.
 */
export function CanvasMenuContent({
  hasSelection,
  canPaste,
  hasLocked,
  onCommand,
}: {
  hasSelection: boolean;
  canPaste: boolean;
  hasLocked: boolean;
  onCommand: (command: CanvasCommand) => void;
}) {
  const t = useTranslations('canvasMenu');
  const mac = isMac();

  return (
    <ContextMenuContent>
      {GROUPS.map((group, index) => (
        <div key={group[0]?.id ?? index} role="group">
          {index > 0 ? <ContextMenuSeparator /> : null}
          {group.map((entry) => (
            <ContextMenuItem
              key={entry.id}
              variant={entry.destructive ? 'destructive' : 'default'}
              disabled={
                (entry.needsSelection === true && !hasSelection) ||
                (entry.command.kind === 'paste' && !canPaste) ||
                (entry.command.kind === 'unlock-all' && !hasLocked)
              }
              onSelect={() => onCommand(entry.command)}
            >
              {t(entry.id)}
              {entry.keys.length > 0 ? (
                <ContextMenuShortcut>{shortcutLabel(entry.keys, mac)}</ContextMenuShortcut>
              ) : null}
            </ContextMenuItem>
          ))}
        </div>
      ))}
    </ContextMenuContent>
  );
}
