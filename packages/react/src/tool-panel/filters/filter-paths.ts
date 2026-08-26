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
 * renumbered everything after it. Every write therefore validates as it walks
 * and, the moment the path stops addressing what it expects, unwinds and
 * returns the `nodes` array it was given BY REFERENCE — no throw, no partial
 * write.
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
  const head = path[0]!;
  const node = head < 0 ? undefined : nodes[head];
  if (node === undefined || path.length === 1) return node;
  // A non-final segment must be a group; descending into a leaf is what a
  // stale path looks like after a group was replaced by a leaf.
  return isSurfaceFilterGroup(node)
    ? resolveNode(node.children, path.slice(1))
    : undefined;
}

/**
 * The one walk every write goes through: descend to `path`'s parent list,
 * hand it to `update`, and rebuild the spine on the way back out.
 *
 * `update` receives the sibling list the final segment indexes into and that
 * segment's index, and returns the replacement list — or `undefined` to
 * REFUSE, which is how each operation states its own idea of a path that does
 * not address what it needs (a missing node for replace/remove, a negative
 * slot for insert, a leaf for `setGroupOp`). A refusal anywhere, at any
 * depth, unwinds to the original `nodes` by reference.
 *
 * Validation and rebuilding are the same descent on purpose. Resolving first
 * and rebuilding after meant walking the spine three times per write and a
 * mutual recursion between this and `replaceNode`; worse, the "parent is
 * missing" check in the rebuild half could not be reached, because the
 * resolve half had already guaranteed it. Here that check is the ONLY one,
 * and every stale-path test in the suite lands on it.
 *
 * Nodes off the rebuilt spine are passed through by reference so React can
 * skip the subtrees a write did not touch — including when a nested `update`
 * returns the list it was given, which propagates outward as `nodes` itself.
 */
function withUpdatedList(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
  update: (
    siblings: readonly SurfaceFilterNode[],
    index: number,
  ) => readonly SurfaceFilterNode[] | undefined,
): readonly SurfaceFilterNode[] {
  if (path.length === 0) return nodes;
  if (path.length === 1) return update(nodes, path[0]!) ?? nodes;
  const head = path[0]!;
  const parent = head < 0 ? undefined : nodes[head];
  if (parent === undefined || !isSurfaceFilterGroup(parent)) return nodes;
  const nextChildren = withUpdatedList(parent.children, path.slice(1), update);
  if (nextChildren === parent.children) return nodes;
  const nextParent: SurfaceFilterGroup = { ...parent, children: nextChildren };
  return nodes.map((node, at) => (at === head ? nextParent : node));
}

/**
 * Replace the node at `path` with `node`, rebuilding only the spine.
 *
 * Siblings off the spine keep reference identity. Returns `nodes` unchanged
 * when the path does not resolve (see the module note on stale paths) — a
 * debounced operand landing after its row was removed writes nothing.
 */
export function replaceNode(
  nodes: readonly SurfaceFilterNode[],
  path: FilterPath,
  node: SurfaceFilterNode,
): readonly SurfaceFilterNode[] {
  return withUpdatedList(nodes, path, (siblings, index) =>
    siblings[index] === undefined
      ? undefined
      : siblings.map((sibling, at) => (at === index ? node : sibling)),
  );
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
  return withUpdatedList(nodes, path, (siblings, index) =>
    siblings[index] === undefined
      ? undefined
      : siblings.filter((_, at) => at !== index),
  );
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
  return withUpdatedList(nodes, path, (siblings, index) => {
    if (index < 0) return undefined;
    const at = Math.min(index, siblings.length);
    return [...siblings.slice(0, at), node, ...siblings.slice(at)];
  });
}

/**
 * How deeply the path is nested. Root nodes are depth 0, matching the engine,
 * so `depthOf([1, 0, 2])` is 2. Pure arithmetic — it never consults a tree,
 * so it says nothing about whether the path resolves.
 *
 * The empty path is -1, not 0: it addresses no node, and reporting it as a
 * root node's depth would make "the root list" and "the first filter" the
 * same answer. -1 is also what makes the containing-group gate below come out
 * right at the root, where the container has no path at all.
 *
 * ## Gating a depth limit
 *
 * Gate on the depth the new node would LAND at, and mind which path you hold:
 *
 * - From the CONTAINING GROUP's path — "may I add a row to this group?" —
 *   the new node lands at `depthOf(groupPath) + 1`. At the root that is
 *   `depthOf([]) + 1`, which is 0.
 * - From the SLOT path you would hand `insertNode` — "may this drop land
 *   here?" — the new node lands at `depthOf(slotPath)`, with NO `+ 1`. The
 *   slot path already includes the new node's own segment.
 *
 * Reading the second as the first is one level too strict and quietly
 * disables the deepest legal `+ group`. Neither form is `depthOfTree`, which
 * measures something else entirely — see its note.
 */
export function depthOf(path: FilterPath): number {
  return path.length - 1;
}

/**
 * The depth of the deepest OCCUPIED level in the tree — 0 for a flat list
 * (and for an empty one), 1 for one level of nesting.
 *
 * An empty group contributes its OWN depth and no more: it has no children,
 * so it is not yet the parent of a deeper level, and counting a phantom child
 * would report a nesting the user has not actually built.
 *
 * NOT the input to a depth-limit gate, despite the resemblance. This
 * describes what the tree HOLDS, and a refusal has to be about where the next
 * node would LAND: nest two groups, leave the inner one empty, and this still
 * reads 1 while a leaf dropped into that inner group arrives at depth 2. Gate
 * with `depthOf` (see its note for the two forms) and use this only to
 * describe or display a tree.
 *
 * Which leaves it, for now, with no caller at all — the section gates with
 * `depthOf`. It stays only until the filters section is finished: if nothing
 * has come to describe or display a tree by then, delete it and its tests
 * rather than keeping a function the product does not use.
 */
export function depthOfTree(nodes: readonly SurfaceFilterNode[]): number {
  let deepest = 0;
  for (const node of nodes) {
    if (!isSurfaceFilterGroup(node) || node.children.length === 0) continue;
    deepest = Math.max(deepest, 1 + depthOfTree(node.children));
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
  return withUpdatedList(nodes, groupPath, (siblings, index) => {
    const group = siblings[index];
    if (group === undefined || !isSurfaceFilterGroup(group)) return undefined;
    if (group.op === op) return undefined;
    const next: SurfaceFilterGroup = { ...group, op };
    return siblings.map((sibling, at) => (at === index ? next : sibling));
  });
}
