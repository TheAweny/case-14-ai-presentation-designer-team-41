import type { SlideIr } from '@lct/contracts';
import {
  commitProduced,
  freshIds,
  produceSlides,
  randomId,
  selectionOf,
  slideOf,
  unchanged,
  type DeckCommit,
  type DeckChangeKind,
} from './core.js';
import {
  commonPath,
  findLayer,
  flattenLayers,
  groupIdsOf,
  layerElementIds,
  layerTree,
  layersAt,
  pickedLayers,
  prunedLayers,
  withLayersAt,
  writeLayers,
  type GroupLayer,
  type LayerNode,
} from './layers.js';

/*
 * Groups
 * ------
 *
 * Grouping and ungrouping rewrite `groupIds` and, when the members were apart, the paint order:
 * a group is one node of the paint order, so its members end up next to each other, where the
 * topmost of them was — which is where PowerPoint puts a new group too.
 */

function commitLayers(
  slides: readonly SlideIr[],
  slideId: string,
  layers: readonly LayerNode[],
  meta: { kind: DeckChangeKind; before: readonly string[]; after: readonly string[] },
): DeckCommit {
  const placed = flattenLayers(layers);
  const produced = produceSlides(slides, (draft) => {
    const target = slideOf(draft, slideId);
    if (target) writeLayers(target, placed);
  });
  return commitProduced(slides, produced, slideId, [], {
    kind: meta.kind,
    before: selectionOf(slideId, meta.before),
    after: selectionOf(slideId, meta.after),
  });
}

/**
 * Put the selected elements into one new group. What gets grouped are whole nodes: a group
 * every member of which is selected goes in as a group, and the new group sits inside the
 * deepest group that holds all of them, so grouping inside a group nests. Fewer than two
 * nodes, or every child of a group (that group is already the group asked for), change nothing.
 */
export function commitGroup(
  slides: readonly SlideIr[],
  change: {
    readonly slideId: string;
    readonly elementIds: readonly string[];
    /** Id of the new group, if the caller wants to know it; taken ids are not reused. */
    readonly groupId?: string;
    readonly nextId?: () => string;
  },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide) return unchanged(slides);
  const selected = new Set(change.elementIds);
  const tree = prunedLayers(layerTree(slide.elements));
  const picked = pickedLayers(tree, selected);
  if (picked.length === 0) return unchanged(slides);
  const parent = commonPath(picked.map((item) => item.parent));
  const siblings = layersAt(tree, parent) ?? [];
  const wrapped = siblings.filter((node) => layerElementIds(node).some((id) => selected.has(id)));
  if (wrapped.length < 2) return unchanged(slides);
  if (parent.length > 0 && wrapped.length === siblings.length) return unchanged(slides);

  const taken = [
    ...slide.elements.map((element) => element.elementId),
    ...groupIdsOf(slide.elements),
  ];
  const next = freshIds(taken, change.nextId ?? randomId);
  const groupId = change.groupId && !taken.includes(change.groupId) ? change.groupId : next();
  if (groupId === null) return unchanged(slides);

  const group: GroupLayer = {
    kind: 'group',
    id: groupId,
    path: [...parent, groupId],
    children: wrapped,
  };
  const top = siblings.indexOf(wrapped.at(-1) as LayerNode);
  const layers = withLayersAt(tree, parent, (children) =>
    children.flatMap((node, index) => {
      if (index === top) return [group];
      return wrapped.includes(node) ? [] : [node];
    }),
  );
  const members = layerElementIds(group);
  return commitLayers(slides, change.slideId, layers, {
    kind: 'group',
    before: [...selected].filter((id) => members.includes(id)),
    after: members,
  });
}

/**
 * Take apart the groups the selection picks whole. Their members stay where they are in the
 * paint order and stay selected; a group inside one of them stays a group.
 */
export function commitUngroup(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly elementIds: readonly string[] },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide) return unchanged(slides);
  const selected = new Set(change.elementIds);
  const tree = prunedLayers(layerTree(slide.elements));
  const groups = pickedLayers(tree, selected).flatMap(({ node }) =>
    node.kind === 'group' ? [node] : [],
  );
  if (groups.length === 0) return unchanged(slides);
  const dissolved = new Set(groups);
  const dissolve = (nodes: readonly LayerNode[]): LayerNode[] =>
    nodes.flatMap((node): LayerNode[] => {
      if (node.kind === 'element') return [node];
      if (dissolved.has(node)) return [...node.children];
      return [{ ...node, children: dissolve(node.children) }];
    });
  const members = groups.flatMap((group) => layerElementIds(group));
  return commitLayers(slides, change.slideId, prunedLayers(dissolve(tree)), {
    kind: 'ungroup',
    before: members,
    after: members,
  });
}

/**
 * Move one layer — an element or a group, by its id — to the place of another layer in the
 * same group, the way a layers panel drops a row onto another. Layers of different groups
 * stay where they are: moving between groups is grouping, not ordering.
 */
export function commitMoveLayer(
  slides: readonly SlideIr[],
  change: { readonly slideId: string; readonly layerId: string; readonly overId: string },
): DeckCommit {
  const slide = slideOf(slides, change.slideId);
  if (!slide || change.layerId === change.overId) return unchanged(slides);
  const tree = layerTree(slide.elements);
  const moved = findLayer(tree, change.layerId);
  const over = findLayer(tree, change.overId);
  if (!moved || !over) return unchanged(slides);
  if (JSON.stringify(moved.parent) !== JSON.stringify(over.parent)) return unchanged(slides);
  const layers = withLayersAt(tree, moved.parent, (children) => {
    const from = children.indexOf(moved.node);
    const to = children.indexOf(over.node);
    if (from < 0 || to < 0) return children;
    const order = [...children];
    order.splice(from, 1);
    order.splice(to, 0, moved.node);
    return order;
  });
  const ids = layerElementIds(moved.node);
  return commitLayers(slides, change.slideId, layers, {
    kind: 'arrange',
    before: ids,
    after: ids,
  });
}
