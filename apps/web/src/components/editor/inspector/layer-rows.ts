import type { SlideElement } from '@lct/contracts';
import {
  layerElementIds,
  layerElements,
  layerTree,
  pickedLayers,
  type LayerNode,
} from '@lct/deck-ops';

/*
 * Строки панели слоёв. Порядок — как в Figma и PowerPoint: сверху то, что лежит поверх,
 * поэтому каждый уровень дерева идёт от последнего нарисованного к первому. Группы
 * раскрываются; раскрыта и любая группа, внутри которой что-то выделено, — иначе выделенное
 * было бы не видно.
 */

export interface LayerRow {
  /** Id объекта или группы: строку перетаскивают и выбирают по нему. */
  readonly id: string;
  readonly node: LayerNode;
  /** Глубина вложенности, от нуля. */
  readonly depth: number;
  /** Путь группы, в которой лежит строка: переставлять можно только среди её соседей. */
  readonly parent: readonly string[];
  /** Объекты под строкой: у объекта — он сам, у группы — все её объекты. */
  readonly elementIds: readonly string[];
  /** Заблокирован объект или все объекты группы. */
  readonly locked: boolean;
}

/** Группы, которые надо раскрыть, чтобы было видно выделенное внутри них. */
export function revealedGroups(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
): Set<string> {
  const picked = pickedLayers(layerTree(elements), new Set(selectedIds));
  return new Set(picked.flatMap((item) => item.parent));
}

/** Строки дерева сверху вниз; дети группы — только у раскрытой. */
export function layerRows(
  elements: readonly SlideElement[],
  expanded: ReadonlySet<string>,
): LayerRow[] {
  const walk = (nodes: readonly LayerNode[], depth: number, parent: readonly string[]) =>
    [...nodes].reverse().flatMap((node): LayerRow[] => {
      const members = layerElements([node]);
      const row: LayerRow = {
        id: node.id,
        node,
        depth,
        parent,
        elementIds: layerElementIds(node),
        locked: members.length > 0 && members.every((element) => element.locked === true),
      };
      if (node.kind === 'element' || !expanded.has(node.id)) return [row];
      return [row, ...walk(node.children, depth + 1, node.path)];
    });
  return walk(layerTree(elements), 0, []);
}

/** Выделение после щелчка по строке: как в списке файлов — Ctrl добавляет, Shift — диапазон. */
export function pickRows(
  rows: readonly LayerRow[],
  selectedIds: readonly string[],
  anchorId: string | null,
  rowId: string,
  modifiers: { readonly range: boolean; readonly toggle: boolean },
): string[] {
  const row = rows.find((item) => item.id === rowId);
  if (!row) return [...selectedIds];
  if (modifiers.range && anchorId !== null) {
    const from = rows.findIndex((item) => item.id === anchorId);
    const to = rows.indexOf(row);
    if (from >= 0) {
      const [start, end] = from <= to ? [from, to] : [to, from];
      return unique(rows.slice(start, end + 1).flatMap((item) => item.elementIds));
    }
  }
  if (modifiers.toggle) {
    const selected = new Set(selectedIds);
    const whole = row.elementIds.every((id) => selected.has(id));
    if (whole) return selectedIds.filter((id) => !row.elementIds.includes(id));
    return unique([...selectedIds, ...row.elementIds]);
  }
  return [...row.elementIds];
}

/** Первые слова текста — имя текстового слоя, как в Figma. Пустой текст — `null`. */
export function textSnippet(element: SlideElement, limit = 40): string | null {
  if (element.kind !== 'text') return null;
  const text = element.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
