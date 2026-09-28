/**
 * Правила поля запроса — одни для главной, чата колоды и панели редактора. Модуль без React:
 * поведение клавиш и кнопки проверяется тестами.
 */

/** Что делает круглая кнопка поля. */
export type PromptAction =
  /** Отправить текст. */
  | 'send'
  /** Остановить идущую сборку. */
  | 'stop'
  /** Отправка уже ушла, ждём перехода: кнопка крутится и не нажимается. */
  | 'sending';

export interface PromptActionState {
  readonly action: PromptAction;
  readonly disabled: boolean;
}

/**
 * Кнопка поля. Пока идёт сборка и поле пустое — это «Стоп». Начали печатать — снова «Отправить»:
 * пожелание сменит идущую сборку, а набранный текст не пропадёт. `blocked` — отправлять нельзя по
 * причине, которую объясняет подсказка (например, не выбран шаблон).
 */
export function promptAction({
  hasInput,
  running = false,
  sending = false,
  blocked = false,
}: {
  hasInput: boolean;
  running?: boolean;
  sending?: boolean;
  blocked?: boolean;
}): PromptActionState {
  if (sending) return { action: 'sending', disabled: true };
  if (running && !hasInput) return { action: 'stop', disabled: false };
  return { action: 'send', disabled: !hasInput || blocked };
}

/**
 * Enter отправляет, Shift+Enter — новая строка. Пока идёт набор через IME (китайский, японский),
 * Enter подтверждает иероглиф и не отправляет. Ctrl/⌘+Enter тоже отправляет — по привычке.
 */
export function isSubmitKey(event: {
  readonly key: string;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing: boolean;
}): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.isComposing;
}
