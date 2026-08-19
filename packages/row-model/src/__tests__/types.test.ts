/* eslint-disable @typescript-eslint/no-unused-vars */
import { expect, test } from "vitest";
import {
  createColumnHelper,
  type ColumnIdOf,
  type ColumnsOf,
  type PretableAggregator,
  type PretableChangeOperation,
  type PretableChangeSequence,
  type PretableColumnDefinition,
  type PretableDerivationTransition,
  type PretableDerivationsFor,
  type PretableDistinctColumnIdOf,
  type PretableExpansionDefault,
  PretableDisposedModelError,
  type PretableGroupId,
  type PretableGroupKey,
  type PretableGroupRow,
  type PretableMutationIssue,
  type PretableMutationResult,
  type PretableQueryFor,
  type PretableQueryTransition,
  type PretableRowModel,
  PretableRowModelError,
  type PretableRowModelSnapshot,
  type PretableRowModelState,
  type PretableRowModelStatus,
  type PretableTransaction,
  type PretableVisibleRowRef,
  type RowIdOf,
  type RowOf,
} from "../index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

interface Holding {
  id: number;
  sector: string;
  quantity: number;
}

const column = createColumnHelper<Holding>();
const columns = [
  column.accessor("sector", {
    type: "text",
    format: ({ value, row, column }) => {
      const id: "sector" = column.id;
      return `${id}:${row.id}:${value.toUpperCase()}`;
    },
  }),
  column.accessor("quantity", {
    type: "number",
    aggregate: "sum",
    formatAggregate: ({ value, column }) => {
      const id: "quantity" = column.id;
      return `${id}:${value?.toLocaleString() ?? ""}`;
    },
  }),
] as const;

const computedColumn = column.accessor(
  "marketValue",
  (row) => row.quantity * 10,
  {
    type: "number",
    aggregate: "sum",
    format: ({ value, row, column }) => {
      const id: "marketValue" = column.id;
      return `${id}:${row.sector}:${value.toFixed(2)}`;
    },
    formatAggregate: ({ value, column }) => {
      const id: "marketValue" = column.id;
      return `${id}:${value?.toFixed(2) ?? ""}`;
    },
  },
);
void computedColumn;

const totalLabel: PretableAggregator<
  Holding,
  number,
  { total: number },
  string
> = {
  init: () => ({ total: 0 }),
  accumulate: (accumulator, value) => ({
    total: accumulator.total + value,
  }),
  merge: (left, right) => ({ total: left.total + right.total }),
  finalize: (accumulator) => String(accumulator.total),
};

const snapshottedTotal: PretableAggregator<
  Holding,
  number,
  { total: number },
  string
> = {
  init: () => ({ total: 0 }),
  accumulate: (accumulator, value) => ({
    total: accumulator.total + value,
  }),
  merge: (left, right) => ({ total: left.total + right.total }),
  snapshotAccumulator: (accumulator) => ({ total: accumulator.total }),
  finalize: (accumulator) => String(accumulator.total),
};
void snapshottedTotal;

const invalidSnapshotInput: PretableAggregator<
  Holding,
  number,
  { total: number },
  string
> = {
  init: () => ({ total: 0 }),
  accumulate: (accumulator, value) => ({
    total: accumulator.total + value,
  }),
  merge: (left, right) => ({ total: left.total + right.total }),
  // @ts-expect-error snapshot input is the exact accumulator type
  snapshotAccumulator: (accumulator: string) => ({
    total: accumulator.length,
  }),
  finalize: (accumulator) => String(accumulator.total),
};
void invalidSnapshotInput;

const invalidSnapshotOutput: PretableAggregator<
  Holding,
  number,
  { total: number },
  string
> = {
  init: () => ({ total: 0 }),
  accumulate: (accumulator, value) => ({
    total: accumulator.total + value,
  }),
  merge: (left, right) => ({ total: left.total + right.total }),
  // @ts-expect-error snapshot output must preserve the accumulator type
  snapshotAccumulator: () => "not an accumulator",
  finalize: (accumulator) => String(accumulator.total),
};
void invalidSnapshotOutput;
const customAggregateColumn = column.accessor("quantity", {
  type: "number",
  aggregate: totalLabel,
  formatAggregate: ({ value }) => value.toUpperCase(),
});
void customAggregateColumn;

const compatibleAverage: PretableAggregator<
  Holding,
  number,
  { sum: number; count: number },
  number | null
> = {
  init: () => ({ sum: 0, count: 0 }),
  accumulate: (accumulator, value) => ({
    sum: accumulator.sum + value,
    count: accumulator.count + 1,
  }),
  merge: (left, right) => ({
    sum: left.sum + right.sum,
    count: left.count + right.count,
  }),
  finalize: ({ sum, count }) => (count === 0 ? null : sum / count),
};
interface NarrowHolding extends Holding {
  extra: string;
}
const narrowerRowAggregate: PretableAggregator<
  NarrowHolding,
  number,
  number,
  number
> = {
  init: () => 0,
  accumulate: (accumulator, value, row) =>
    accumulator + value + row.extra.length,
  merge: (left, right) => left + right,
  finalize: (accumulator) => accumulator,
};
const narrowerValueAggregate: PretableAggregator<Holding, 1, number, number> = {
  init: () => 0,
  accumulate: (accumulator, value) => accumulator + value,
  merge: (left, right) => left + right,
  finalize: (accumulator) => accumulator,
};
column.accessor("quantity", {
  type: "number",
  // @ts-expect-error aggregate rows cannot require a narrower row shape
  aggregate: narrowerRowAggregate,
});
column.accessor("quantity", {
  type: "number",
  // @ts-expect-error aggregate values cannot require a narrower literal
  aggregate: narrowerValueAggregate,
});
const incompatibleTextAggregate: PretableAggregator<
  Holding,
  string,
  string[],
  string
> = {
  init: () => [],
  accumulate: (accumulator, value) => [...accumulator, value],
  merge: (left, right) => [...left, ...right],
  finalize: (accumulator) => accumulator.join(","),
};

const avgDerivations: PretableDerivationsFor<typeof columns> = [
  columns[0],
  { ...columns[1], aggregate: "avg" },
];
const freshAvgColumn = column.accessor("quantity", {
  type: "number",
  aggregate: "avg",
});
const freshAvgDerivations: PretableDerivationsFor<typeof columns> = [
  columns[0],
  freshAvgColumn,
];
const customDerivations: PretableDerivationsFor<typeof columns> = [
  columns[0],
  { ...columns[1], aggregate: compatibleAverage },
];
const badDerivations: PretableDerivationsFor<typeof columns> = [
  columns[0],
  {
    ...columns[1],
    // @ts-expect-error a numeric column rejects a text-input/string-output aggregate
    aggregate: incompatibleTextAggregate,
  },
];
void avgDerivations;
void freshAvgDerivations;
void customDerivations;
void badDerivations;

const addedAggregateColumn = column.accessor("sector", {
  type: "text",
  aggregate: "count",
});
const badAggregateCapability: PretableDerivationsFor<typeof columns> = [
  // @ts-expect-error a schema without an aggregate cannot add one in-place
  addedAggregateColumn,
  columns[1],
];

const changedValueColumn = null as unknown as PretableColumnDefinition<
  Holding,
  "quantity",
  string,
  "text"
>;
const badValueDerivations: PretableDerivationsFor<typeof columns> = [
  columns[0],
  // @ts-expect-error derivation accessors retain the schema's value type
  changedValueColumn,
];

const changedKindColumn = column.accessor("sector", { type: "enum" });
const badKindDerivations: PretableDerivationsFor<typeof columns> = [
  // @ts-expect-error derivation columns retain the schema's declared kind
  changedKindColumn,
  columns[1],
];

const incompatibleOutputAggregate: PretableAggregator<
  Holding,
  number,
  number,
  string
> = {
  init: () => 0,
  accumulate: (accumulator, value) => accumulator + value,
  merge: (left, right) => left + right,
  finalize: String,
};
const changedOutputColumn = column.accessor("quantity", {
  type: "number",
  aggregate: incompatibleOutputAggregate,
});
const badOutputDerivations: PretableDerivationsFor<typeof columns> = [
  columns[0],
  // @ts-expect-error replacement aggregates retain the schema's output type
  changedOutputColumn,
];
void badAggregateCapability;
void badValueDerivations;
void badKindDerivations;
void badOutputDerivations;

function exerciseCompatibleAggregate(
  derivation: PretableDerivationsFor<typeof columns>[1],
  row: Holding,
) {
  const aggregate = derivation.aggregate;
  if (typeof aggregate !== "object") return;

  const initial = aggregate.init();
  const accumulated = aggregate.accumulate(initial, row.quantity, row);
  const merged = aggregate.merge(initial, accumulated);
  const output: number | null = aggregate.finalize(merged);
  return output;
}
void exerciseCompatibleAggregate;

const typedGroupAggregates: PretableGroupRow<typeof columns>["aggregates"] = {
  quantity: 42,
};
const nullGroupAggregates: PretableGroupRow<typeof columns>["aggregates"] = {
  quantity: null,
};
const badAggregateValue: PretableGroupRow<typeof columns>["aggregates"] = {
  // @ts-expect-error sum aggregates produce number | null
  quantity: "42",
};
const badAggregateKey: PretableGroupRow<typeof columns>["aggregates"] = {
  quantity: 42,
  // @ts-expect-error only aggregate column IDs are accepted
  sector: "Energy",
};
void typedGroupAggregates;
void nullGroupAggregates;
void badAggregateValue;
void badAggregateKey;

const customAggregateColumns = [
  column.accessor("quantityLabel", (row) => row.quantity, {
    type: "number",
    aggregate: totalLabel,
  }),
] as const;
const typedCustomGroupAggregates: PretableGroupRow<
  typeof customAggregateColumns
>["aggregates"] = { quantityLabel: "42" };
void typedCustomGroupAggregates;

function narrowGroupRow(row: PretableGroupRow<typeof columns>) {
  const aggregate: number | null = row.aggregates.quantity;
  if (row.columnId === "sector") {
    const value: string = row.value;
    return `${value}:${aggregate ?? ""}`;
  }
  const columnId: "quantity" = row.columnId;
  const value: number = row.value;
  return `${columnId}:${value}:${aggregate ?? ""}`;
}
void narrowGroupRow;

// @ts-expect-error a quantity group cannot carry a string group value
const impossibleGroupRow: PretableGroupRow<typeof columns> = {
  kind: "group",
  groupId: "group:quantity:wrong" as PretableGroupId,
  depth: 0,
  columnId: "quantity",
  value: "wrong",
  childCount: 1,
  aggregates: { quantity: 1 },
  expanded: true,
};
void impossibleGroupRow;

type Ids = ColumnIdOf<typeof columns>;
type _ids = Expect<Equal<Ids, "sector" | "quantity">>;

const query = {
  filters: [{ columnId: "quantity", operator: "gte", value: 4 }],
  sort: [{ columnId: "sector", direction: "asc", nulls: "last" }],
  rowGroups: [{ columnId: "sector", direction: "asc" }],
} as const satisfies PretableQueryFor<typeof columns>;

type _groupKeyContract = Expect<
  Equal<
    PretableGroupKey,
    string | number | bigint | boolean | null | undefined
  >
>;
type _dateDistinctColumnContract = Expect<
  Equal<
    PretableDistinctColumnIdOf<
      readonly [{ readonly id: "when"; readonly accessor: () => Date }]
    >,
    never
  >
>;

interface MixedGroupKeys {
  id: number;
  supported: string | null;
  objectValue: { readonly label: string };
  symbolValue: symbol;
  functionValue: () => string;
  mixedValue: string | { readonly label: string };
}
const mixedGroupHelper = createColumnHelper<MixedGroupKeys>();
const mixedGroupColumns = [
  mixedGroupHelper.accessor("supported", { type: "text" }),
  mixedGroupHelper.accessor("objectValue", { type: "text" }),
  mixedGroupHelper.accessor("symbolValue", { type: "text" }),
  mixedGroupHelper.accessor("functionValue", { type: "text" }),
  mixedGroupHelper.accessor("mixedValue", { type: "text" }),
] as const;
const validGroupQuery: PretableQueryFor<typeof mixedGroupColumns> = {
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "supported" }],
};
const invalidObjectGroupQuery: PretableQueryFor<typeof mixedGroupColumns> = {
  filters: [],
  sort: [],
  // @ts-expect-error object-valued columns cannot be grouped
  rowGroups: [{ columnId: "objectValue" }],
};
const invalidSymbolGroupQuery: PretableQueryFor<typeof mixedGroupColumns> = {
  filters: [],
  sort: [],
  // @ts-expect-error symbol-valued columns cannot be grouped
  rowGroups: [{ columnId: "symbolValue" }],
};
const invalidFunctionGroupQuery: PretableQueryFor<typeof mixedGroupColumns> = {
  filters: [],
  sort: [],
  // @ts-expect-error function-valued columns cannot be grouped
  rowGroups: [{ columnId: "functionValue" }],
};
const invalidMixedGroupQuery: PretableQueryFor<typeof mixedGroupColumns> = {
  filters: [],
  sort: [],
  // @ts-expect-error every member of a group value union must be supported
  rowGroups: [{ columnId: "mixedValue" }],
};
void validGroupQuery;
void invalidObjectGroupQuery;
void invalidSymbolGroupQuery;
void invalidFunctionGroupQuery;
void invalidMixedGroupQuery;

const badOperatorQuery: PretableQueryFor<typeof columns> = {
  // @ts-expect-error number filters cannot use text-only contains
  filters: [{ columnId: "quantity", operator: "contains", value: 4 }],
  sort: [],
  rowGroups: [],
};
const badValueQuery: PretableQueryFor<typeof columns> = {
  // @ts-expect-error numeric comparison operators require numeric values
  filters: [{ columnId: "quantity", operator: "gte", value: "4" }],
  sort: [],
  rowGroups: [],
};
void badOperatorQuery;
void badValueQuery;

declare const model: PretableRowModel<Holding, number, typeof columns>;
type _row = Expect<Equal<RowOf<typeof model>, Holding>>;
type _rowId = Expect<Equal<RowIdOf<typeof model>, number>>;
type _columns = Expect<Equal<ColumnsOf<typeof model>, typeof columns>>;

interface OrdinaryRow {
  id: string;
  label: string;
}
declare const stringIdModel: PretableRowModel<OrdinaryRow, string, readonly []>;
type _ordinaryInterfaceNeedsNoIndexSignature = Expect<
  Equal<RowOf<typeof stringIdModel>, OrdinaryRow>
>;
type _stringId = Expect<Equal<RowIdOf<typeof stringIdModel>, string>>;

function narrowRef(ref: PretableVisibleRowRef<number>) {
  if (ref.kind === "data") {
    const id: number = ref.rowId;
    return id;
  }
  const id: PretableGroupId = ref.groupId;
  return id;
}
void narrowRef;

const statuses: readonly PretableRowModelStatus[] = [
  { kind: "ready" },
  { kind: "rebuilding", transitionId: 1, completedRows: 10, totalRows: 20 },
  {
    kind: "error",
    transitionId: 1,
    error: new PretableRowModelError("derivation-failed", "fixture", {
      operation: "set-query",
    }),
  },
  { kind: "disposed" },
];
void statuses;

const groupId = "group:sector:Energy" as PretableGroupId;
const issues: readonly PretableMutationIssue<number>[] = [
  { code: "unknown-update-id", rowId: 1 },
  { code: "unknown-remove-id", rowId: 2 },
  { code: "unknown-group-id", groupId },
];
const result: PretableMutationResult<number> = {
  previousRevision: 0,
  revision: 1,
  added: 1,
  updated: 1,
  removed: 0,
  unchanged: 0,
  ignored: 1,
  issues,
};
void result;

const transaction: PretableTransaction<Holding, number> = {
  add: [{ id: 3, sector: "Energy", quantity: 7 }],
  update: [{ id: 1, changes: { quantity: 5 } }],
  remove: [2],
};
void transaction;

const expansionPolicies: readonly PretableExpansionDefault[] = [
  { kind: "collapsed" },
  { kind: "expanded" },
  { kind: "through-depth", depth: 2 },
];
void expansionPolicies;

const dataRef = { kind: "data", rowId: 1 } as const;
const groupRef = { kind: "group", groupId } as const;
const operations: readonly PretableChangeOperation<number>[] = [
  { kind: "insert", ref: dataRef, index: 0 },
  { kind: "remove", ref: groupRef, previousIndex: 0 },
  { kind: "move", ref: dataRef, previousIndex: 1, index: 2 },
  { kind: "update", ref: groupRef, index: 0, fields: ["aggregates"] },
];
void operations;
const invalidInsert: PretableChangeOperation<number> = {
  kind: "insert",
  ref: dataRef,
  index: 0,
  // @ts-expect-error insert operations do not carry a previous index
  previousIndex: 0,
};
void invalidInsert;

const disposedChangesError = new PretableDisposedModelError("changes-since");

function assertOperationalSignatures(
  rowModel: PretableRowModel<Holding, number, typeof columns>,
  queryTransition: PretableQueryTransition<typeof columns>,
  derivations: PretableDerivationsFor<typeof columns>,
  derivationTransition: PretableDerivationTransition<typeof columns>,
  sequence: PretableChangeSequence<number>,
  snapshot: PretableRowModelSnapshot<Holding, number, typeof columns>,
  state: PretableRowModelState<Holding, number, typeof columns>,
) {
  const _columns: typeof columns = rowModel.getColumns();
  // Derivation replacement changes engine behavior, but presentation fallback
  // remains the exact original tuple returned by getColumns().
  rowModel.setDerivations(freshAvgDerivations);
  const _originalColumnsAfterDerivation: typeof columns = rowModel.getColumns();
  const _currentState: typeof state = rowModel.getState();
  const _mutation: PretableMutationResult<number> =
    rowModel.applyTransaction(transaction);
  rowModel.setRows([]);
  rowModel.setQuery(query);
  rowModel.setDerivations(derivations);
  rowModel.setGroupExpanded(groupId, true);
  rowModel.setExpansionDefault(
    { kind: "through-depth", depth: 1 },
    {
      preserveOverrides: true,
    },
  );
  rowModel.expandAll();
  rowModel.collapseAll();
  rowModel.changesSince(0);
  const _distinctFinished: Promise<unknown> = rowModel.distinctValues(
    "quantity",
    { population: "filtered", limit: 20 },
  ).finished;

  const _requestedQuery: PretableQueryFor<typeof columns> =
    queryTransition.requestedQuery;
  const _queryFinished: Promise<number> = queryTransition.finished;
  queryTransition.cancel();

  const _requestedDerivations: PretableDerivationsFor<typeof columns> =
    derivationTransition.requestedDerivations;

  if (sequence.kind === "changes") {
    const _from: number = sequence.fromRevision;
    void _from;
  } else {
    const _reason: "unknown-revision" | "journal-evicted" | "bulk-replace" =
      sequence.reason;
    void _reason;
  }

  const _visibleDataCount: number = snapshot.visibleDataRowCount;
  snapshot.rowAt(0);
  snapshot.range(0, 20);
  snapshot.indexOf(dataRef);
  snapshot.dataRowAt(0);
  snapshot.firstDataRow();
  snapshot.lastDataRow();
  snapshot.nextDataRow(dataRef);
  snapshot.previousDataRow(dataRef);
  snapshot.parentGroupOf(dataRef);
  snapshot.nearestVisibleRef(dataRef);
  snapshot.isGroupExpanded(groupId);

  const _stateSnapshot: typeof snapshot = state.snapshot;
  const _stateStatus: PretableRowModelStatus = state.status;

  const unsubscribe: () => void = rowModel.subscribe(() => undefined);
  unsubscribe();
  const disposeResult: void = rowModel.dispose();

  void derivations;
  void _columns;
  void _originalColumnsAfterDerivation;
  void _currentState;
  void _mutation;
  void _distinctFinished;
  void _requestedQuery;
  void _queryFinished;
  void _requestedDerivations;
  void _visibleDataCount;
  void _stateSnapshot;
  void _stateStatus;
  void disposeResult;
}
void assertOperationalSignatures;

test("the column helper retains runtime column IDs", () => {
  expect(columns.map((entry) => entry.id)).toEqual(["sector", "quantity"]);
  expect(query.filters[0]?.columnId).toBe("quantity");
});

test("the disposed error identifies changesSince", () => {
  expect(disposedChangesError.code).toBe("disposed-model");
  expect(disposedChangesError.operation).toBe("changes-since");
});
