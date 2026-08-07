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
  /** Non-null only for the innermost level. */
  rows: SourceRow<TRow>[] | null;
  /** columnId -> in-progress accumulator. */
  accumulators: Map<string, unknown>;
}

interface AggregateColumn<TRow extends PretableRow> {
  column: PretableColumn<TRow>;
  aggregator: PretableAggregator;
}

export interface BuildGroupedRowsArgs<TRow extends PretableRow> {
  /** Post-filter rows, in source order. */
  rows: SourceRow<TRow>[];
  /**
   * Pre-filter rows. Supplied when `aggregateFilteredRows` is on, so aggregates
   * fold over rows the active filter hides. Group structure and `childCount`
   * always come from `rows`.
   */
  allRows?: SourceRow<TRow>[];
  columns: PretableColumn<TRow>[];
  /** Grouping columns, outermost first. Unknown ids are ignored. */
  rowGroups: string[];
  sort: PretableSortEntry[];
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

/** @internal */
export function buildGroupedRows<TRow extends PretableRow>(
  args: BuildGroupedRowsArgs<TRow>,
): PretableVisibleRow<TRow>[] {
  const { rows, allRows, columns, rowGroups, sort } = args;

  const sorted = sortRows(rows, columns, sort);
  const levels = resolveLevels(columns, rowGroups);

  if (levels.length === 0) {
    return sorted.map(({ id, row, sourceIndex }) => ({
      kind: "data" as const,
      id,
      row,
      sourceIndex,
      depth: 0,
    }));
  }

  const roots = buildTree(sorted, levels);
  const aggregateColumns = resolveAggregateColumns(columns);

  if (aggregateColumns.length > 0) {
    accumulate(allRows ?? sorted, levels, roots, aggregateColumns);
  }

  const out: PretableVisibleRow<TRow>[] = [];
  flatten(roots, 0, levels, aggregateColumns, args, out);
  return out;
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
          rows: isLeafLevel ? [] : null,
          accumulators: new Map(),
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
  siblings: Map<string, GroupNode<TRow>>,
  depth: number,
  levels: PretableColumn<TRow>[],
  aggregateColumns: AggregateColumn<TRow>[],
  args: BuildGroupedRowsArgs<TRow>,
  out: PretableVisibleRow<TRow>[],
): void {
  const nodes = [...siblings.values()];
  sortSiblings(nodes, levels[depth], args.sort);

  for (const node of nodes) {
    out.push({
      kind: "group",
      id: node.id,
      depth: node.depth,
      columnId: node.columnId,
      value: node.value,
      childCount: node.childCount,
      aggregates: finalizeAggregates(node, aggregateColumns),
    });

    if (!isExpanded(node.id, args)) continue;

    if (node.children) {
      flatten(node.children, depth + 1, levels, aggregateColumns, args, out);
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
  const aggregates: Record<string, unknown> = {};

  for (const { column, aggregator } of aggregateColumns) {
    const acc = node.accumulators.get(column.id);
    aggregates[column.id] = aggregator.finalize(
      acc === undefined ? aggregator.init() : acc,
    );
  }

  return aggregates;
}

function isExpanded<TRow extends PretableRow>(
  id: string,
  args: BuildGroupedRowsArgs<TRow>,
): boolean {
  return args.groupExpansionOverrides.has(id)
    ? !args.defaultExpanded
    : args.defaultExpanded;
}

/**
 * Order sibling groups by their key value. A sort entry on the grouping column
 * sets the direction; otherwise groups ascend. Sorting groups by an *aggregate*
 * is deliberately deferred.
 */
function sortSiblings<TRow extends PretableRow>(
  nodes: GroupNode<TRow>[],
  column: PretableColumn<TRow> | undefined,
  sort: PretableSortEntry[],
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
