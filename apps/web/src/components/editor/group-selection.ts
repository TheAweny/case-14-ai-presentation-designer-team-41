import type { Box, SlideElement } from '@lct/contracts';
import {
  commonPath,
  groupPath,
  layerElementIds,
  layerElements,
  layerTree,
  layersAt,
  pickedLayers,
  type LayerNode,
} from '@lct/deck-ops';
import { alignBoxes, unionBox, type Alignment } from './slide-geometry';
import type { ElementMove } from './use-deck-history';

/*
 * Выделение с группами — как в Figma. Щелчок по объекту группы выделяет всю группу, двойной
 * щелчок входит в неё и выделяет объект под курсором; пока выделено что-то внутри группы,
 * щелчки выбирают её соседей, а щелчок мимо группы из неё выходит. Esc поднимается на уровень
 * вверх.
 *
 * Уровень, на котором сейчас выбирают, отдельно не хранится: он следует из самого выделения.
 * Выделена группа целиком — выбираем среди её соседей; выделен объект внутри группы — среди
 * объектов этой группы. Поэтому отмена, панель слоёв и клавиатура не могут рассинхронизировать
 * «куда вошли» с тем, что выделено.
 */

/** Путь группы, внутри которой сейчас выбирают. Пустой — верхний уровень слайда. */
export function selectionScope(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
): readonly string[] {
  const picked = pickedLayers(layerTree(elements), new Set(selectedIds));
  return commonPath(picked.map((item) => item.parent));
}

function startsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((id, index) => path[index] === id);
}

/** Все объекты под группой с этим путём. */
function membersOf(elements: readonly SlideElement[], path: readonly string[]): string[] {
  return elements
    .filter((element) => startsWith(groupPath(element), path))
    .map((element) => element.elementId);
}

/**
 * Что выбирает щелчок по объекту на уровне `scope`: сам объект, если он лежит прямо в этой
 * группе, иначе — её дочернюю группу, в которой он лежит. Объект вне `scope` выбирается с
 * верхнего уровня: щелчок мимо группы из неё выходит.
 */
export function unitOf(
  elements: readonly SlideElement[],
  elementId: string,
  scope: readonly string[] = [],
): string[] {
  const element = elements.find((item) => item.elementId === elementId);
  if (!element) return [];
  const path = groupPath(element);
  const level = startsWith(path, scope) ? scope.length : 0;
  if (path.length <= level) return [elementId];
  return membersOf(elements, path.slice(0, level + 1));
}

/**
 * Выделение после щелчка или рамки. `next` — что отдала рамка выделения (объекты, а не
 * группы). Без Shift каждый объект разворачивается в то, что щелчок по нему выбирает. С
 * Shift добавленное добавляется целиком, а снятый объект снимает всё, что выбирал бы он.
 */
export function resolvePick(
  elements: readonly SlideElement[],
  previous: readonly string[],
  next: readonly string[],
  additive: boolean,
): string[] {
  const scope = selectionScope(elements, previous);
  const expand = (ids: readonly string[]) => ids.flatMap((id) => unitOf(elements, id, scope));
  if (!additive) return unique(expand(next));
  const before = new Set(previous);
  const after = new Set(next);
  const removed = new Set(expand(previous.filter((id) => !after.has(id))));
  const added = expand(next.filter((id) => !before.has(id)));
  return unique([...previous.filter((id) => !removed.has(id)), ...added]);
}

/**
 * Двойной щелчок по объекту выделенной группы: на уровень глубже, к тому, что под курсором.
 * `null` — входить некуда (объект уже выбран сам по себе), и двойной щелчок делает своё
 * обычное дело: открывает набор или правку таблицы.
 */
export function enterGroup(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
  elementId: string,
): string[] | null {
  const element = elements.find((item) => item.elementId === elementId);
  if (!element) return null;
  const path = groupPath(element);
  const scope = selectionScope(elements, selectedIds);
  const level = startsWith(path, scope) ? scope.length : 0;
  if (path.length <= level) return null;
  const selected = new Set(selectedIds);
  // Группа ещё не выделена целиком — первый двойной щелчок её и выделяет.
  const unit = membersOf(elements, path.slice(0, level + 1));
  if (!unit.every((id) => selected.has(id))) return unit;
  return unitOf(elements, elementId, path.slice(0, level + 1));
}

/** Esc внутри группы: выделить её целиком. `null` — выделение уже на верхнем уровне. */
export function exitGroup(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
): string[] | null {
  if (selectedIds.length === 0) return null;
  const scope = selectionScope(elements, selectedIds);
  return scope.length === 0 ? null : membersOf(elements, scope);
}

/**
 * Tab и Shift+Tab: следующий узел на том же уровне — объект или группа целиком. Заблокированное
 * пропускается, как и раньше.
 */
export function stepUnits(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
  step: -1 | 1,
): string[] {
  const scope = selectionScope(elements, selectedIds);
  const siblings = (layersAt(layerTree(elements), scope) ?? []).filter((node) =>
    layerElements([node]).some((element) => element.locked !== true),
  );
  if (siblings.length === 0) return [];
  const last = selectedIds.at(-1);
  const at = siblings.findIndex(
    (node) => last !== undefined && layerElementIds(node).includes(last),
  );
  const start = at < 0 ? (step > 0 ? -1 : 0) : at;
  const next = siblings[(start + step + siblings.length) % siblings.length];
  return next ? layerElementIds(next) : [];
}

/** Узлы, которые выделение выбирает целиком: объекты и группы. */
function pickedNodes(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
): readonly LayerNode[] {
  return pickedLayers(layerTree(elements), new Set(selectedIds)).map((item) => item.node);
}

/** Есть что группировать: выбрано хотя бы два узла. */
export function canGroup(elements: readonly SlideElement[], selectedIds: readonly string[]) {
  return pickedNodes(elements, selectedIds).length >= 2;
}

/** Есть что разгруппировать: среди выбранного есть группа целиком. */
export function canUngroup(elements: readonly SlideElement[], selectedIds: readonly string[]) {
  return pickedNodes(elements, selectedIds).some((node) => node.kind === 'group');
}

/** Выделена ровно одна группа целиком: у неё одна рамка, без рамок её объектов. */
export function isWholeGroup(elements: readonly SlideElement[], selectedIds: readonly string[]) {
  const nodes = pickedNodes(elements, selectedIds);
  return nodes.length === 1 && nodes[0]?.kind === 'group';
}

/**
 * Выравнивание с группами: группа выравнивается как один объект, её состав сдвигается
 * целиком. Один узел — по слайду, как одиночный объект в Figma, несколько — между собой.
 */
export function alignUnits(
  elements: readonly SlideElement[],
  selectedIds: readonly string[],
  alignment: Alignment,
  slide: { readonly slideCx: number; readonly slideCy: number },
): ElementMove[] {
  const units = pickedNodes(elements, selectedIds).flatMap((node, index) => {
    const members = layerElements([node]);
    const box = unionBox(members.map((element) => element.box));
    return box ? [{ elementId: String(index), box, members }] : [];
  });
  const targets =
    units.length === 1 && units[0]
      ? [{ elementId: '0', box: toSlide(units[0].box, alignment, slide) }]
      : alignBoxes(units, alignment);
  return targets.flatMap(({ elementId, box }) => {
    const unit = units[Number(elementId)];
    if (!unit) return [];
    const dx = box.x - unit.box.x;
    const dy = box.y - unit.box.y;
    if (dx === 0 && dy === 0) return [];
    return unit.members.map((element) => ({
      elementId: element.elementId,
      box: { ...element.box, x: element.box.x + dx, y: element.box.y + dy },
    }));
  });
}

function toSlide(
  box: Box,
  alignment: Alignment,
  slide: { readonly slideCx: number; readonly slideCy: number },
): Box {
  const next = { ...box };
  if (alignment === 'left') next.x = 0;
  if (alignment === 'center') next.x = Math.round((slide.slideCx - box.cx) / 2);
  if (alignment === 'right') next.x = slide.slideCx - box.cx;
  if (alignment === 'top') next.y = 0;
  if (alignment === 'middle') next.y = Math.round((slide.slideCy - box.cy) / 2);
  if (alignment === 'bottom') next.y = slide.slideCy - box.cy;
  return next;
}

function unique(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}
