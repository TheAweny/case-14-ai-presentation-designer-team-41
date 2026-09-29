'use client';

import { createContext, useContext } from 'react';

/**
 * Чат, в котором собрана открытая колода: из редактора в него ведёт кнопка «К чату». null —
 * колода собрана без чата или он ещё не загружен.
 */
export const EditorChatContext = createContext<string | null>(null);

export function useEditorChat(): string | null {
  return useContext(EditorChatContext);
}
