import { slideElementSchema, type Box, type Paragraph, type SlideElement } from '@lct/contracts';

/**
 * Свой тип данных в буфере обмена: объекты слайда как есть, со стилем и рамкой. Рядом кладётся
 * обычный текст, чтобы копия текста из слайда вставлялась и в другие программы.
 */
export const ELEMENTS_MIME = 'application/x-lct-slide-elements';

interface Payload {
  readonly version: 1;
  readonly elements: readonly SlideElement[];
}

export function serializeElements(elements: readonly SlideElement[]): string {
  const payload: Payload = { version: 1, elements };
  return JSON.stringify(payload);
}

/**
 * Объекты из буфера. Всё, что не проходит схему SlideIR, отбрасывается целиком: полу-вставка
 * хуже, чем никакой.
 */
export function parseElements(text: string): SlideElement[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { version, elements } = data as { version?: unknown; elements?: unknown };
  if (version !== 1 || !Array.isArray(elements) || elements.length === 0) return null;
  const parsed: SlideElement[] = [];
  for (const element of elements) {
    const result = slideElementSchema.safeParse(element);
    if (!result.success) return null;
    parsed.push(result.data);
  }
  return parsed;
}

/** Текст скопированных объектов для других программ: абзацы по строкам, объекты через пустую. */
export function plainTextOf(elements: readonly SlideElement[]): string {
  return elements
    .flatMap((element) => {
      if (element.kind === 'text') {
        return [element.paragraphs.map((p) => p.runs.map((run) => run.text).join('')).join('\n')];
      }
      if (element.kind === 'table') {
        return [[element.headers, ...element.rows].map((row) => row.join('\t')).join('\n')];
      }
      return [];
    })
    .filter((text) => text.trim() !== '')
    .join('\n\n');
}

function sameBox(a: Box, b: Box): boolean {
  return a.x === b.x && a.y === b.y && a.cx === b.cx && a.cy === b.cy;
}

/**
 * Куда сдвинуть вставку. На другой слайд объект ложится на то же место, как в Figma; поверх
 * самого себя — лесенкой на шаг, пока не найдётся свободное место.
 */
export function pasteOffset(
  existing: readonly SlideElement[],
  pasted: readonly SlideElement[],
  step: number,
): { x: number; y: number } {
  const size = Math.max(1, step);
  for (let n = 0; n < 50; n += 1) {
    const dx = n * size;
    const collides = pasted.some((element) =>
      existing.some((other) =>
        sameBox(other.box, { ...element.box, x: element.box.x + dx, y: element.box.y + dx }),
      ),
    );
    if (!collides) return { x: dx, y: dx };
  }
  return { x: 0, y: 0 };
}

/** Абзацы из простого текста: строка — абзац, стиль наследуется от роли. */
export function paragraphsOf(text: string): Paragraph[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  return lines.map((line) => ({
    level: 0,
    runs: [{ text: line, font: '', sizePt: null, bold: null, italic: null, color: '' }],
  }));
}
