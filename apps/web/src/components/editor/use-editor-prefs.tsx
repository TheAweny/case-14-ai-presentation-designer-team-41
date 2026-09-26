'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { EDITOR_PREFS_DEFAULT, writeEditorPrefs, type EditorPrefs } from './editor-prefs';

type EditorPrefsValue = {
  prefs: EditorPrefs;
  update: (patch: Partial<EditorPrefs>) => void;
};

const EditorPrefsContext = createContext<EditorPrefsValue>({
  prefs: EDITOR_PREFS_DEFAULT,
  update: () => undefined,
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
  const value = useMemo(() => ({ prefs, update }), [prefs, update]);
  return <EditorPrefsContext.Provider value={value}>{children}</EditorPrefsContext.Provider>;
}

export function useEditorPrefs(): EditorPrefs {
  return useContext(EditorPrefsContext).prefs;
}

export function useUpdateEditorPrefs(): EditorPrefsValue['update'] {
  return useContext(EditorPrefsContext).update;
}
