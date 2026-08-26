import { isPretableFilterGroup, type ColumnFilter } from "@pretable/core";

/**
 * The value-erased twin of `PretableFilterFor<TColumns>`: one typed leaf of
 * the filter tree, seen from chrome that works from DRAWN column ids and
 * runtime operand values rather than from a static column tuple.
 */
export interface SurfaceFilterLeaf {
  readonly columnId: string;
  readonly operator: ColumnFilter["operator"];
  readonly value?: ColumnFilter["value"];
}

/** The value-erased twin of `PretableFilterGroupFor<TColumns>`. */
export interface SurfaceFilterGroup {
  readonly op: "and" | "or";
  readonly children: readonly SurfaceFilterNode[];
}

/**
 * One node of the surface's view of `query.filters`: a leaf or a group.
 *
 * The surface holds the filter tree VERBATIM — it keeps no per-column record
 * beside it. A record cannot describe a group (a group has no `columnId`, so
 * every group in a query would collapse onto the single key `undefined`), and
 * a projection that lies by omission is worse than the two small walks below.
 */
export type SurfaceFilterNode = SurfaceFilterLeaf | SurfaceFilterGroup;

/**
 * `PretableQueryFor<TColumns>["filters"]` read as value-erased nodes.
 *
 * `PretableFilterNodeFor` discriminates its leaves over the column tuple's
 * static `accessor` return types and literal `type`s. The surface's columns are
 * runtime-supplied and value-erased, so that union collapses and no assignment
 * between the two shapes is checkable — the same collapse `queryWith` and
 * `distinctValues` document, and the reason this is a cast and not a
 * conversion. It is the single place the erasure is spelled out; call sites
 * carry only their own tree-semantics comment.
 */
export function asSurfaceNodes(
  filters: readonly unknown[],
): readonly SurfaceFilterNode[] {
  return filters as readonly SurfaceFilterNode[];
}

/**
 * Narrows a value-erased node to a group — the surface's `isPretableFilterGroup`.
 *
 * The engine's guard is generic over a static column tuple, and the surface's
 * nodes are value-erased, so `as never` is what satisfies the parameter. It
 * does not weaken the check: the guard is structural at runtime and tests the
 * group's own fields. Same collapse, and the same remedy, as the
 * `distinctValues` call in `pretable-surface.tsx`.
 *
 * Exported so the SECOND walk over the tree — `LabeledGridSurface`'s
 * `is-filtered` header decoration, which cannot share these functions because
 * it gates on `isColumnFilterActive` — narrows through this one explanation
 * instead of repeating the casts.
 */
export const isSurfaceFilterGroup = (
  node: SurfaceFilterNode,
): node is SurfaceFilterGroup => isPretableFilterGroup(node as never);

/**
 * Does ANY leaf anywhere in the tree constrain `columnId`?
 *
 * This is what lights a column's funnel. Occurrence, not position: a filter
 * the user built two groups deep in the filter builder still means "this
 * column is filtered", and a funnel that only noticed top-level leaves would
 * tell them their column was unconstrained while it removed their rows.
 */
export function columnHasFilter(
  nodes: readonly SurfaceFilterNode[],
  columnId: string,
): boolean {
  return nodes.some((node) =>
    isSurfaceFilterGroup(node)
      ? columnHasFilter(node.children, columnId)
      : node.columnId === columnId,
  );
}

/**
 * The column's FIRST top-level leaf, as the per-column filter menu understands
 * it — or `null` when only a group mentions the column.
 *
 * The menu edits one column with one operator and one operand; it cannot
 * express a group, so it owns exactly that leaf and reports nothing about the
 * rest of the tree. Reaching into groups here would let a menu commit silently
 * overwrite a branch the user built elsewhere.
 *
 * FIRST, definitely, and it matters: only a hand-authored `filters` can hold
 * two top-level leaves for one column, but when it does, this reads the
 * earlier one and `withTopLevelColumnFilter` replaces that same one — the two
 * halves agree, which is the point. The per-column record this replaced was
 * LAST-wins (each entry overwrote the key), so a consumer with duplicates sees
 * the other leaf now.
 */
export function topLevelColumnFilter(
  nodes: readonly SurfaceFilterNode[],
  columnId: string,
): ColumnFilter | null {
  for (const node of nodes) {
    if (isSurfaceFilterGroup(node) || node.columnId !== columnId) continue;
    return {
      operator: node.operator,
      ...(node.value === undefined ? {} : { value: node.value }),
    };
  }
  return null;
}

/**
 * The menu's write path: replace (or, cleared, remove) the column's top-level
 * leaf and pass every other element through BY REFERENCE.
 *
 * Replacement is in place rather than remove-then-append so that committing a
 * new operand does not reshuffle the array, and groups keep their slots. Every
 * element this function did not author is the caller's own object, unchanged —
 * that is the contract the surface's group elements survive on.
 */
export function withTopLevelColumnFilter(
  nodes: readonly SurfaceFilterNode[],
  columnId: string,
  filter: ColumnFilter | null,
): readonly SurfaceFilterNode[] {
  const replacement: SurfaceFilterLeaf | null =
    filter === null
      ? null
      : {
          columnId,
          operator: filter.operator,
          ...(filter.value === undefined ? {} : { value: filter.value }),
        };
  let replaced = false;
  const next: SurfaceFilterNode[] = [];
  for (const node of nodes) {
    if (isSurfaceFilterGroup(node) || node.columnId !== columnId) {
      next.push(node);
      continue;
    }
    // Only the FIRST top-level leaf is the menu's; any duplicate a consumer
    // wrote is dropped, because the menu can only show one of them and
    // leaving the others would make the commit look inert.
    if (replaced || replacement === null) continue;
    next.push(replacement);
    replaced = true;
  }
  if (!replaced && replacement !== null) next.push(replacement);
  return next;
}
