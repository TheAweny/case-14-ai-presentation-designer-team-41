'use client';

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  EDITOR_PREFS_DEFAULT,
  shortcutOverrides,
  writeEditorPrefs,
  type EditorPrefs,
} from './editor-prefs';
import { setShortcutOverrides } from './editor-shortcuts';

type EditorPrefsValue = {
  prefs: EditorPrefs;
  update: (patch: Partial<EditorPrefs>) => void;
  /**
   * Растёт, когда реестр клавиш принял свои сочетания. Значение контекста меняется, и все, кто
   * читает настройки (рейка, полоса), перерисовывают подписи клавиш по новому реестру.
   */
  shortcutsVersion: number;
};

const EditorPrefsContext = createContext<EditorPrefsValue>({
  prefs: EDITOR_PREFS_DEFAULT,
  update: () => undefined,
  shortcutsVersion: 0,
});

/**
 * Настройки редактора на всё приложение. Стоит в корневом макете: окно настроек и открытый
 * редактор видят одно значение, и переключатель в окне сразу меняет рейку и полосу за ним.
 * `initial` сервер прочитал из cookie — первый кадр уже по настройкам.
 */
export function EditorPrefsProvider({
  initial,
  children,
}: {
  initial: EditorPrefs;
  children: ReactNode;
}) {
  const [prefs, setPrefs] = useState(initial);
  const update = useCallback((patch: Partial<EditorPrefs>) => {
    setPrefs((previous) => {
      const next = { ...previous, ...patch };
      writeEditorPrefs(next);
      return next;
    });
  }, []);
  // Свои сочетания живут в реестре модуля, а он на сервере общий для всех запросов, — поэтому
  // только в браузере и после гидратации: первый кадр совпадает с серверным.
  const [shortcutsVersion, setShortcutsVersion] = useState(0);
  const { shortcuts } = prefs;
  useLayoutEffect(() => {
    setShortcutOverrides(shortcutOverrides(shortcuts));
    setShortcutsVersion((version) => version + 1);
  }, [shortcuts]);
  const value = useMemo(
    () => ({ prefs, update, shortcutsVersion }),
    [prefs, update, shortcutsVersion],
  );
  return <EditorPrefsContext.Provider value={value}>{children}</EditorPrefsContext.Provider>;
}

export function useEditorPrefs(): EditorPrefs {
  return useContext(EditorPrefsContext).prefs;
}

export function useUpdateEditorPrefs(): EditorPrefsValue['update'] {
  return useContext(EditorPrefsContext).update;
}
