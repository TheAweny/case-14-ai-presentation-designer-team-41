import type { Draft } from 'immer';
import type { SlideElement, SlideIr } from '@lct/contracts';

/*
 * Layers
 * ------
 *
 * A slide stores its elements flat, in paint order, and each element names the groups it is in
 * (`groupIds`, outermost first). Everything that has to reason about groups — grouping, the
 * paint order, the layers panel, export — reads the same tree instead: elements sharing a
 * leading run of group ids hang under one group node, in paint order.
 *
 * The flat form keeps one invariant the tree makes obvious: the members of a group are
 * consecutive in paint order, as a p:grpSp is one node of the shape tree. `layerTree` builds a
 * valid tree even from a slide that breaks it (a group's node sits where its lowest member
 * was), and `writeLayers` puts the flat form back in that shape.
 */

/** The groups an element is in, outermost first. Empty when it is in none. */
export function groupPath(element: Pick<SlideElement, 'groupIds'>): readonly string[] {
  return element.groupIds ?? [];
}

export interface ElementLayer {
  readonly kind: 'element';
  /** The element id. */
  readonly id: string;
  readonly element: SlideElement;
}

export interface GroupLayer {
  readonly kind: 'group';
  /** The group id: the last entry of `path`. */
  readonly id: string;
  /** Group ids from the outermost group down to this one. */
  readonly path: readonly string[];
  /** In paint order, lowest first. */
  readonly children: readonly LayerNode[];
}

export type LayerNode = ElementLayer | GroupLayer;

interface GroupDraftNode {
  kind: 'group';
  id: string;
  path: string[];
  children: (ElementLayer | GroupDraftNode)[];
}

function pathKey(path: readonly string[]): string {
  return JSON.stringify(path);
}

/** The elements of a slide as a tree of groups, in paint order, lowest first. */
export function layerTree(elements: readonly SlideElement[]): readonly LayerNode[] {
  const root: (ElementLayer | GroupDraftNode)[] = [];
  const groups = new Map<string, GroupDraftNode>();
  for (const element of elements) {
    let siblings = root;
    const path = groupPath(element);
    for (let depth = 0; depth < path.length; depth += 1) {
      const prefix = path.slice(0, depth + 1);
      const key = pathKey(prefix);
      let group = groups.get(key);
      if (!group) {
        group = { kind: 'group', id: prefix[depth] ?? '', path: prefix, children: [] };
        groups.set(key, group);
        siblings.push(group);
      }
      siblings = group.children;
    }
    siblings.push({ kind: 'element', id: element.elementId, element });
  }
  return root;
}

/** Every element under these nodes, in paint order. */
export function layerElements(nodes: readonly LayerNode[]): SlideElement[] {
  return nodes.flatMap((node) =>
    node.kind === 'element' ? [node.element] : layerElements(node.children),
  );
}

/** Ids of every element under this node. */
export function layerElementIds(node: LayerNode): string[] {
  return layerElements([node]).map((element) => element.elementId);
}

/** Group paths as the nesting says, rebuilt from the top: a lifted node loses a level. */
function rebased(nodes: readonly LayerNode[], parent: readonly string[]): LayerNode[] {
  return nodes.map((node) => {
    if (node.kind === 'element') return node;
    const path = [...parent, node.id];
    return { ...node, path, children: rebased(node.children, path) };
  });
}

/**
 * The same tree without groups that group nothing: a group of one is its member, an empty
 * group is gone. PowerPoint does the same when a group loses all but one shape.
 */
export function prunedLayers(nodes: readonly LayerNode[]): readonly LayerNode[] {
  const prune = (list: readonly LayerNode[]): LayerNode[] =>
    list.flatMap((node): LayerNode[] => {
      if (node.kind === 'element') return [node];
      const children = prune(node.children);
      if (children.length <= 1) return children;
      return [{ ...node, children }];
    });
  return rebased(prune(nodes), []);
}

/** Where an element sits: its id and the groups the tree puts it in. */
export interface PlacedElement {
  readonly elementId: string;
  readonly groupIds: readonly string[];
}

/** The tree back as the flat paint order, each element with the groups it is under. */
export function flattenLayers(nodes: readonly LayerNode[]): PlacedElement[] {
  const walk = (list: readonly LayerNode[], path: readonly string[]): PlacedElement[] =>
    list.flatMap((node) =>
      node.kind === 'element'
        ? [{ elementId: node.id, groupIds: path }]
        : walk(node.children, [...path, node.id]),
    );
  return walk(nodes, []);
}

/** The node with this id — an element id or a group id — and the path of its parent. */
export function findLayer(
  nodes: readonly LayerNode[],
  id: string,
  parent: readonly string[] = [],
): { readonly node: LayerNode; readonly parent: readonly string[] } | null {
  for (const node of nodes) {
    if (node.id === id) return { node, parent };
    if (node.kind === 'group') {
      const found = findLayer(node.children, id, node.path);
      if (found) return found;
    }
  }
  return null;
}

/** Children of the group at `path`; the root list for an empty path. Null if there is none. */
export function layersAt(
  nodes: readonly LayerNode[],
  path: readonly string[],
): readonly LayerNode[] | null {
  let list = nodes;
  for (const id of path) {
    const group = list.find((node): node is GroupLayer => node.kind === 'group' && node.id === id);
    if (!group) return null;
    list = group.children;
  }
  return list;
}

/** The same tree with the children of the group at `path` replaced. */
export function withLayersAt(
  nodes: readonly LayerNode[],
  path: readonly string[],
  replace: (children: readonly LayerNode[]) => readonly LayerNode[],
): readonly LayerNode[] {
  const [head, ...rest] = path;
  if (head === undefined) return replace(nodes);
  return nodes.map((node) =>
    node.kind === 'group' && node.id === head
      ? { ...node, children: withLayersAt(node.children, rest, replace) }
      : node,
  );
}

/** A node picked by a selection, with the path of the group it sits in. */
export interface PickedLayer {
  readonly node: LayerNode;
  readonly parent: readonly string[];
}

/**
 * What a selection picks, as whole nodes: a group when every element under it is selected,
 * otherwise whatever inside it is. The topmost such nodes only, in paint order.
 */
export function pickedLayers(
  nodes: readonly LayerNode[],
  selected: ReadonlySet<string>,
  parent: readonly string[] = [],
): PickedLayer[] {
  return nodes.flatMap((node): PickedLayer[] => {
    const ids = layerElementIds(node);
    if (ids.length > 0 && ids.every((id) => selected.has(id))) return [{ node, parent }];
    if (node.kind === 'group') return pickedLayers(node.children, selected, node.path);
    return [];
  });
}

/** The longest run of ids every path starts with. */
export function commonPath(paths: readonly (readonly string[])[]): readonly string[] {
  const [first, ...rest] = paths;
  if (!first) return [];
  let length = first.length;
  for (const path of rest) {
    let same = 0;
    while (same < length && same < path.length && path[same] === first[same]) same += 1;
    length = same;
  }
  return first.slice(0, length);
}

/** Every group id on a slide, at any depth. */
export function groupIdsOf(elements: readonly SlideElement[]): Set<string> {
  return new Set(elements.flatMap((element) => groupPath(element)));
}

/**
 * Put a slide's elements into the order and groups `layers` says. Only what differs is
 * written, so the journal records a reorder as a reorder and a regroup as new `groupIds`.
 * Elements `layers` does not name are dropped from the order.
 */
export function writeLayers(target: Draft<SlideIr>, layers: readonly PlacedElement[]): void {
  const inOrder = layers.every(
    (layer, index) => target.elements[index]?.elementId === layer.elementId,
  );
  if (!inOrder || target.elements.length !== layers.length) {
    const byId = new Map(target.elements.map((element) => [element.elementId, element]));
    const next = layers
      .map((layer) => byId.get(layer.elementId))
      .filter((element) => element !== undefined);
    target.elements.splice(0, target.elements.length, ...next);
  }
  for (const [index, layer] of layers.entries()) {
    const element = target.elements[index];
    if (!element || element.elementId !== layer.elementId) continue;
    if (layer.groupIds.length === 0) {
      if (element.groupIds !== undefined) delete element.groupIds;
    } else if (JSON.stringify(element.groupIds) !== JSON.stringify(layer.groupIds)) {
      element.groupIds = [...layer.groupIds];
    }
  }
}

/**
 * Reorder picked nodes among their siblings, each list of siblings on its own, so a group
 * moves as one node and an element inside a group stays inside it.
 */
export function arrangedLayers(
  nodes: readonly LayerNode[],
  selected: ReadonlySet<string>,
  reorder: (items: readonly LayerNode[], picked: (item: LayerNode) => boolean) => LayerNode[],
): readonly LayerNode[] {
  const picked = new Set(pickedLayers(nodes, selected).map((item) => item.node));
  const walk = (list: readonly LayerNode[]): LayerNode[] => {
    // A picked group moves whole; one that is not may hold picked nodes of its own.
    const inner = list.map((node) =>
      node.kind === 'group' && !picked.has(node)
        ? { ...node, children: walk(node.children) }
        : node,
    );
    const wanted = new Set(inner.filter((_, index) => picked.has(list[index] as LayerNode)));
    return wanted.size === 0 ? inner : reorder(inner, (node) => wanted.has(node));
  };
  return walk(nodes);
}

/**
 * Bring a slide's groups back into shape after elements came or went: members consecutive,
 * no group of one.
 */
export function tidyLayers(target: Draft<SlideIr>): void {
  writeLayers(target, flattenLayers(prunedLayers(layerTree(target.elements as SlideElement[]))));
}
