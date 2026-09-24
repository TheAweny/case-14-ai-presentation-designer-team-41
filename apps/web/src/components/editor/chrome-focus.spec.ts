import { describe, expect, it } from 'vitest';
import { EDITOR_CHROME, isEditorChrome } from './chrome-focus';

/** Узел, у которого `closest` находит метку хрома или нет. */
function node(inChrome: boolean) {
  return {
    closest(selector: string) {
      return inChrome && selector === EDITOR_CHROME ? {} : null;
    },
  } as unknown as EventTarget;
}

describe('editor chrome', () => {
  it('tells the bar and its menus from the slide', () => {
    expect(isEditorChrome(node(true))).toBe(true);
    expect(isEditorChrome(node(false))).toBe(false);
  });

  it('is not chrome without an element to look up from', () => {
    expect(isEditorChrome(null)).toBe(false);
    expect(isEditorChrome({} as EventTarget)).toBe(false);
  });
});
