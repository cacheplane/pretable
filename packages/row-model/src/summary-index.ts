import {
  compareWithSortKeys,
  filterVerdict,
  sortKeysOf,
  type CompiledAggregateDependency,
  type CompiledQuery,
} from "./compiled-query";
import { lowerCalendarDateAggregate } from "./calendar-date-aggregates";
import type { PretableAggregator, PretableRowId } from "./column-types";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import type { RevisionRoot, RowRecord } from "./internal-types";
import { rowPassesFilter } from "./filter-membership";
import {
  createAggregateTree,
  createScalarAggregateCell,
  instrumentAggregateTree,
  isScalarBuiltinAggregator,
  type AggregateTree,
  type AggregateTreeLeaf,
  type BuiltinAggregatorName,
} from "./persistent/aggregate-tree";
import type {
  PretableEngineSummary,
  PretableSummaryScope,
} from "./summary-types";

type Tree = AggregateTree<
  PretableRowId,
  object,
  unknown,
  CompiledAggregateDependency<unknown>,
  unknown
>;
type Leaf = AggregateTreeLeaf<
  PretableRowId,
  object,
  unknown,
  CompiledAggregateDependency<unknown>
>;
type Roots = ReadonlyMap<string, Tree>;
export interface SummaryIndex {
  readonly roots: Readonly<Partial<Record<PretableSummaryScope, Roots>>>;
  readonly results: Readonly<
    Partial<Record<PretableSummaryScope, PretableEngineSummary>>
  >;
}

type RuntimeAggregate =
  BuiltinAggregatorName | PretableAggregator<object, unknown, unknown, unknown>;
function emptyRoots<TColumns>(
  plan: CompiledQuery<TColumns>,
  instrumentation?: LocalRowModelInstrumentation,
): Roots {
  const roots = new Map<string, Tree>();
  for (const column of plan.derivations as readonly {
    readonly id: string;
    readonly type: string;
    readonly aggregate?: RuntimeAggregate;
  }[]) {
    if (column.aggregate === undefined) continue;
    const aggregate = lowerCalendarDateAggregate(
      column.type,
      column.aggregate,
    ) as RuntimeAggregate;
    const factory = createAggregateTree as unknown as (options: {
      columnId: string;
      aggregator: RuntimeAggregate;
      compare: (a: Leaf, b: Leaf) => number;
    }) => Tree;
    const tree = isScalarBuiltinAggregator(aggregate)
      ? createScalarAggregateCell<
          PretableRowId,
          object,
          unknown,
          CompiledAggregateDependency<unknown>
        >({ columnId: column.id, aggregator: aggregate })
      : factory({
          columnId: column.id,
          aggregator: aggregate,
          compare: (a, b) =>
            compareWithSortKeys(
              plan,
              {
                rowId: a.id,
                row: a.row,
                sourceOrder: a.dependency.sourceOrder,
              } as never,
              a.dependency.sortKeys as never,
              {
                rowId: b.id,
                row: b.row,
                sourceOrder: b.dependency.sourceOrder,
              } as never,
              b.dependency.sortKeys as never,
            ),
        });
    roots.set(column.id, instrumentAggregateTree(tree, instrumentation));
  }
  return roots;
}

function finish(roots: SummaryIndex["roots"]): SummaryIndex {
  const results: Partial<Record<PretableSummaryScope, PretableEngineSummary>> =
    {};
  for (const scope of ["all", "filtered"] as const) {
    const trees = roots[scope];
    if (trees === undefined) continue;
    const values: Record<string, unknown> = Object.create(null);
    for (const [id, tree] of trees) values[id] = tree.finalize();
    results[scope] = Object.freeze({ scope, values: Object.freeze(values) });
  }
  return Object.freeze({
    roots: Object.freeze(roots),
    results: Object.freeze(results),
  });
}

function contribute<TRow extends object, TId extends PretableRowId, TColumns>(
  roots: Roots,
  record: RowRecord<TRow, TId, TColumns>,
  plan: CompiledQuery<TColumns>,
  add: boolean,
  instrumentation?: LocalRowModelInstrumentation,
): Roots {
  if (instrumentation) instrumentation.work.summaryRowsVisited += 1;
  const next = new Map(roots);
  for (const entry of record.metadata.aggregateLeaves as readonly {
    columnId: string;
    allLeaf: Leaf;
  }[]) {
    const tree = next.get(entry.columnId);
    if (tree === undefined) continue;
    if (instrumentation) instrumentation.work.summaryCellsUpdated += 1;
    // Filter/sort-only transitions can carry metadata; the current plan owns ordering.
    const leaf = {
      ...entry.allLeaf,
      dependency: {
        sourceOrder: record.sourceOrder,
        sortKeys: sortKeysOf(plan, record as never) as never,
      },
    };
    next.set(
      entry.columnId,
      add ? tree.insertOrReplace(leaf) : tree.remove(record.rowId, leaf),
    );
  }
  return next;
}

/** Only affected records are visited, scalar cells apply exact inverse deltas. */
export function updateSummaryIndex<
  TRow extends object,
  TId extends PretableRowId,
  TColumns,
>(
  previous: RevisionRoot<TRow, TId, TColumns>,
  next: RevisionRoot<TRow, TId, TColumns>,
  ids: readonly TId[],
  instrumentation?: LocalRowModelInstrumentation,
): SummaryIndex | undefined {
  if (previous.summaries === undefined) return undefined;
  const roots = { ...previous.summaries.roots };
  for (const scope of ["all", "filtered"] as const) {
    let trees = roots[scope];
    if (trees === undefined) continue;
    for (const id of ids) {
      const old = previous.rows.get(id);
      const current = next.rows.get(id);
      if (old && (scope === "all" || rowPassesFilter(previous, id)))
        trees = contribute(
          trees,
          old,
          previous.queryPlan,
          false,
          instrumentation,
        );
      if (current && (scope === "all" || rowPassesFilter(next, id)))
        trees = contribute(
          trees,
          current,
          next.queryPlan,
          true,
          instrumentation,
        );
    }
    roots[scope] = trees;
  }
  return finish(roots);
}

export function retainSummaryScopes(
  index: SummaryIndex | undefined,
  scopes: readonly PretableSummaryScope[],
): SummaryIndex | undefined {
  if (index === undefined || scopes.length === 0) return undefined;
  const roots: Partial<Record<PretableSummaryScope, Roots>> = {};
  const results: Partial<Record<PretableSummaryScope, PretableEngineSummary>> =
    {};
  for (const scope of scopes) {
    roots[scope] = index.roots[scope];
    results[scope] = index.results[scope];
  }
  return Object.freeze({
    roots: Object.freeze(roots),
    results: Object.freeze(results),
  });
}

/** A private rebuild: one source record or replay record per cooperative step. */
export function createSummaryBuild<
  TRow extends object,
  TId extends PretableRowId,
  TColumns,
>(
  captured: RevisionRoot<TRow, TId, TColumns>,
  plan: CompiledQuery<TColumns>,
  scopes: readonly PretableSummaryScope[],
  instrumentation?: LocalRowModelInstrumentation,
) {
  let activeScopes = [...scopes];
  const roots: Partial<Record<PretableSummaryScope, Roots>> = {};
  for (const scope of activeScopes)
    roots[scope] = emptyRoots(plan, instrumentation);
  const records = new Map<
    TId,
    { record: RowRecord<TRow, TId, TColumns>; matches: boolean }
  >();
  let iterator:
    Iterator<readonly [TId, RowRecord<TRow, TId, TColumns>]> | undefined =
    captured.rows.entries();
  // Coalesce by identity and retain only the latest record, never revision roots.
  const deltas = new Map<TId, RowRecord<TRow, TId, TColumns> | undefined>();
  function replace(
    id: TId,
    original: RowRecord<TRow, TId, TColumns> | undefined,
  ) {
    const old = records.get(id);
    if (old)
      for (const scope of activeScopes)
        if (scope === "all" || old.matches)
          roots[scope] = contribute(
            roots[scope]!,
            old.record,
            plan,
            false,
            instrumentation,
          );
    records.delete(id);
    if (!original) return;
    const record =
      plan === captured.queryPlan
        ? original
        : {
            ...original,
            metadata: plan.evaluate({
              rowId: id,
              row: original.row as never,
              sourceOrder: original.sourceOrder,
              slot: original.slot,
            }) as unknown as RowRecord<TRow, TId, TColumns>["metadata"],
          };
    const matches = filterVerdict(plan, record as never);
    records.set(id, { record, matches });
    for (const scope of activeScopes)
      if (scope === "all" || matches)
        roots[scope] = contribute(
          roots[scope]!,
          record,
          plan,
          true,
          instrumentation,
        );
  }
  return {
    retainScopes(requested: readonly PretableSummaryScope[]) {
      activeScopes = activeScopes.filter((scope) => requested.includes(scope));
      for (const scope of ["all", "filtered"] as const)
        if (!activeScopes.includes(scope)) delete roots[scope];
    },
    append(target: RevisionRoot<TRow, TId, TColumns>, ids: readonly TId[]) {
      for (const id of ids) deltas.set(id, target.rows.get(id));
    },
    step(): boolean {
      if (iterator) {
        const item = iterator.next();
        if (!item.done) {
          replace(item.value[0], item.value[1]);
          return false;
        }
        iterator = undefined;
      }
      const delta = deltas.entries().next();
      if (!delta.done) {
        deltas.delete(delta.value[0]);
        replace(delta.value[0], delta.value[1]);
        return false;
      }
      return true;
    },
    finish() {
      return finish(roots);
    },
  };
}
