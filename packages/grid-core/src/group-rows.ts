import { resolveAggregator } from "./aggregators";
import { collator, readCellValue, sortRows, type SourceRow } from "./row-utils";
import { makeGroupId, stringifyGroupValue } from "./group-id";
import type {
  PretableAggregator,
  PretableColumn,
  PretableRow,
  PretableSortEntry,
  PretableVisibleRow,
} from "./types";

/**
 * Multi-level row grouping with aggregation — the pure half of the feature.
 *
 * Pipeline (filtering already happened upstream):
 *   sort → group → aggregate → order siblings → flatten
 *
 * Sorting the whole post-filter set once and then bucketing means data rows
 * inside a group land in exactly the order a flat grid would show them, and it
 * makes the ungrouped path byte-identical to `deriveVisibleRows`.
 *
 * Aggregates are folded from each group's **descendant leaf rows**, never from
 * its child aggregates. That is what makes a parent's `avg` the mean of all its
 * leaves rather than the mean of its child means — the two differ whenever the
 * child groups are of different sizes. `PretableAggregator.merge` exists so a
 * future rollup optimization stays internal, but it is not used here.
 *
 * The pipeline is split in two at `order siblings | flatten`, because only the
 * second half reads expansion state. `buildGroupModel` does the O(rows) work —
 * sort, tree, aggregates — and depends on nothing an expand/collapse can
 * change; `flattenGroupModel` walks that model against the override set. A
 * caller holding the model across toggles (the engine does) pays only the walk.
 */

interface GroupNode<TRow extends PretableRow> {
  id: string;
  depth: number;
  columnId: string;
  value: unknown;
  /** All descendant data rows, post-filter. */
  childCount: number;
  /** Non-null for every level except the innermost. */
  children: Map<string, GroupNode<TRow>> | null;
  /**
   * `children` in display order. Computed on first flatten that reaches this
   * node and memoized — sibling order depends only on `sort`, which is a model
   * input, so it cannot go stale while the model lives. Lazy rather than eager
   * so a mostly-collapsed tree never pays to order branches nobody opens.
   */
  orderedChildren: GroupNode<TRow>[] | null;
  /** Non-null only for the innermost level. */
  rows: SourceRow<TRow>[] | null;
  /** columnId -> in-progress accumulator. */
  accumulators: Map<string, unknown>;
  /** `accumulators` run through `finalize`, memoized for the same reason. */
  finalizedAggregates: Record<string, unknown> | null;
}

interface AggregateColumn<TRow extends PretableRow> {
  column: PretableColumn<TRow>;
  aggregator: PretableAggregator;
}

export interface BuildGroupedRowsArgs<TRow extends PretableRow> {
  /** Post-filter rows, in source order. */
  rows: SourceRow<TRow>[];
  /**
   * Pre-filter rows, in source order. Supplied when `aggregateFilteredRows` is
   * on, so aggregates fold over rows the active filter hides. Sorted here
   * before folding, so an order-sensitive aggregator sees the same order it
   * would on the post-filter path. Group structure and `childCount` always come
   * from `rows`.
   */
  allRows?: SourceRow<TRow>[];
  columns: PretableColumn<TRow>[];
  /** Grouping columns, outermost first. Unknown ids are ignored. */
  rowGroups: string[];
  sort: readonly PretableSortEntry[];
  /**
   * Group ids whose expanded state differs from `defaultExpanded` (the engine
   * calls the same thing `groupsDefaultExpanded`).
   *
   * With the default (`defaultExpanded: true`) this is literally the set of
   * collapsed groups; with `defaultExpanded: false` it is the set of expanded
   * ones — which is why it is named for the override, not for either state.
   * Treating it as an override lets `expandAll`/`collapseAll` flip the default
   * and clear the set rather than enumerate ids that may not exist yet.
   */
  groupExpansionOverrides: ReadonlySet<string>;
  defaultExpanded: boolean;
}

/**
 * Everything about the grouped model that expansion state cannot change: the
 * sorted rows, the group tree, and the folded aggregates.
 *
 * Opaque to callers by design — the node shape is private, and holding one
 * across an expand/collapse is the whole point. It is invalidated by exactly
 * what `buildGroupModel` reads: rows, columns, `rowGroups`, and `sort`.
 *
 * @internal
 */
export interface GroupedRowModel<TRow extends PretableRow> {
  /** Post-filter rows in sort order — the entire model when `levels` is empty. */
  readonly sorted: SourceRow<TRow>[];
  /** Resolved grouping columns, outermost first. Empty means "not grouped". */
  readonly levels: PretableColumn<TRow>[];
  /** Root groups, keyed. Ordering is applied lazily during flatten. */
  readonly roots: Map<string, GroupNode<TRow>>;
  readonly aggregateColumns: AggregateColumn<TRow>[];
  readonly sort: readonly PretableSortEntry[];
  /** `roots` in display order, memoized on first flatten. */
  orderedRoots: GroupNode<TRow>[] | null;
}

/** Inputs to `buildGroupModel` — `BuildGroupedRowsArgs` minus expansion state. */
export type BuildGroupModelArgs<TRow extends PretableRow> = Omit<
  BuildGroupedRowsArgs<TRow>,
  "groupExpansionOverrides" | "defaultExpanded"
>;

/** @internal */
export function buildGroupModel<TRow extends PretableRow>(
  args: BuildGroupModelArgs<TRow>,
): GroupedRowModel<TRow> {
  const { rows, allRows, columns, rowGroups, sort } = args;

  const sorted = sortRows(rows, columns, sort);
  const levels = resolveLevels(columns, rowGroups);

  if (levels.length === 0) {
    return {
      sorted,
      levels,
      roots: new Map(),
      aggregateColumns: [],
      sort,
      orderedRoots: null,
    };
  }

  const roots = buildTree(sorted, levels);
  const aggregateColumns = resolveAggregateColumns(columns);

  if (aggregateColumns.length > 0) {
    // `PretableAggregator` advertises order-sensitivity (it is what keeps
    // `median` expressible), so the fold order has to be one thing, not two.
    // It is always SORT order: the pre-filter set gets the same `sortRows`
    // treatment as the post-filter one, rather than being folded in source
    // order just because `aggregateFilteredRows` happens to be on.
    accumulate(
      allRows ? sortRows(allRows, columns, sort) : sorted,
      levels,
      roots,
      aggregateColumns,
    );
  }

  return { sorted, levels, roots, aggregateColumns, sort, orderedRoots: null };
}

/** @internal */
export function flattenGroupModel<TRow extends PretableRow>(
  model: GroupedRowModel<TRow>,
  groupExpansionOverrides: ReadonlySet<string>,
  defaultExpanded: boolean,
): PretableVisibleRow<TRow>[] {
  if (model.levels.length === 0) {
    return model.sorted.map(({ id, row, sourceIndex }) => ({
      kind: "data" as const,
      id,
      row,
      sourceIndex,
      depth: 0,
    }));
  }

  if (!model.orderedRoots) {
    model.orderedRoots = orderSiblings(
      model.roots,
      model.levels[0],
      model.sort,
    );
  }

  const out: PretableVisibleRow<TRow>[] = [];
  flatten(
    model.orderedRoots,
    0,
    model,
    groupExpansionOverrides,
    defaultExpanded,
    out,
  );
  return out;
}

/** @internal */
export function buildGroupedRows<TRow extends PretableRow>(
  args: BuildGroupedRowsArgs<TRow>,
): PretableVisibleRow<TRow>[] {
  return flattenGroupModel(
    buildGroupModel(args),
    args.groupExpansionOverrides,
    args.defaultExpanded,
  );
}

function resolveLevels<TRow extends PretableRow>(
  columns: PretableColumn<TRow>[],
  rowGroups: string[],
): PretableColumn<TRow>[] {
  if (rowGroups.length === 0) return [];

  const byId = new Map(columns.map((column) => [column.id, column]));
  const levels: PretableColumn<TRow>[] = [];

  for (const columnId of rowGroups) {
    const column = byId.get(columnId);
    if (column) levels.push(column);
  }

  return levels;
}

function resolveAggregateColumns<TRow extends PretableRow>(
  columns: PretableColumn<TRow>[],
): AggregateColumn<TRow>[] {
  const resolved: AggregateColumn<TRow>[] = [];

  for (const column of columns) {
    const aggregator = resolveAggregator(column.aggregate);
    if (aggregator) resolved.push({ column, aggregator });
  }

  return resolved;
}

function buildTree<TRow extends PretableRow>(
  sorted: SourceRow<TRow>[],
  levels: PretableColumn<TRow>[],
): Map<string, GroupNode<TRow>> {
  const roots = new Map<string, GroupNode<TRow>>();
  const lastLevel = levels.length - 1;
  const path: { columnId: string; value: unknown }[] = [];

  for (const entry of sorted) {
    let siblings = roots;
    let node: GroupNode<TRow> | undefined;
    path.length = 0;

    for (let depth = 0; depth <= lastLevel; depth += 1) {
      const column = levels[depth];
      const value = readCellValue(entry.row, column);
      const key = stringifyGroupValue(value);
      path.push({ columnId: column.id, value });

      node = siblings.get(key);

      if (!node) {
        const isLeafLevel = depth === lastLevel;
        node = {
          id: makeGroupId(path),
          depth,
          columnId: column.id,
          value,
          childCount: 0,
          children: isLeafLevel ? null : new Map(),
          orderedChildren: null,
          rows: isLeafLevel ? [] : null,
          accumulators: new Map(),
          finalizedAggregates: null,
        };
        siblings.set(key, node);
      }

      node.childCount += 1;

      if (node.children) siblings = node.children;
    }

    node?.rows?.push(entry);
  }

  return roots;
}

function accumulate<TRow extends PretableRow>(
  source: SourceRow<TRow>[],
  levels: PretableColumn<TRow>[],
  roots: Map<string, GroupNode<TRow>>,
  aggregateColumns: AggregateColumn<TRow>[],
): void {
  for (const entry of source) {
    // Read each aggregated cell once per row, not once per ancestor.
    const values = aggregateColumns.map(({ column }) =>
      readCellValue(entry.row, column),
    );

    let siblings: Map<string, GroupNode<TRow>> | null = roots;

    for (let depth = 0; depth < levels.length && siblings; depth += 1) {
      const key = stringifyGroupValue(readCellValue(entry.row, levels[depth]));
      const node: GroupNode<TRow> | undefined = siblings.get(key);

      // Reachable only via `allRows`: a group that exists pre-filter but not
      // post-filter is never materialized, so nothing below it is either.
      if (!node) break;

      for (let i = 0; i < aggregateColumns.length; i += 1) {
        const { column, aggregator } = aggregateColumns[i];
        const previous = node.accumulators.get(column.id);
        const acc = previous === undefined ? aggregator.init() : previous;
        node.accumulators.set(
          column.id,
          aggregator.accumulate(acc, values[i], entry.row),
        );
      }

      siblings = node.children;
    }
  }
}

function flatten<TRow extends PretableRow>(
  nodes: GroupNode<TRow>[],
  depth: number,
  model: GroupedRowModel<TRow>,
  groupExpansionOverrides: ReadonlySet<string>,
  defaultExpanded: boolean,
  out: PretableVisibleRow<TRow>[],
): void {
  for (const node of nodes) {
    out.push({
      kind: "group",
      id: node.id,
      depth: node.depth,
      columnId: node.columnId,
      value: node.value,
      childCount: node.childCount,
      aggregates: finalizeAggregates(node, model.aggregateColumns),
    });

    const expanded = groupExpansionOverrides.has(node.id)
      ? !defaultExpanded
      : defaultExpanded;

    if (!expanded) continue;

    if (node.children) {
      if (!node.orderedChildren) {
        node.orderedChildren = orderSiblings(
          node.children,
          model.levels[depth + 1],
          model.sort,
        );
      }

      flatten(
        node.orderedChildren,
        depth + 1,
        model,
        groupExpansionOverrides,
        defaultExpanded,
        out,
      );
      continue;
    }

    for (const entry of node.rows ?? []) {
      out.push({
        kind: "data",
        id: entry.id,
        row: entry.row,
        sourceIndex: entry.sourceIndex,
        depth: depth + 1,
      });
    }
  }
}

function finalizeAggregates<TRow extends PretableRow>(
  node: GroupNode<TRow>,
  aggregateColumns: AggregateColumn<TRow>[],
): Record<string, unknown> {
  if (node.finalizedAggregates) return node.finalizedAggregates;

  const aggregates: Record<string, unknown> = {};

  for (const { column, aggregator } of aggregateColumns) {
    const acc = node.accumulators.get(column.id);
    aggregates[column.id] = aggregator.finalize(
      acc === undefined ? aggregator.init() : acc,
    );
  }

  node.finalizedAggregates = aggregates;
  return aggregates;
}

/**
 * Order sibling groups by their key value. A sort entry on the grouping column
 * sets the direction; otherwise groups ascend. Sorting groups by an *aggregate*
 * is deliberately deferred.
 */
function orderSiblings<TRow extends PretableRow>(
  siblings: Map<string, GroupNode<TRow>>,
  column: PretableColumn<TRow> | undefined,
  sort: readonly PretableSortEntry[],
): GroupNode<TRow>[] {
  const nodes = [...siblings.values()];
  sortSiblings(nodes, column, sort);
  return nodes;
}

function sortSiblings<TRow extends PretableRow>(
  nodes: GroupNode<TRow>[],
  column: PretableColumn<TRow> | undefined,
  sort: readonly PretableSortEntry[],
): void {
  if (nodes.length < 2) return;

  const entry = column
    ? sort.find((candidate) => candidate.columnId === column.id)
    : undefined;
  const multiplier = entry?.direction === "desc" ? -1 : 1;
  const allNumeric = nodes.every((node) => typeof node.value === "number");

  nodes.sort((a, b) => {
    const cmp = allNumeric
      ? (a.value as number) - (b.value as number)
      : collator.compare(String(a.value ?? ""), String(b.value ?? ""));
    return cmp * multiplier;
  });
}
