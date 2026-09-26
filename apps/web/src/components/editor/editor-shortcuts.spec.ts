import { afterEach, describe, expect, it } from 'vitest';
import { editorCommand, type KeyContext } from './editor-keymap';
import en from '../../i18n/messages/en';
import ru from '../../i18n/messages/ru';
import {
  GESTURES,
  REMAPPABLE_SHORTCUTS,
  SHORTCUTS,
  ariaKeyShortcuts,
  chordOwner,
  chordProblem,
  decodeChord,
  encodeChord,
  setShortcutOverrides,
  chordKeys,
  keyLabel,
  shortcutKeys,
  shortcutText,
  type Chord,
  type ShortcutScope,
} from './editor-shortcuts';

function eventOf(chord: Chord) {
  return {
    code: chord.code,
    key: chord.code,
    ctrlKey: chord.mod === true,
    metaKey: false,
    shiftKey: chord.shift === true,
    altKey: chord.alt === true,
  };
}

function contexts(scope: ShortcutScope): KeyContext[] {
  return scope === 'both' ? ['canvas', 'text'] : [scope];
}

describe('shortcut registry', () => {
  it('has unique ids', () => {
    const ids = SHORTCUTS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never gives one chord two meanings in the same place', () => {
    const seen = new Map<string, string>();
    for (const spec of SHORTCUTS) {
      for (const chord of spec.chords) {
        for (const context of contexts(chord.scope ?? spec.scope)) {
          const id = `${context}:${chordKeys(chord).join('+')}:${chord.code}`;
          expect(seen.get(id) ?? spec.id, id).toBe(spec.id);
          seen.set(id, spec.id);
        }
      }
    }
  });

  it('is what the keymap listens to: every chord it owns becomes a command', () => {
    for (const spec of SHORTCUTS) {
      for (const chord of spec.chords) {
        for (const context of contexts(chord.scope ?? spec.scope)) {
          const command = editorCommand(eventOf(chord), context);
          if (spec.external) expect(command, spec.id).toBeNull();
          else expect(command, `${spec.id} in ${context}`).not.toBeNull();
        }
      }
    }
  });
});

describe('shortcut labels', () => {
  it('names physical keys', () => {
    expect(keyLabel('KeyB')).toBe('B');
    expect(keyLabel('Digit7')).toBe('7');
    expect(keyLabel('BracketRight')).toBe(']');
    expect(keyLabel('PageDown')).toBe('PgDn');
  });

  it('gives tooltips the same keys the editor listens to', () => {
    expect(shortcutKeys('bold')).toEqual(['Mod', 'B']);
    expect(shortcutKeys('lock')).toEqual(['Alt', 'Shift', 'L']);
    expect(shortcutKeys('size-up')).toEqual(['Mod', 'Shift', '>']);
    expect(shortcutKeys('slide-go')).toEqual(['Mod', '1…9']);
    expect(shortcutKeys('shortcuts')).toEqual(['Mod', '/']);
    expect(shortcutText('align-left', false)).toBe('Ctrl+Shift+L');
    expect(shortcutText('lock', true)).toBe('⌥⇧L');
    expect(shortcutText('duplicate', true)).toBe('⌘D');
  });

  it('writes aria-keyshortcuts for both Ctrl and Cmd', () => {
    expect(ariaKeyShortcuts('bold')).toBe('Control+B Meta+B');
    expect(ariaKeyShortcuts('lock')).toBe('Alt+Shift+L');
    expect(ariaKeyShortcuts('remove')).toBe('Delete');
  });
});

describe('mouse gestures', () => {
  it('has unique ids and at least one way to do each', () => {
    const ids = GESTURES.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const spec of GESTURES) expect(spec.variants.length, spec.id).toBeGreaterThan(0);
  });

  it('holds only modifier keys, the action is its own word', () => {
    for (const spec of GESTURES) {
      for (const variant of spec.variants) {
        for (const key of variant.keys) expect(['Mod', 'Shift', 'Alt', 'Space']).toContain(key);
      }
    }
  });

  it('has a label for every gesture and action in both languages', () => {
    for (const [locale, dictionary] of Object.entries({ ru, en })) {
      const { gestures, groups } = dictionary.shortcuts;
      expect(groups.gestures, locale).toBeTruthy();
      for (const spec of GESTURES) {
        expect(gestures.items[spec.id], `${locale}: ${spec.id}`).toBeTruthy();
        for (const variant of spec.variants) {
          expect(gestures.actions[variant.action], `${locale}: ${variant.action}`).toBeTruthy();
        }
      }
    }
  });
});

describe('own shortcuts', () => {
  afterEach(() => setShortcutOverrides({}));

  it('replaces the chord of a command and can leave it unassigned', () => {
    setShortcutOverrides({ lock: { code: 'KeyK', mod: true, alt: true }, group: null });
    expect(shortcutKeys('lock')).toEqual(['Mod', 'Alt', 'K']);
    expect(shortcutKeys('group')).toEqual([]);
    expect(
      editorCommand({
        code: 'KeyK',
        key: 'k',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: true,
      }),
    ).toEqual({ kind: 'lock' });
    expect(
      editorCommand({
        code: 'KeyG',
        key: 'g',
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  it('round-trips chords and refuses the ones a person cannot use', () => {
    expect(decodeChord(encodeChord({ code: 'KeyL', mod: true, shift: true }))).toEqual({
      code: 'KeyL',
      mod: true,
      shift: true,
    });
    expect(chordProblem({ code: 'KeyQ' })).toBe('needs-modifier');
    expect(chordProblem({ code: 'F2' })).toBeNull();
    expect(chordProblem({ code: 'KeyW', mod: true })).toBe('reserved');
    expect(chordProblem({ code: 'ShiftLeft', shift: true })).toBe('modifier');
    expect(decodeChord('Hyper+KeyA')).toBeNull();
  });

  it('finds the command that already listens to a chord', () => {
    expect(chordOwner({ code: 'KeyD', mod: true }, 'lock')).toBe('duplicate');
    expect(chordOwner({ code: 'KeyK', mod: true, alt: true }, 'lock')).toBeNull();
  });

  it('keeps clipboard, zoom and key families out of remapping', () => {
    const ids = REMAPPABLE_SHORTCUTS.map((spec) => spec.id);
    expect(ids).toContain('lock');
    for (const id of ['copy', 'zoom-in', 'nudge', 'slide-go', 'indent', 'settings']) {
      expect(ids).not.toContain(id);
    }
  });
});
