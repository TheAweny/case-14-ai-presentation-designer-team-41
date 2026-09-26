import { describe, expect, it } from 'vitest';
import {
  EDITOR_LAYOUT_DEFAULT,
  INSPECTOR_WIDTH,
  SLIDES_WIDTH,
  parseEditorLayout,
  serializeEditorLayout,
} from './editor-layout';

describe('parseEditorLayout', () => {
  it('без cookie отдаёт раскладку по умолчанию', () => {
    expect(parseEditorLayout(undefined)).toEqual(EDITOR_LAYOUT_DEFAULT);
    expect(parseEditorLayout('')).toEqual(EDITOR_LAYOUT_DEFAULT);
  });

  it('читает своё же значение', () => {
    const layout = {
      slides: 300,
      inspector: 320,
      dock: { kind: 'free', side: 'bottom', x: 0.25, y: 0.75 },
    } as const;
    expect(parseEditorLayout(serializeEditorLayout(layout))).toEqual(layout);
  });

  it('читает и уже раскодированное значение', () => {
    expect(
      parseEditorLayout('{"slides":200,"inspector":260,"dock":{"kind":"zone","side":"top"}}'),
    ).toEqual({ slides: 200, inspector: 260, dock: { kind: 'zone', side: 'top' } });
  });

  it('держит ширины в границах и округляет их', () => {
    const layout = parseEditorLayout('{"slides":40,"inspector":9000.4}');
    expect(layout.slides).toBe(SLIDES_WIDTH.min);
    expect(layout.inspector).toBe(INSPECTOR_WIDTH.max);
    expect(parseEditorLayout('{"slides":250.6}').slides).toBe(251);
  });

  it('возвращает к умолчанию только испорченное поле', () => {
    const layout = parseEditorLayout('{"slides":"wide","inspector":300,"dock":{"kind":"x"}}');
    expect(layout).toEqual({
      slides: SLIDES_WIDTH.default,
      inspector: 300,
      dock: EDITOR_LAYOUT_DEFAULT.dock,
    });
  });

  it('не верит мусору', () => {
    expect(parseEditorLayout('не json')).toEqual(EDITOR_LAYOUT_DEFAULT);
    expect(parseEditorLayout('%E0%A4%A')).toEqual(EDITOR_LAYOUT_DEFAULT);
    expect(parseEditorLayout('42')).toEqual(EDITOR_LAYOUT_DEFAULT);
  });
});

describe('serializeEditorLayout', () => {
  it('кодирует значение под допустимые в cookie символы', () => {
    const value = serializeEditorLayout(EDITOR_LAYOUT_DEFAULT);
    expect(value).not.toMatch(/[\s",;\\]/);
  });
});
