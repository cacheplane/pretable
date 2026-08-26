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
 * `isPretableFilterGroup` is generic over a static column tuple; the surface's
 * nodes are value-erased, and `as never` is what satisfies the parameter
 * without weakening the guard — it is structural at runtime. Same collapse,
 * and the same remedy, as the `distinctValues` call in `pretable-surface.tsx`.
 */
const isGroup = (node: SurfaceFilterNode): node is SurfaceFilterGroup =>
  isPretableFilterGroup(node as never);

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
    isGroup(node)
      ? columnHasFilter(node.children, columnId)
      : node.columnId === columnId,
  );
}

/**
 * The column's TOP-LEVEL leaf, as the per-column filter menu understands it —
 * or `null` when only a group mentions the column.
 *
 * The menu edits one column with one operator and one operand; it cannot
 * express a group, so it owns exactly the top-level leaf and reports nothing
 * about the rest of the tree. Reaching into groups here would let a menu
 * commit silently overwrite a branch the user built elsewhere.
 */
export function topLevelColumnFilter(
  nodes: readonly SurfaceFilterNode[],
  columnId: string,
): ColumnFilter | null {
  for (const node of nodes) {
    if (isGroup(node) || node.columnId !== columnId) continue;
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
    if (isGroup(node) || node.columnId !== columnId) {
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
