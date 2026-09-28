'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { isTypingTarget } from '@/components/editor/slide-navigation';
import { isMacPlatform } from '@/components/editor/editor-shortcuts';
import { isSettingsShortcut, withSettings, type SettingsSection } from '@/lib/settings-url';

/**
 * Открыть и закрыть окно настроек — через адрес (`?settings=`), чтобы на раздел можно было дать
 * ссылку. Адрес меняется `replaceState`: это не переход, полосы загрузки нет, страница не
 * перерисовывается, а Next видит новый параметр в `useSearchParams`. «Назад» после закрытия
 * уводит туда, откуда пришли, а не открывает окно снова.
 */
export function openSettings(section: SettingsSection = 'general'): void {
  window.history.replaceState(null, '', withSettings(window.location.href, section));
}

export function closeSettings(): void {
  window.history.replaceState(null, '', withSettings(window.location.href, null));
}

/**
 * Ctrl+, (⌘+,) в главном меню. В редакторе сочетание слушает его клавиатура (`editor-keymap.ts`)
 * — там свои правила, когда клавиши его, а когда полей и списков.
 */
export function useSettingsShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || !isSettingsShortcut(event)) return;
      // В поле запятая — часть текста; открытое окно держит клавиатуру у себя.
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof Element && event.target.closest('[role="dialog"]')) return;
      event.preventDefault();
      openSettings();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

const subscribeNothing = () => () => undefined;

/** ⌘ на Mac, Ctrl на остальных. На сервере — Ctrl, после гидратации — как у человека. */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribeNothing, isMacPlatform, () => false);
}
