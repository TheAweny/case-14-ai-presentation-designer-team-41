import { describe, expect, it } from 'vitest';
import {
  EDITOR_PREFS_DEFAULT,
  parseEditorPrefs,
  serializeEditorPrefs,
  type EditorPrefs,
} from './editor-prefs';

describe('parseEditorPrefs', () => {
  it('falls back to defaults without a cookie or with a broken one', () => {
    expect(parseEditorPrefs(undefined)).toEqual(EDITOR_PREFS_DEFAULT);
    expect(parseEditorPrefs('not json')).toEqual(EDITOR_PREFS_DEFAULT);
    expect(parseEditorPrefs('42')).toEqual(EDITOR_PREFS_DEFAULT);
  });

  it('round-trips what it serializes', () => {
    const prefs: EditorPrefs = {
      railHidden: ['data', 'present'],
      keepTool: true,
      selectionBar: 'off',
      barAssistant: false,
      snap: false,
      wheel: 'zoom',
      largeNudge: 8,
      lockTemplate: false,
    };
    expect(parseEditorPrefs(serializeEditorPrefs(prefs))).toEqual(prefs);
  });

  it('resets only the fields that are broken or unknown', () => {
    const raw = JSON.stringify({
      railHidden: ['present', 'pointer', 'data', 'data'],
      keepTool: 'yes',
      selectionBar: 'floating',
      wheel: 'zoom',
      largeNudge: 5,
    });
    expect(parseEditorPrefs(raw)).toEqual({
      ...EDITOR_PREFS_DEFAULT,
      railHidden: ['data', 'present'],
      wheel: 'zoom',
    });
  });
});
