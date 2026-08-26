/**
 * Pure path arithmetic over the surface's AND/OR filter tree.
 *
 * Extracted from the filters section for the reason `tool-panel-drop-target`
 * was: addressing math is only trustworthy when it can be handed a tree and
 * asked for an answer directly, with no component, no engine and no DOM in
 * the way. Everything here is a total function over plain data.
 *
 * ## Why positions and not ids
 *
 * Filter nodes are frozen plain data with no identity of their own, and
 * `compileQuery` re-captures (allocates and freezes) every node on every
 * commit — so a node's object reference does not survive a write. A position
 * is the only address that outlives a round trip through the engine.
 *
 * ## Stale paths: every operation is a NO-OP that returns its input
 *
 * The cost of positions is that they go stale: the section's operand input is
 * debounced, so a write WILL sometimes arrive after a sibling was removed and
 * renumbered everything after it. Each mutating function therefore resolves
 * the path first and, if it does not address what it expects, returns the
 * `nodes` array it was given BY REFERENCE — no throw, no partial write.
 *
 * That choice is deliberate and the alternatives are worse. Throwing turns a
 * late keystroke into a crashed panel. Writing anyway lands the operand on
 * whichever node inherited the index, silently editing a filter the user was
 * not looking at. Returning the input makes an aborted write inert, and lets
 * a caller detect it with `next === nodes` should it ever want to.
 */

import {
  isSurfaceFilterGroup,
  type SurfaceFilterGroup,
  type SurfaceFilterNode,
} from "../../filter-tree";

/**
 * A node's position in the tree: root index, then child indices. `[1, 2]` is
 * `filters[1].children[2]`.
 *
 * Derived at render, never stored on a node — `compileQuery` re-allocates
 * every node on every commit, so identity dies but position survives.
 *
 * The empty path addresses no node. It is the root ARRAY, which is not a node
 * and which none of these operations can replace, remove or re-op; every one
 * of them treats `[]` as unresolvable.
 */
export type FilterPath = readonly number[];

/**
 * The node at `path`, or `undefined` when the path does not address one.
 *
 * Undefined, specifically, when: any segment is out of range (negative or
 * past the end); a NON-final segment addresses a leaf, because a leaf has no
 * children to descend into; or the path is empty, which addresses the root
 * array rather than a node.
 *
 * A stale path is exactly one of those cases, so a caller that resolves
 * before it acts never touches the wrong node — it just gets nothing.
 */
export function resolveNode(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
): SurfaceFilterNode | undefined {
  if (path.length === 0) return undefined;
  let siblings = nodes;
  for (let depth = 0; depth < path.length; depth += 1) {
    const index = path[depth]!;
    const node = index < 0 ? undefined : siblings[index];
    if (node === undefined) return undefined;
    if (depth === path.length - 1) return node;
    // A non-final segment must be a group; descending into a leaf is what a
    // stale path looks like after a group was replaced by a leaf.
    if (!isSurfaceFilterGroup(node)) return undefined;
    siblings = node.children;
  }
  return undefined;
}

/**
 * The parent group's child list for `path`, or `undefined` when the path's
 * parent does not resolve. `[2]`'s parent list is `nodes` itself.
 */
function parentList(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
): readonly SurfaceFilterNode[] | undefined {
  if (path.length === 0) return undefined;
  if (path.length === 1) return nodes;
  const parent = resolveNode(nodes, path.slice(0, -1));
  return parent !== undefined && isSurfaceFilterGroup(parent)
    ? parent.children
    : undefined;
}

/**
 * Rebuild the tree with `path`'s parent child-list replaced by `nextList`.
 *
 * Only the nodes ON the spine from the root to that parent are re-allocated;
 * every sibling hanging off it is passed through by reference, so React can
 * skip the subtrees a write did not touch.
 */
function withParentList(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
  nextList: readonly SurfaceFilterNode[],
): readonly SurfaceFilterNode[] {
  if (path.length <= 1) return nextList;
  const parentPath = path.slice(0, -1);
  const parent = resolveNode(nodes, parentPath);
  // Unreachable by construction — every caller has already resolved this same
  // parent (that is where `nextList` came from) and bailed if it was missing
  // or a leaf. There is no test behind this branch and there cannot be one; it
  // is here because it is also what narrows `parent` to a group for the spread
  // below. Do not go hunting for the coverage.
  if (parent === undefined || !isSurfaceFilterGroup(parent)) return nodes;
  const nextParent: SurfaceFilterGroup = { ...parent, children: nextList };
  return replaceNode(nodes, parentPath, nextParent);
}

/**
 * Replace the node at `path` with `next`, rebuilding only the spine.
 *
 * Siblings off the spine keep reference identity. Returns `nodes` unchanged
 * when the path does not resolve (see the module note on stale paths) — a
 * debounced operand landing after its row was removed writes nothing.
 */
export function replaceNode(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
  next: SurfaceFilterNode,
): readonly SurfaceFilterNode[] {
  if (resolveNode(nodes, path) === undefined) return nodes;
  const siblings = parentList(nodes, path)!;
  const index = path[path.length - 1]!;
  const nextList = siblings.map((node, at) => (at === index ? next : node));
  return withParentList(nodes, path, nextList);
}

/**
 * Remove the node at `path`, rebuilding only the spine.
 *
 * Removing a group's LAST child leaves the group standing and empty. That is
 * not an oversight: the engine evaluates an empty group as TRUE under both
 * operators, precisely so a half-built group in the UI can never blank the
 * grid, and a user who clears a group's last row means to add another row —
 * not to lose the group they just made.
 *
 * Returns `nodes` unchanged when the path does not resolve, which makes a
 * double-fired remove idempotent rather than destructive of a neighbour.
 */
export function removeNode(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
): readonly SurfaceFilterNode[] {
  if (resolveNode(nodes, path) === undefined) return nodes;
  const siblings = parentList(nodes, path)!;
  const index = path[path.length - 1]!;
  const nextList = siblings.filter((_, at) => at !== index);
  return withParentList(nodes, path, nextList);
}

/**
 * Insert `node` AT `path`, pushing the current occupant of that slot right.
 *
 * Only the PARENT half of the path must resolve — the final index names a
 * slot, not an existing node, and a final index past the end of the list
 * APPENDS. That is what makes "add a row to this group" and "drop it here"
 * the same call: a drop past the last row is a legitimate slot, and the only
 * honest reading of it is "last".
 *
 * A NEGATIVE final index is not a slot and does not insert — it returns
 * `nodes` unchanged, the same as every other negative segment (`resolveNode`
 * treats those as unresolvable). Past-the-end and below-zero are not
 * symmetric: no drop target can mean "before the first row" by way of `-1`,
 * so a negative index is arithmetic that went wrong upstream, and clamping it
 * to a prepend would turn that bug into a filter the user did not write.
 *
 * Returns `nodes` unchanged when the parent does not resolve or is a leaf: a
 * late insert into a group that has since been removed adds nothing anywhere,
 * rather than silently landing at the root.
 */
export function insertNode(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
  node: SurfaceFilterNode,
): readonly SurfaceFilterNode[] {
  const siblings = parentList(nodes, path);
  if (siblings === undefined) return nodes;
  const index = path[path.length - 1]!;
  if (index < 0) return nodes;
  const at = Math.min(index, siblings.length);
  const nextList = [...siblings.slice(0, at), node, ...siblings.slice(at)];
  return withParentList(nodes, path, nextList);
}

/**
 * How deeply the path is nested. Root nodes are depth 0, matching the engine,
 * so `depthOf([1, 0, 2])` is 2. Pure arithmetic — it never consults a tree,
 * so it says nothing about whether the path resolves.
 */
export function depthOf(path: FilterPath): number {
  return Math.max(path.length - 1, 0);
}

/**
 * The depth of the deepest OCCUPIED level in the tree — 0 for a flat list
 * (and for an empty one), 1 for one level of nesting.
 *
 * An empty group contributes its OWN depth and no more: it has no children,
 * so it is not yet the parent of a deeper level, and counting a phantom child
 * would report a nesting the user has not actually built.
 *
 * NOT the input to a depth-limit gate, despite the resemblance. `treeDepth`
 * describes what the tree HOLDS, and a refusal has to be about where the next
 * node would LAND: nest two groups, leave the inner one empty, and
 * `treeDepth` still reads 1 while a leaf dropped into that inner group
 * arrives at depth 2. Gate on `depthOf(targetPath) + 1` — the depth of the
 * thing being added — and use this only to describe or display a tree.
 */
export function treeDepth(nodes: readonly SurfaceFilterNode[]): number {
  let deepest = 0;
  for (const node of nodes) {
    if (!isSurfaceFilterGroup(node) || node.children.length === 0) continue;
    deepest = Math.max(deepest, 1 + treeDepth(node.children));
  }
  return deepest;
}

/**
 * Change one group's join operator, keeping its children by reference.
 *
 * Returns `nodes` unchanged when `groupPath` does not resolve OR resolves to
 * a leaf — a leaf has no join to set, and quietly inventing one would be a
 * write to a node the caller did not mean.
 *
 * Also unchanged, and by reference, when the group ALREADY joins with `op`.
 * Re-selecting the current operator is a real thing a user does, and under
 * this module's contract a returned-identical array is what a caller reads as
 * "nothing happened" — so a redundant flip commits no query and repaints
 * nothing, rather than re-allocating the spine to produce the same tree.
 */
export function setGroupOp(
  nodes: readonly SurfaceFilterNode[],
  groupPath: FilterPath,
  op: SurfaceFilterGroup["op"],
): readonly SurfaceFilterNode[] {
  const group = resolveNode(nodes, groupPath);
  if (group === undefined || !isSurfaceFilterGroup(group)) return nodes;
  if (group.op === op) return nodes;
  return replaceNode(nodes, groupPath, { ...group, op });
}
