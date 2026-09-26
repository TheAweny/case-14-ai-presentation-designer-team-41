/**
 * Реестр горячих клавиш редактора — один на всех: по нему `editorCommand` понимает клавишу,
 * шпаргалка рисует список, а кнопки и меню подписывают тултипы. Подписи не расходятся с тем,
 * что редактор слушает, потому что и то и другое берётся отсюда.
 *
 * Клавиша задаётся физической (`KeyboardEvent.code`), а не символом: Ctrl+B работает и в
 * русской раскладке, где та же клавиша печатает «и». `Mod` — Ctrl, на Mac — Cmd; редактор
 * принимает оба на любой системе.
 *
 * Выбор сочетаний — по привычкам Google Slides и PowerPoint там, где речь о тексте и слайдах,
 * и Figma там, где речь об объектах на холсте. Где они спорят, решает то, что в редакторе
 * слайдов нужнее: Ctrl+Shift+L — выравнивание влево (Google Slides), а блокировка — Alt+Shift+L
 * (Canva), а не Ctrl+Shift+L из Figma. Ctrl+L — выделение в контекст ассистента, как «Add to
 * chat» в Cursor: в редакторе слайдов оно ничем не занято, а браузер отдаёт его странице.
 */

/** Где работает сочетание: на холсте вне набора, в открытом наборе текста или везде. */
export type ShortcutScope = 'canvas' | 'text' | 'both';

export type ShortcutGroup = 'general' | 'slides' | 'objects' | 'text' | 'view';

/** Порядок групп в шпаргалке. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  'general',
  'slides',
  'objects',
  'text',
  'view',
];

export type ShortcutId =
  | 'shortcuts'
  | 'settings'
  | 'undo'
  | 'redo'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'slide-go'
  | 'slide-previous'
  | 'slide-next'
  | 'slide-first'
  | 'slide-last'
  | 'slide-new'
  | 'slide-duplicate'
  | 'select-all'
  | 'deselect'
  | 'select-next'
  | 'select-previous'
  | 'edit'
  | 'duplicate'
  | 'remove'
  | 'nudge'
  | 'nudge-large'
  | 'bring-forward'
  | 'send-backward'
  | 'bring-front'
  | 'send-back'
  | 'lock'
  | 'group'
  | 'ungroup'
  | 'flip-horizontal'
  | 'flip-vertical'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'align-left'
  | 'align-center'
  | 'align-right'
  | 'align-justify'
  | 'size-up'
  | 'size-down'
  | 'text-exit'
  | 'indent'
  | 'outdent'
  | 'type-to-edit'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-actual'
  | 'zoom-fit'
  | 'zoom-selection'
  | 'pan'
  | 'present'
  | 'present-current'
  | 'assistant-context';

/** Одно сочетание: физическая клавиша и модификаторы, которые должны быть нажаты ровно так. */
export interface Chord {
  readonly code: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
  /** Своя область у этого сочетания, если она уже, чем у всей записи. */
  readonly scope?: ShortcutScope;
  /** Запасное сочетание, которое слушается, но в подписях не показывается (цифры Numpad). */
  readonly hidden?: boolean;
  /** Как подписать клавишу, если не по `code`: «>» вместо точки у Ctrl+Shift+>. */
  readonly label?: string;
}

export interface ShortcutSpec {
  readonly id: ShortcutId;
  readonly group: ShortcutGroup;
  readonly scope: ShortcutScope;
  readonly chords: readonly Chord[];
  /** Подпись вместо сочетаний — когда их много, а смысл один: «Ctrl+1…9». */
  readonly display?: readonly (readonly string[])[];
  /**
   * Клавишу слушает не `editorCommand`: буфер обмена приходит событиями браузера, зум и рука —
   * у холста. В реестре такие записи ради подписей и шпаргалки.
   */
  readonly external?: boolean;
}

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/** Ctrl/Cmd+цифра: верхний ряд и цифровой блок. Chrome и Firefox отдают их странице. */
const SLIDE_DIGITS: readonly Chord[] = [
  ...DIGITS.map((digit): Chord => ({ code: `Digit${digit}`, mod: true })),
  ...DIGITS.map((digit): Chord => ({ code: `Numpad${digit}`, mod: true, hidden: true })),
];

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] as const;

export const SHORTCUTS: readonly ShortcutSpec[] = [
  // Общее.
  {
    id: 'shortcuts',
    group: 'general',
    scope: 'both',
    chords: [
      { code: 'Slash', mod: true },
      // «?» печатается в тексте, поэтому в наборе шпаргалку открывает только Ctrl+/.
      { code: 'Slash', shift: true, scope: 'canvas', label: '?' },
    ],
  },
  // Настройки — Ctrl+, как почти везде. Не в наборе: там запятая — часть текста.
  { id: 'settings', group: 'general', scope: 'canvas', chords: [{ code: 'Comma', mod: true }] },
  { id: 'undo', group: 'general', scope: 'canvas', chords: [{ code: 'KeyZ', mod: true }] },
  {
    id: 'redo',
    group: 'general',
    scope: 'canvas',
    chords: [
      { code: 'KeyZ', mod: true, shift: true },
      { code: 'KeyY', mod: true },
    ],
  },
  {
    id: 'copy',
    group: 'general',
    scope: 'canvas',
    external: true,
    chords: [{ code: 'KeyC', mod: true }],
  },
  {
    id: 'cut',
    group: 'general',
    scope: 'canvas',
    external: true,
    chords: [{ code: 'KeyX', mod: true }],
  },
  {
    id: 'paste',
    group: 'general',
    scope: 'canvas',
    external: true,
    chords: [{ code: 'KeyV', mod: true }],
  },
  {
    id: 'assistant-context',
    group: 'general',
    scope: 'canvas',
    chords: [{ code: 'KeyL', mod: true }],
  },

  // Слайды.
  {
    id: 'slide-go',
    group: 'slides',
    scope: 'canvas',
    chords: SLIDE_DIGITS,
    display: [['Mod', '1…9']],
  },
  { id: 'slide-previous', group: 'slides', scope: 'canvas', chords: [{ code: 'PageUp' }] },
  { id: 'slide-next', group: 'slides', scope: 'canvas', chords: [{ code: 'PageDown' }] },
  { id: 'slide-first', group: 'slides', scope: 'canvas', chords: [{ code: 'Home' }] },
  { id: 'slide-last', group: 'slides', scope: 'canvas', chords: [{ code: 'End' }] },
  {
    id: 'slide-new',
    group: 'slides',
    scope: 'canvas',
    chords: [
      { code: 'KeyM', mod: true },
      { code: 'Enter', mod: true },
      { code: 'NumpadEnter', mod: true, hidden: true },
    ],
  },
  {
    id: 'slide-duplicate',
    group: 'slides',
    scope: 'canvas',
    chords: [{ code: 'KeyD', mod: true, shift: true }],
  },

  // Объекты.
  { id: 'select-all', group: 'objects', scope: 'canvas', chords: [{ code: 'KeyA', mod: true }] },
  { id: 'deselect', group: 'objects', scope: 'canvas', chords: [{ code: 'Escape' }] },
  { id: 'select-next', group: 'objects', scope: 'canvas', chords: [{ code: 'Tab' }] },
  {
    id: 'select-previous',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'Tab', shift: true }],
  },
  {
    id: 'edit',
    group: 'objects',
    scope: 'canvas',
    // F2 — как в PowerPoint.
    chords: [{ code: 'Enter' }, { code: 'F2' }, { code: 'NumpadEnter', hidden: true }],
  },
  {
    // Буква или цифра на выделенном тексте открывает набор и печатается в конец, как в
    // Google Slides. Слушает холст: печатный символ — не сочетание, а буквы инструментов рейки
    // при выделенном тексте уступают набору.
    id: 'type-to-edit',
    group: 'objects',
    scope: 'canvas',
    external: true,
    chords: [],
    display: [['A…Z']],
  },
  { id: 'duplicate', group: 'objects', scope: 'canvas', chords: [{ code: 'KeyD', mod: true }] },
  {
    id: 'remove',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'Delete' }, { code: 'Backspace' }],
  },
  {
    id: 'nudge',
    group: 'objects',
    scope: 'canvas',
    chords: ARROWS.map((code): Chord => ({ code })),
    display: [['←↑→↓']],
  },
  {
    id: 'nudge-large',
    group: 'objects',
    scope: 'canvas',
    chords: ARROWS.map((code): Chord => ({ code, shift: true })),
    display: [['Shift', '←↑→↓']],
  },
  {
    id: 'bring-forward',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'BracketRight', mod: true }],
  },
  {
    id: 'send-backward',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'BracketLeft', mod: true }],
  },
  {
    id: 'bring-front',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'BracketRight', mod: true, shift: true }],
  },
  {
    id: 'send-back',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'BracketLeft', mod: true, shift: true }],
  },
  {
    id: 'lock',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'KeyL', alt: true, shift: true }],
  },
  // Группы — как в Figma, Google Slides и PowerPoint.
  { id: 'group', group: 'objects', scope: 'canvas', chords: [{ code: 'KeyG', mod: true }] },
  {
    id: 'ungroup',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'KeyG', mod: true, shift: true }],
  },
  {
    id: 'flip-horizontal',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'KeyH', shift: true }],
  },
  {
    id: 'flip-vertical',
    group: 'objects',
    scope: 'canvas',
    chords: [{ code: 'KeyV', shift: true }],
  },

  // Текст: в наборе — на выделенных словах и абзацах, без набора — на всех выделенных текстах.
  { id: 'bold', group: 'text', scope: 'both', chords: [{ code: 'KeyB', mod: true }] },
  { id: 'italic', group: 'text', scope: 'both', chords: [{ code: 'KeyI', mod: true }] },
  { id: 'underline', group: 'text', scope: 'both', chords: [{ code: 'KeyU', mod: true }] },
  {
    id: 'align-left',
    group: 'text',
    scope: 'both',
    chords: [{ code: 'KeyL', mod: true, shift: true }],
  },
  {
    id: 'align-center',
    group: 'text',
    scope: 'both',
    chords: [{ code: 'KeyE', mod: true, shift: true }],
  },
  {
    id: 'align-right',
    group: 'text',
    scope: 'both',
    chords: [{ code: 'KeyR', mod: true, shift: true }],
  },
  {
    id: 'align-justify',
    group: 'text',
    scope: 'both',
    chords: [{ code: 'KeyJ', mod: true, shift: true }],
  },
  {
    id: 'size-up',
    group: 'text',
    scope: 'both',
    chords: [{ code: 'Period', mod: true, shift: true, label: '>' }],
  },
  {
    id: 'size-down',
    group: 'text',
    scope: 'both',
    chords: [{ code: 'Comma', mod: true, shift: true, label: '<' }],
  },
  { id: 'text-exit', group: 'text', scope: 'text', chords: [{ code: 'Escape' }] },
  // Уровень пункта списка, как в Google Slides и PowerPoint. На холсте Tab — обход объектов.
  { id: 'indent', group: 'text', scope: 'text', chords: [{ code: 'Tab' }] },
  { id: 'outdent', group: 'text', scope: 'text', chords: [{ code: 'Tab', shift: true }] },

  // Вид: слушает холст, здесь — подписи.
  {
    id: 'zoom-in',
    group: 'view',
    scope: 'both',
    external: true,
    chords: [{ code: 'Equal', mod: true, label: '+' }],
  },
  {
    id: 'zoom-out',
    group: 'view',
    scope: 'both',
    external: true,
    chords: [{ code: 'Minus', mod: true, label: '−' }],
  },
  {
    id: 'zoom-actual',
    group: 'view',
    scope: 'both',
    external: true,
    chords: [{ code: 'Digit0', mod: true }],
  },
  {
    id: 'zoom-fit',
    group: 'view',
    scope: 'canvas',
    external: true,
    chords: [{ code: 'Digit1', shift: true }],
  },
  {
    id: 'zoom-selection',
    group: 'view',
    scope: 'canvas',
    external: true,
    chords: [{ code: 'Digit2', shift: true }],
  },
  {
    id: 'pan',
    group: 'view',
    scope: 'canvas',
    external: true,
    chords: [{ code: 'Space' }],
  },
  // Показ — как в PowerPoint: F5 с начала, Shift+F5 с текущего слайда. Работает и в наборе:
  // иначе F5 перезагрузил бы страницу.
  { id: 'present', group: 'view', scope: 'both', chords: [{ code: 'F5' }] },
  {
    id: 'present-current',
    group: 'view',
    scope: 'both',
    chords: [{ code: 'F5', shift: true }],
  },
];

/**
 * Жесты мышью с модификаторами. Их слушают ручки и холст (`slide-handles.tsx`,
 * `use-canvas-navigation.ts`), а не `editorCommand`: здесь они ради шпаргалки, рядом с
 * клавишами, чтобы подписи жили в одном месте.
 */
export type GestureAction =
  'drag' | 'resize' | 'rotate' | 'click' | 'double-click-field' | 'middle-drag';

export type GestureId =
  | 'drag-copy'
  | 'drag-axis'
  | 'resize-ratio'
  | 'rotate-step'
  | 'resize-center'
  | 'click-through'
  | 'drag-free'
  | 'pan-drag'
  | 'fit-field';

/** Один вариант жеста: клавиши (как в `Chord` — `Mod`, `Shift`, `Alt`, `Space`) и действие. */
export interface GestureVariant {
  readonly keys: readonly string[];
  readonly action: GestureAction;
}

export interface GestureSpec {
  readonly id: GestureId;
  readonly variants: readonly GestureVariant[];
}

export const GESTURES: readonly GestureSpec[] = [
  // Figma, Keynote и Canva: Alt/Option при перетаскивании оставляет оригинал на месте.
  { id: 'drag-copy', variants: [{ keys: ['Alt'], action: 'drag' }] },
  { id: 'drag-axis', variants: [{ keys: ['Shift'], action: 'drag' }] },
  { id: 'resize-ratio', variants: [{ keys: ['Shift'], action: 'resize' }] },
  { id: 'rotate-step', variants: [{ keys: ['Shift'], action: 'rotate' }] },
  { id: 'resize-center', variants: [{ keys: ['Alt'], action: 'resize' }] },
  { id: 'click-through', variants: [{ keys: ['Mod'], action: 'click' }] },
  {
    id: 'drag-free',
    variants: [
      { keys: ['Mod'], action: 'drag' },
      { keys: ['Mod'], action: 'resize' },
    ],
  },
  {
    id: 'pan-drag',
    variants: [
      { keys: [], action: 'middle-drag' },
      { keys: ['Space'], action: 'drag' },
    ],
  },
  { id: 'fit-field', variants: [{ keys: [], action: 'double-click-field' }] },
];

const BY_ID = new Map(SHORTCUTS.map((spec) => [spec.id, spec]));

export function shortcutSpec(id: ShortcutId): ShortcutSpec {
  const spec = BY_ID.get(id);
  if (!spec) throw new Error(`Unknown shortcut: ${id}`);
  return spec;
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  BracketLeft: '[',
  BracketRight: ']',
  Period: '.',
  Comma: ',',
  Slash: '/',
  Equal: '=',
  Minus: '-',
  Escape: 'Esc',
  Delete: 'Del',
  Backspace: '⌫',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Space: 'Space',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Home: 'Home',
  End: 'End',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** Подпись физической клавиши: `KeyB` → `B`, `Digit1` → `1`, `BracketLeft` → `[`. */
export function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1]) return letter[1];
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit?.[1]) return digit[1];
  return KEY_LABELS[code] ?? code;
}

/** Части сочетания для `shortcutLabel`: `['Mod', 'Shift', 'L']`. */
export function chordKeys(chord: Chord): readonly string[] {
  const keys: string[] = [];
  if (chord.mod) keys.push('Mod');
  if (chord.alt) keys.push('Alt');
  // «?» — это уже Shift+/, второй раз Shift не пишем.
  if (chord.shift && chord.label !== '?') keys.push('Shift');
  keys.push(chord.label ?? keyLabel(chord.code));
  return keys;
}

/** Все подписи записи — для шпаргалки: по одной на каждое видимое сочетание. */
export function shortcutDisplays(id: ShortcutId): readonly (readonly string[])[] {
  const spec = shortcutSpec(id);
  if (spec.display) return spec.display;
  return spec.chords.filter((chord) => !chord.hidden).map(chordKeys);
}

/** Главное сочетание команды — для тултипа и меню: `shortcutLabel(shortcutKeys('lock'), mac)`. */
export function shortcutKeys(id: ShortcutId): readonly string[] {
  return shortcutDisplays(id)[0] ?? [];
}

/** Подпись сочетания для меню: ⌘ на Mac, Ctrl на остальных. */
export function shortcutLabel(keys: readonly string[], mac: boolean): string {
  return keys
    .map((key) => {
      if (key === 'Mod') return mac ? '⌘' : 'Ctrl';
      if (key === 'Shift') return mac ? '⇧' : 'Shift';
      if (key === 'Alt') return mac ? '⌥' : 'Alt';
      return key;
    })
    .join(mac ? '' : '+');
}

/** Главное сочетание команды готовой строкой: `shortcutText('bold', false)` → `Ctrl+B`. */
export function shortcutText(id: ShortcutId, mac: boolean): string {
  return shortcutLabel(shortcutKeys(id), mac);
}

const ARIA_KEYS: Readonly<Record<string, string>> = {
  Escape: 'Escape',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Enter: 'Enter',
  Tab: 'Tab',
  Space: 'Space',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
};

/**
 * Значение `aria-keyshortcuts`: главное сочетание в обоих вариантах, Ctrl и Cmd, —
 * `Control+B Meta+B`.
 */
export function ariaKeyShortcuts(id: ShortcutId): string {
  const chord = shortcutSpec(id).chords.find((item) => !item.hidden);
  if (!chord) return '';
  const key = ARIA_KEYS[chord.code] ?? chord.label ?? keyLabel(chord.code);
  const tail = [chord.alt ? 'Alt' : null, chord.shift && chord.label !== '?' ? 'Shift' : null, key]
    .filter((part): part is string => part !== null)
    .join('+');
  return chord.mod ? `Control+${tail} Meta+${tail}` : tail;
}

/** Mac ли это: там подписи — символами ⌘⇧⌥. */
export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}
