import { describe, expect, it } from 'vitest';
import {
  NOTES_HEIGHT,
  NOTES_PREFS_DEFAULT,
  clampNotesHeight,
  notesPreview,
  parseNotesPrefs,
} from './speaker-notes';

describe('speaker notes area', () => {
  it('keeps its height between a line and half the window', () => {
    expect(clampNotesHeight(10, 900)).toBe(NOTES_HEIGHT.min);
    expect(clampNotesHeight(200.4, 900)).toBe(200);
    expect(clampNotesHeight(800, 900)).toBe(450);
    expect(clampNotesHeight(Number.NaN, 900)).toBe(NOTES_HEIGHT.default);
    // Окно ниже двух минимумов: минимум всё равно остаётся.
    expect(clampNotesHeight(500, 100)).toBe(NOTES_HEIGHT.min);
  });

  it('reads what it remembered and falls back on anything broken', () => {
    expect(parseNotesPrefs('{"open":true,"height":180}')).toEqual({ open: true, height: 180 });
    expect(parseNotesPrefs('{"open":"yes","height":"tall"}')).toEqual(NOTES_PREFS_DEFAULT);
    expect(parseNotesPrefs('{"height":5}')).toEqual({ open: false, height: NOTES_HEIGHT.min });
    expect(parseNotesPrefs('not json')).toEqual(NOTES_PREFS_DEFAULT);
    expect(parseNotesPrefs(null)).toEqual(NOTES_PREFS_DEFAULT);
  });

  it('shows the first line with words in it when folded', () => {
    expect(notesPreview('\n  \n  Начать с выручки  \nПотом сроки')).toBe('Начать с выручки');
    expect(notesPreview(undefined)).toBe('');
    expect(notesPreview('   ')).toBe('');
  });
});
