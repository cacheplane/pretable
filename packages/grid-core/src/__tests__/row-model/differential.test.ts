import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableExpansionDefault,
  type PretableGroupId,
  type PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import type { SourceRow } from "../../row-utils";
import type {
  ColumnFilter,
  PretableColumn,
  PretableSortEntry,
} from "../../types";
import {
  APPROVED_INTENTIONAL_DIFFERENCES,
  operationArbitrary,
  scenarioArbitrary,
  transitionScenarioArbitrary,
  type DifferentialDerivations,
  type DifferentialOperation,
  type DifferentialQuery,
  type DifferentialRow,
  type DifferentialRowId,
} from "./arbitraries";
import { runLegacyOracle } from "./oracle";

const SEQUENTIAL_SEED = 0x5eed_1301;
const SEQUENTIAL_EXTRA_SEEDS = [0x5eed_1311, 0x5eed_1312] as const;
const TRANSITION_SEED = 0x5eed_1303;
const TRANSITION_EXTRA_SEEDS = [0x5eed_1313, 0x5eed_1314] as const;
const helper = createColumnHelper<DifferentialRow>();
const modelColumns = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("analyst", { type: "text" }),
  helper.accessor("quantity", { type: "number", aggregate: "sum" }),
  helper.accessor("label", { type: "text" }),
] as const;
const legacyColumns: readonly PretableColumn<DifferentialRow>[] = [
  { id: "sector", header: "Sector" },
  { id: "analyst", header: "Analyst" },
  { id: "quantity", header: "Quantity", type: "number", aggregate: "sum" },
  { id: "label", header: "Label", type: "text" },
];

interface ReferenceState {
  rows: Map<DifferentialRowId, { row: DifferentialRow; sourceOrder: number }>;
  nextSourceOrder: number;
  query: DifferentialQuery;
  expansion: {
    default: PretableExpansionDefault;
    overrides: Map<string, boolean>;
  };
  revision: number;
  notifications: number;
  aggregateFilteredRows: boolean;
  derivations: DifferentialDerivations;
}

function uniqueRows(
  rows: readonly DifferentialRow[],
): readonly DifferentialRow[] {
  const seen = new Set<DifferentialRowId>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function modelQuery(query: DifferentialQuery) {
  return {
    filters: query.filters,
    sort: query.sort,
    rowGroups: query.rowGroups,
  };
}

const CUSTOM_TOTAL_AGGREGATOR = Object.freeze({
  init: () => 0,
  accumulate: (accumulator: number, value: number) => accumulator + value + 1,
  merge: (left: number, right: number) => left + right,
  finalize: (accumulator: number): number | null => accumulator,
});
const ABSOLUTE_QUANTITY_ACCESSOR = (row: DifferentialRow) =>
  Math.abs(row.quantity);
const REVERSE_SECTOR_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const REVERSE_SECTOR_COMPARATOR = (left: string, right: string) =>
  REVERSE_SECTOR_COLLATOR.compare(right, left);

const MODEL_DERIVATIONS = {
  sum: modelColumns,
  avg: [
    modelColumns[0],
    modelColumns[1],
    { ...modelColumns[2], aggregate: "avg" as const },
    modelColumns[3],
  ],
  "custom-total": [
    modelColumns[0],
    modelColumns[1],
    { ...modelColumns[2], aggregate: CUSTOM_TOTAL_AGGREGATOR },
    modelColumns[3],
  ],
  "absolute-quantity": [
    modelColumns[0],
    modelColumns[1],
    {
      ...modelColumns[2],
      accessor: ABSOLUTE_QUANTITY_ACCESSOR,
      value: ABSOLUTE_QUANTITY_ACCESSOR,
    },
    modelColumns[3],
  ],
  "reverse-sector": [
    {
      ...modelColumns[0],
      compare: REVERSE_SECTOR_COMPARATOR,
    },
    modelColumns[1],
    modelColumns[2],
    modelColumns[3],
  ],
} as const;

function modelDerivations(mode: DifferentialDerivations) {
  return MODEL_DERIVATIONS[mode];
}

function derivationChangeAffectsQuery(
  previous: DifferentialDerivations,
  next: DifferentialDerivations,
  query: DifferentialQuery,
): boolean {
  const sectorOrdered = [...query.sort, ...query.rowGroups].some(
    (entry) => entry.columnId === "sector",
  );
  const aggregateKind = (mode: DifferentialDerivations) =>
    mode === "avg" ? "avg" : mode === "custom-total" ? "custom" : "sum";
  return (
    (previous === "absolute-quantity") !== (next === "absolute-quantity") ||
    (sectorOrdered &&
      (previous === "reverse-sector") !== (next === "reverse-sector")) ||
    aggregateKind(previous) !== aggregateKind(next)
  );
}

function legacyColumnsFor(mode: DifferentialDerivations) {
  const columns = [
    legacyColumns[0],
    legacyColumns[1],
    {
      ...legacyColumns[2],
      aggregate:
        mode === "custom-total"
          ? CUSTOM_TOTAL_AGGREGATOR
          : mode === "avg"
            ? "avg"
            : "sum",
    },
    legacyColumns[3],
  ] as PretableColumn<DifferentialRow>[];
  if (mode === "absolute-quantity") {
    columns[2] = {
      ...columns[2],
      aggregate: "sum",
      value: ABSOLUTE_QUANTITY_ACCESSOR,
    };
  } else if (mode === "reverse-sector") {
    columns[2] = { ...columns[2], aggregate: "sum" };
  }
  return columns;
}

function oracleRowId(id: DifferentialRowId): string {
  return `${typeof id === "number" ? "n" : "s"}:${String(id)}`;
}

function matchesEmptyTextNeedle(value: unknown, operator: string): boolean {
  const cell = String(value ?? "").toLocaleLowerCase();
  if (operator === "contains") return cell.includes("");
  if (operator === "notContains") return !cell.includes("");
  if (operator === "startsWith") return cell.startsWith("");
  if (operator === "endsWith") return cell.endsWith("");
  if (operator === "equals") return cell === "";
  if (operator === "notEquals") return cell !== "";
  throw new Error(`Unsupported empty text filter operator ${operator}.`);
}

function legacyRows(state: ReferenceState, fullyExpanded = false) {
  const originalIds = new Map<string, DifferentialRowId>();
  const rows: SourceRow<DifferentialRow>[] = [...state.rows.values()]
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map(({ row, sourceOrder }) => {
      const id = oracleRowId(row.id);
      originalIds.set(id, row.id);
      return { id, row, sourceIndex: sourceOrder };
    });
  const columns = legacyColumnsFor(state.derivations);
  const filters: Record<string, ColumnFilter> = {};

  // The frozen projector stores one filter per column. Duplicate lightweight
  // adapter columns preserve the new engine's ordered AND semantics, including
  // multiple filters on the same real column, without changing the oracle.
  state.query.filters.forEach((filter, index) => {
    const source = columns.find((column) => column.id === filter.columnId);
    if (source === undefined) throw new Error("oracle adapter lost a column");
    const id = `__filter__${index}`;
    const emptyTextNeedle = "value" in filter && filter.value === "";
    columns.push({
      ...source,
      id,
      aggregate: undefined,
      value: (row) => {
        const value =
          source.value === undefined ? row[source.id] : source.value(row);
        return emptyTextNeedle
          ? matchesEmptyTextNeedle(value, filter.operator)
            ? "__match__"
            : "__miss__"
          : value;
      },
    });
    if (emptyTextNeedle) {
      // The frozen projector treats a blank operand as inactive. Feed it a
      // non-blank match sentinel computed from the incremental engine's exact
      // String(value ?? "") empty-needle truth table instead.
      filters[id] = { operator: "equals", value: "__match__" };
    } else {
      filters[id] =
        "value" in filter
          ? { operator: filter.operator, value: filter.value }
          : { operator: filter.operator };
    }
  });

  // A legacy group takes its direction from the first sort on that column.
  // Putting independently directed groups first changes only sibling-group
  // order: all such keys are constant inside an innermost leaf group.
  const sort: PretableSortEntry[] = [
    ...state.query.rowGroups.map(({ columnId, direction }) => ({
      columnId,
      direction:
        state.derivations === "reverse-sector" && columnId === "sector"
          ? direction === "asc"
            ? ("desc" as const)
            : ("asc" as const)
          : direction,
    })),
  ];
  state.query.sort.forEach(({ columnId, direction, nulls }, index) => {
    const source = columns.find((column) => column.id === columnId);
    if (source === undefined)
      throw new Error("oracle adapter lost a sort column");
    const nullRankId = `__null_sort__${index}`;
    columns.push({
      ...source,
      id: nullRankId,
      aggregate: undefined,
      value: (row) => {
        const value =
          source.value === undefined ? row[source.id] : source.value(row);
        const isNull =
          value === null ||
          value === undefined ||
          (typeof value === "number" && Number.isNaN(value));
        return isNull
          ? (nulls ?? "last") === "first"
            ? 0
            : 1
          : (nulls ?? "last") === "first"
            ? 1
            : 0;
      },
    });
    sort.push({ columnId: nullRankId, direction: "asc" });
    sort.push({
      columnId,
      direction:
        state.derivations === "reverse-sector" && columnId === "sector"
          ? direction === "asc"
            ? "desc"
            : "asc"
          : direction,
    });
  });
  const expected = runLegacyOracle({
    columns,
    rows,
    filters,
    sort,
    rowGroups: state.query.rowGroups.map(({ columnId }) => columnId),
    aggregateFilteredRows: state.aggregateFilteredRows,
    expansion: fullyExpanded
      ? { default: { kind: "expanded" } }
      : state.expansion,
  });
  return expected.map((row) =>
    row.kind === "data"
      ? {
          ...row,
          ref: {
            kind: "data" as const,
            rowId: originalIds.get(row.ref.rowId),
          },
        }
      : row,
  );
}

function normalizedIncremental(
  row: ReturnType<typeof incrementalRows>[number],
) {
  return row.kind === "data"
    ? {
        kind: "data" as const,
        ref: { kind: "data" as const, rowId: row.rowId },
        row: row.row,
        sourceIndex: row.sourceIndex,
        depth: row.depth,
      }
    : {
        kind: "group" as const,
        ref: { kind: "group" as const, groupId: row.groupId },
        depth: row.depth,
        columnId: row.columnId,
        value: row.value,
        childCount: row.childCount,
        aggregates: row.aggregates,
        expanded: row.expanded,
      };
}

function incrementalRows(model: ReturnType<typeof createModel>) {
  const snapshot = model.getState().snapshot;
  return snapshot.range(0, snapshot.visibleRowCount);
}

function refOf(row: ReturnType<typeof legacyRows>[number]) {
  return row.ref as PretableVisibleRowRef<DifferentialRowId>;
}

function groupAncestors(
  rows: readonly ReturnType<typeof legacyRows>[number][],
) {
  const ancestors = new Map<string, readonly PretableGroupId[]>();
  const stack: PretableGroupId[] = [];
  for (const row of rows) {
    stack.length = row.depth;
    ancestors.set(JSON.stringify(row.ref), [...stack]);
    if (row.kind === "group") stack[row.depth] = row.ref.groupId;
  }
  return ancestors;
}

function assertSnapshot(
  model: ReturnType<typeof createModel>,
  state: ReferenceState,
  status: "ready" | "rebuilding" = "ready",
): void {
  const snapshot = model.getState().snapshot;
  expect(model.getState().status.kind).toBe(status);
  const expected = legacyRows(state);
  const actual = incrementalRows(model).map(normalizedIncremental);
  expect(actual).toEqual(expected);
  expect(snapshot.revision).toBe(state.revision);
  expect(snapshot.sourceRowCount).toBe(state.rows.size);
  expect(snapshot.visibleRowCount).toBe(expected.length);
  const expectedData = expected.filter((row) => row.kind === "data");
  expect(snapshot.visibleDataRowCount).toBe(expectedData.length);
  expect(snapshot.query).toEqual(modelQuery(state.query));
  expect(snapshot.expansion).toEqual({
    default: state.expansion.default,
    overrideCount: state.expansion.overrides.size,
  });

  expect(
    Array.from({ length: expected.length + 2 }, (_, index) =>
      snapshot.rowAt(index - 1),
    ),
  ).toEqual([undefined, ...incrementalRows(model), undefined]);
  for (let start = -2; start <= expected.length + 2; start += 3) {
    const end = start + 4;
    expect(snapshot.range(start, end)).toEqual(
      incrementalRows(model).slice(
        Math.max(0, start),
        Math.max(0, Math.min(expected.length, end)),
      ),
    );
  }
  expected.forEach((row, index) => {
    expect(snapshot.indexOf(refOf(row))).toBe(index);
  });
  const absentData = { kind: "data" as const, rowId: "__absent__" };
  const absentGroup = {
    kind: "group" as const,
    groupId: "__group__:sector=s:Missing" as PretableGroupId,
  };
  expect(snapshot.indexOf(absentData)).toBe(-1);
  expect(snapshot.indexOf(absentGroup)).toBe(-1);
  expect(snapshot.previousDataRow(absentData)).toBeUndefined();
  expect(snapshot.nextDataRow(absentData)).toBeUndefined();
  expect(snapshot.parentGroupOf(absentData)).toBeUndefined();
  expect(snapshot.nearestVisibleRef(absentData)).toBeUndefined();
  expect(snapshot.nearestVisibleRef(absentGroup)).toBeUndefined();
  expectedData.forEach((row, index) => {
    expect(snapshot.dataRowAt(index)).toMatchObject({ rowId: row.ref.rowId });
  });
  expect(snapshot.dataRowAt(-1)).toBeUndefined();
  expect(snapshot.dataRowAt(expectedData.length)).toBeUndefined();
  expect(snapshot.firstDataRow()?.rowId).toBe(expectedData[0]?.ref.rowId);
  expect(snapshot.lastDataRow()?.rowId).toBe(expectedData.at(-1)?.ref.rowId);

  const visibleAncestors = groupAncestors(expected);
  expected.forEach((row, index) => {
    const before = expected
      .slice(0, index)
      .reverse()
      .find((candidate) => candidate.kind === "data");
    const after = expected
      .slice(index + 1)
      .find((candidate) => candidate.kind === "data");
    expect(snapshot.previousDataRow(refOf(row))?.rowId).toBe(
      before?.kind === "data" ? before.ref.rowId : undefined,
    );
    expect(snapshot.nextDataRow(refOf(row))?.rowId).toBe(
      after?.kind === "data" ? after.ref.rowId : undefined,
    );
    const parent = visibleAncestors.get(JSON.stringify(row.ref))?.at(-1);
    expect(snapshot.parentGroupOf(refOf(row))?.groupId).toBe(parent);
    expect(snapshot.nearestVisibleRef(refOf(row))).toEqual(row.ref);
  });

  const visibleRefs = new Set(expected.map((row) => JSON.stringify(row.ref)));
  const full = legacyRows(state, true);
  const fullAncestors = groupAncestors(full);
  for (const row of full) {
    if (row.kind === "group") {
      const override = state.expansion.overrides.get(row.ref.groupId);
      const defaultExpanded =
        state.expansion.default.kind === "expanded" ||
        (state.expansion.default.kind === "through-depth" &&
          row.depth <= state.expansion.default.depth);
      expect(snapshot.isGroupExpanded(row.ref.groupId)).toBe(
        override ?? defaultExpanded,
      );
    }
    if (visibleRefs.has(JSON.stringify(row.ref))) continue;
    const nearest = [...(fullAncestors.get(JSON.stringify(row.ref)) ?? [])]
      .reverse()
      .find((groupId: PretableGroupId) =>
        visibleRefs.has(JSON.stringify({ kind: "group", groupId })),
      );
    expect(snapshot.nearestVisibleRef(refOf(row))).toEqual(
      nearest === undefined ? undefined : { kind: "group", groupId: nearest },
    );
  }
}

function createModel(
  rows: readonly DifferentialRow[],
  query: DifferentialQuery,
  aggregateFilteredRows = false,
  derivations: DifferentialDerivations = "sum",
  scheduler?: ManualScheduler,
) {
  let tick = 0;
  return createLocalRowModel({
    rows,
    columns: modelColumns,
    derivations: modelDerivations(derivations),
    initialExpansion: { kind: "expanded" },
    query: modelQuery(query),
    aggregateFilteredRows,
    transitionScheduler: scheduler,
    transitionClock: scheduler === undefined ? undefined : () => tick++,
    transitionBudgetMs: scheduler === undefined ? undefined : 1,
  });
}

class ManualScheduler {
  readonly entries: { task: () => void; cancelled: boolean }[] = [];

  schedule(task: () => void): () => void {
    const entry = { task, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  }

  flushOne(): boolean {
    const entry = this.entries.shift();
    if (entry === undefined) return false;
    if (!entry.cancelled) entry.task();
    return true;
  }
}

function flushTransitionPrefixes(
  model: ReturnType<typeof createModel>,
  state: ReferenceState,
  scheduler: ManualScheduler | undefined,
): void {
  if (scheduler === undefined) return;
  while (scheduler.entries.length > 0) {
    const before = model.getState();
    const oldRevision = before.snapshot.revision;
    const oldRows = before.snapshot.range(0, before.snapshot.visibleRowCount);
    scheduler.flushOne();
    const after = model.getState();
    if (after !== before) state.notifications += 1;
    expect(before.snapshot.range(0, before.snapshot.visibleRowCount)).toEqual(
      oldRows,
    );
    if (after.status.kind === "rebuilding") {
      expect(after.snapshot).toBe(before.snapshot);
      expect(after.snapshot.revision).toBe(oldRevision);
      assertSnapshot(model, state, "rebuilding");
    } else {
      expect(after.status.kind).toBe("ready");
      expect(after.snapshot.revision).toBe(oldRevision + 1);
    }
  }
}

function expectedMutation(
  state: ReferenceState,
  changed: boolean,
  counts: Partial<{
    added: number;
    updated: number;
    removed: number;
    unchanged: number;
    ignored: number;
  }> = {},
) {
  const previousRevision = state.revision;
  if (changed) {
    state.revision += 1;
    state.notifications += 1;
  }
  return {
    previousRevision,
    revision: state.revision,
    added: counts.added ?? 0,
    updated: counts.updated ?? 0,
    removed: counts.removed ?? 0,
    unchanged: counts.unchanged ?? 0,
    ignored: counts.ignored ?? 0,
  };
}

async function applyOperation(
  model: ReturnType<typeof createModel>,
  state: ReferenceState,
  operation: DifferentialOperation,
  scheduler?: ManualScheduler,
): Promise<void> {
  const before = model.getState();
  switch (operation.kind) {
    case "add": {
      if (state.rows.has(operation.row.id)) {
        expect(() => model.applyTransaction({ add: [operation.row] })).toThrow(
          expect.objectContaining({ code: "existing-row-id" }),
        );
        expect(model.getState()).toBe(before);
        return;
      }
      const result = model.applyTransaction({ add: [operation.row] });
      state.rows.set(operation.row.id, {
        row: operation.row,
        sourceOrder: state.nextSourceOrder++,
      });
      expect(result).toMatchObject(expectedMutation(state, true, { added: 1 }));
      return;
    }
    case "update": {
      const previous = state.rows.get(operation.id);
      if (previous === undefined) {
        const result = model.applyTransaction({
          update: [{ id: operation.id, changes: operation.changes }],
        });
        expect(result).toMatchObject(
          expectedMutation(state, false, { ignored: 1 }),
        );
        expect(result.issues).toEqual([
          { code: "unknown-update-id", rowId: operation.id },
        ]);
        return;
      }
      const next = { ...previous.row, ...operation.changes };
      const changed = Object.keys(operation.changes).some(
        (key) =>
          !Object.is(
            previous.row[key as keyof DifferentialRow],
            next[key as keyof DifferentialRow],
          ),
      );
      const result = model.applyTransaction({
        update: [{ id: operation.id, changes: operation.changes }],
      });
      if (changed) state.rows.set(operation.id, { ...previous, row: next });
      expect(result).toMatchObject(
        expectedMutation(state, changed, {
          updated: changed ? 1 : 0,
          unchanged: changed ? 0 : 1,
        }),
      );
      return;
    }
    case "remove": {
      const existed = state.rows.delete(operation.id);
      const result = model.applyTransaction({ remove: [operation.id] });
      expect(result).toMatchObject(
        expectedMutation(state, existed, {
          removed: existed ? 1 : 0,
          ignored: existed ? 0 : 1,
        }),
      );
      expect(result.issues).toEqual(
        existed ? [] : [{ code: "unknown-remove-id", rowId: operation.id }],
      );
      return;
    }
    case "setRows": {
      const duplicate = operation.rows.find(
        (row, index) =>
          operation.rows.findIndex((candidate) => candidate.id === row.id) !==
          index,
      );
      if (duplicate !== undefined) {
        expect(() => model.setRows(operation.rows)).toThrow(
          expect.objectContaining({ code: "duplicate-row-id" }),
        );
        expect(model.getState()).toBe(before);
        return;
      }
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      operation.rows.forEach((row, sourceOrder) => {
        const previous = state.rows.get(row.id);
        if (previous === undefined) added += 1;
        else if (
          Object.is(previous.row, row) &&
          previous.sourceOrder === sourceOrder
        )
          unchanged += 1;
        else updated += 1;
      });
      const removed = [...state.rows.keys()].filter(
        (id) => !operation.rows.some((row) => row.id === id),
      ).length;
      const changed = added + updated + removed > 0;
      const result = model.setRows(operation.rows);
      state.rows = new Map(
        operation.rows.map((row, sourceOrder) => [
          row.id,
          { row, sourceOrder },
        ]),
      );
      state.nextSourceOrder = Math.max(
        state.nextSourceOrder,
        operation.rows.length,
      );
      expect(result).toMatchObject(
        expectedMutation(state, changed, {
          added,
          updated,
          removed,
          unchanged,
        }),
      );
      return;
    }
    case "setQuery": {
      const changed =
        JSON.stringify(state.query) !== JSON.stringify(operation.query);
      const transition = model.setQuery(modelQuery(operation.query));
      if (model.getState() !== before) state.notifications += 1;
      flushTransitionPrefixes(model, state, scheduler);
      const revision = await transition.finished;
      if (changed) {
        state.query = operation.query;
        state.revision += 1;
      }
      expect(revision).toBe(state.revision);
      return;
    }
    case "setDerivations": {
      const changed = state.derivations !== operation.derivations;
      const rebuild =
        changed &&
        derivationChangeAffectsQuery(
          state.derivations,
          operation.derivations,
          state.query,
        );
      const transition = model.setDerivations(
        modelDerivations(operation.derivations),
      );
      if (model.getState() !== before) state.notifications += 1;
      flushTransitionPrefixes(model, state, scheduler);
      const revision = await transition.finished;
      if (changed) {
        state.derivations = operation.derivations;
        if (rebuild) state.revision += 1;
      }
      expect(revision).toBe(state.revision);
      return;
    }
    case "invalidQuery": {
      const invalid =
        operation.fault === "operator"
          ? {
              filters: [{ columnId: "quantity", operator: "wat", value: 0 }],
              sort: [],
              rowGroups: [],
            }
          : operation.fault === "column"
            ? {
                filters: [],
                sort: [{ columnId: "missing", direction: "asc" }],
                rowGroups: [],
              }
            : {
                filters: [],
                sort: [{ columnId: "quantity", direction: "sideways" }],
                rowGroups: [],
              };
      expect(() => model.setQuery(invalid as never)).toThrow(
        expect.objectContaining({
          code: "invalid-query",
        }),
      );
      expect(model.getState()).toBe(before);
      return;
    }
    case "duplicateTransaction": {
      const duplicateId = `__duplicate__:${typeof operation.id}:${String(operation.id)}`;
      const row = {
        id: duplicateId,
        sector: "S0",
        analyst: "Ada",
        quantity: 0,
        label: "duplicate",
      };
      const transaction =
        operation.duplicate === "add"
          ? { add: [row, { ...row }] }
          : operation.duplicate === "update"
            ? {
                update: [
                  { id: duplicateId, changes: { quantity: 1 } },
                  { id: duplicateId, changes: { quantity: 2 } },
                ],
              }
            : operation.duplicate === "remove"
              ? { remove: [duplicateId, duplicateId] }
              : { add: [row], remove: [duplicateId] };
      if (
        operation.duplicate === "update" ||
        operation.duplicate === "remove"
      ) {
        const result = model.applyTransaction(transaction);
        expect(result).toMatchObject(
          expectedMutation(state, false, { ignored: 1 }),
        );
        expect(result.issues).toEqual([
          {
            code:
              operation.duplicate === "update"
                ? "unknown-update-id"
                : "unknown-remove-id",
            rowId: duplicateId,
          },
        ]);
        expect(model.getState()).toBe(before);
        return;
      }
      expect(() => model.applyTransaction(transaction)).toThrow(
        expect.objectContaining({
          code:
            operation.duplicate === "add"
              ? "duplicate-row-id"
              : "transaction-conflict",
          operation: "apply-transaction",
        }),
      );
      expect(model.getState()).toBe(before);
      return;
    }
    case "toggleGroup": {
      const groups = legacyRows(state, true).filter(
        (row) => row.kind === "group",
      );
      const group = groups[operation.selector % Math.max(1, groups.length)];
      if (group?.kind !== "group") return;
      const current = state.expansion.overrides.get(group.ref.groupId);
      const defaultExpanded =
        state.expansion.default.kind === "expanded" ||
        (state.expansion.default.kind === "through-depth" &&
          group.depth <= state.expansion.default.depth);
      const desired = !(current ?? defaultExpanded);
      const result = model.setGroupExpanded(group.ref.groupId, desired);
      if (desired === defaultExpanded)
        state.expansion.overrides.delete(group.ref.groupId);
      else state.expansion.overrides.set(group.ref.groupId, desired);
      expect(result).toMatchObject(expectedMutation(state, true));
      return;
    }
    case "setExpansionDefault": {
      const changed =
        JSON.stringify(state.expansion.default) !==
          JSON.stringify(operation.policy) ||
        state.expansion.overrides.size > 0;
      const result = model.setExpansionDefault(operation.policy);
      state.expansion.default = operation.policy;
      state.expansion.overrides.clear();
      expect(result).toMatchObject(expectedMutation(state, changed));
      return;
    }
    case "expandAll":
    case "collapseAll": {
      const expanded = operation.kind === "expandAll";
      const policy = { kind: expanded ? "expanded" : "collapsed" } as const;
      const changed =
        state.expansion.default.kind !== policy.kind ||
        state.expansion.overrides.size > 0;
      const result = expanded ? model.expandAll() : model.collapseAll();
      state.expansion.default = policy;
      state.expansion.overrides.clear();
      expect(result).toMatchObject(expectedMutation(state, changed));
      return;
    }
    case "conflict": {
      const row = state.rows.get(operation.id)?.row ?? {
        id: operation.id,
        sector: "S0",
        analyst: "Ada",
        quantity: 0,
        label: "conflict",
      };
      expect(() =>
        model.applyTransaction({ add: [row], remove: [operation.id] }),
      ).toThrow(expect.objectContaining({ code: "transaction-conflict" }));
      expect(model.getState()).toBe(before);
    }
  }
}

describe("incremental row model differential properties", () => {
  test("the fixed replay domain covers the compatibility boundaries", () => {
    const samples = fc.sample(scenarioArbitrary, {
      seed: 0x5eed_1310,
      numRuns: 250,
    }) as readonly {
      rows: readonly DifferentialRow[];
      query: {
        filters?: readonly { columnId: string }[];
        sort?: readonly {
          columnId: string;
          nulls?: "first" | "last";
        }[];
        rowGroups?: readonly { direction?: string }[];
      };
      operations: readonly { kind: string; derivations?: string }[];
    }[];
    const operations = samples.flatMap((sample) => sample.operations);

    expect(
      samples.some((sample) =>
        sample.rows.some((row) => typeof row.id === "number"),
      ),
    ).toBe(true);
    expect(
      samples.some((sample) => {
        const filters = sample.query.filters ?? [];
        return filters.some(
          (filter, index) =>
            filters.findIndex(
              (candidate) => candidate.columnId === filter.columnId,
            ) !== index,
        );
      }),
    ).toBe(true);
    expect(samples.some((sample) => (sample.query.sort?.length ?? 0) > 1)).toBe(
      true,
    );
    expect(
      samples.some(
        (sample) =>
          sample.rows.some((row) => row.label === null) &&
          (sample.query.sort ?? []).some(
            (entry) => entry.columnId === "label" && entry.nulls !== undefined,
          ),
      ),
    ).toBe(true);
    expect(
      samples.some((sample) =>
        (sample.query.rowGroups ?? []).some(
          (group) => group.direction === "desc",
        ),
      ),
    ).toBe(true);
    expect(
      operations.some((operation) => operation.kind === "setDerivations"),
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.derivations === "absolute-quantity",
      ),
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.derivations === "reverse-sector",
      ),
    ).toBe(true);
    expect(
      operations.some((operation) => operation.kind === "invalidQuery"),
    ).toBe(true);
    expect(
      operations.some((operation) => operation.kind === "duplicateTransaction"),
    ).toBe(true);
  });

  test("keeps approved legacy differences explicit and closed", () => {
    expect(APPROVED_INTENTIONAL_DIFFERENCES).toEqual([]);
  });

  test("makes absolute null placement operative in the retained oracle", () => {
    const rows = [
      {
        id: "null-label",
        sector: "S0",
        analyst: "Ada",
        quantity: 1,
        label: null,
      },
      {
        id: "value-label",
        sector: "S0",
        analyst: "Ada",
        quantity: 2,
        label: "value",
      },
    ] as unknown as readonly DifferentialRow[];
    for (const direction of ["asc", "desc"] as const) {
      for (const nulls of ["first", "last"] as const) {
        const query: DifferentialQuery = {
          filters: [],
          sort: [{ columnId: "label", direction, nulls }],
          rowGroups: [],
        };
        const model = createModel(rows, query);
        const state: ReferenceState = {
          rows: new Map(
            rows.map((row, sourceOrder) => [row.id, { row, sourceOrder }]),
          ),
          nextSourceOrder: rows.length,
          query,
          expansion: {
            default: { kind: "expanded" },
            overrides: new Map(),
          },
          revision: 0,
          notifications: 0,
          aggregateFilteredRows: false,
          derivations: "sum",
        };
        assertSnapshot(model, state);
        model.dispose();
      }
    }
  });

  test("preserves the empty text needle truth table for single and repeated filters", () => {
    const operators = [
      "contains",
      "notContains",
      "startsWith",
      "endsWith",
      "equals",
      "notEquals",
    ] as const;
    const rows = [
      {
        id: "null-label",
        sector: "S0",
        analyst: "Ada",
        quantity: 1,
        label: null,
      },
      {
        id: "empty-label",
        sector: "S0",
        analyst: "Ada",
        quantity: 2,
        label: "",
      },
      {
        id: "value-label",
        sector: "S0",
        analyst: "Ada",
        quantity: 3,
        label: "value",
      },
    ] as const;
    const cases = operators.flatMap((operator) => [
      [{ columnId: "label" as const, operator, value: "" }],
      [
        { columnId: "label" as const, operator, value: "" },
        {
          columnId: "label" as const,
          operator: "contains" as const,
          value: "",
        },
      ],
    ]);

    fc.assert(
      fc.property(fc.constant(cases), (forcedCases) => {
        for (const filters of forcedCases) {
          const query: DifferentialQuery = {
            filters,
            sort: [],
            rowGroups: [],
          };
          const model = createModel(rows, query);
          const state: ReferenceState = {
            rows: new Map(
              rows.map((row, sourceOrder) => [row.id, { row, sourceOrder }]),
            ),
            nextSourceOrder: rows.length,
            query,
            expansion: {
              default: { kind: "expanded" },
              overrides: new Map(),
            },
            revision: 0,
            notifications: 0,
            aggregateFilteredRows: false,
            derivations: "sum",
          };
          assertSnapshot(model, state);
          model.dispose();
        }
      }),
      { seed: 0x5eed_1315, numRuns: 1, verbose: 2 },
    );
  });

  test(`matches every sequential prefix (seed ${SEQUENTIAL_SEED})`, async () => {
    for (const seed of [SEQUENTIAL_SEED, ...SEQUENTIAL_EXTRA_SEEDS]) {
      await fc.assert(
        fc.asyncProperty(scenarioArbitrary, async (scenario) => {
          const initialRows = uniqueRows(scenario.rows);
          const scheduler = new ManualScheduler();
          const model = createModel(
            initialRows,
            scenario.query,
            scenario.aggregateFilteredRows,
            "sum",
            scheduler,
          );
          const state: ReferenceState = {
            rows: new Map(
              initialRows.map((row, sourceOrder) => [
                row.id,
                { row, sourceOrder },
              ]),
            ),
            nextSourceOrder: initialRows.length,
            query: scenario.query,
            expansion: {
              default: { kind: "expanded" },
              overrides: new Map(),
            },
            revision: 0,
            notifications: 0,
            aggregateFilteredRows: scenario.aggregateFilteredRows,
            derivations: "sum",
          };
          let notifications = 0;
          model.subscribe(() => {
            notifications += 1;
          });
          assertSnapshot(model, state);
          for (const operation of scenario.operations) {
            const captured = model.getState().snapshot;
            const capturedRows = captured.range(0, captured.visibleRowCount);
            await applyOperation(model, state, operation, scheduler);
            expect(notifications).toBe(state.notifications);
            expect(captured.range(0, captured.visibleRowCount)).toEqual(
              capturedRows,
            );
            assertSnapshot(model, state);
          }
          model.dispose();
        }),
        {
          seed,
          numRuns: seed === SEQUENTIAL_SEED ? 60 : 25,
          verbose: 2,
        },
      );
    }
  }, 60_000);

  test("preserves the legacy undefined representative for a blank group", () => {
    interface BlankRow {
      readonly [key: string]: unknown;
      id: string;
      sector: string | undefined;
      quantity: number;
    }
    const blankHelper = createColumnHelper<BlankRow>();
    const rows = [{ id: "blank", sector: undefined, quantity: 1 }] as const;
    const model = createLocalRowModel({
      rows,
      columns: [
        blankHelper.accessor("sector", { type: "text" }),
        blankHelper.accessor("quantity", { type: "number", aggregate: "sum" }),
      ] as const,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector", direction: "asc" }],
      },
    });
    const incremental = model.getState().snapshot.rowAt(0);
    const legacy = runLegacyOracle({
      columns: [
        { id: "sector", header: "Sector" },
        { id: "quantity", header: "Quantity", aggregate: "sum" },
      ],
      rows: [{ id: "blank", row: rows[0], sourceIndex: 0 }],
      filters: {},
      sort: [],
      rowGroups: ["sector"],
      expansion: { default: { kind: "expanded" } },
    })[0];
    expect(incremental).toMatchObject({
      kind: "group",
      value: legacy?.kind === "group" ? legacy.value : Symbol("missing"),
    });
  });

  test("rolls back accessor, comparator, and custom aggregate replacement failures", async () => {
    const rows = [
      {
        id: 1,
        sector: "S0",
        analyst: "Ada",
        quantity: 1,
        label: "one",
      },
      {
        id: "r2",
        sector: "S/1",
        analyst: "Bob/Two",
        quantity: 2,
        label: "two",
      },
    ] as const;
    const query: DifferentialQuery = {
      filters: [],
      sort: [{ columnId: "sector", direction: "asc" }],
      rowGroups: [{ columnId: "sector", direction: "asc" }],
    };
    const failures = [
      {
        code: "accessor-failed",
        columns: [
          {
            ...modelColumns[0],
            accessor: (): string => {
              throw new Error("replacement accessor exploded");
            },
            value: (): string => {
              throw new Error("replacement accessor exploded");
            },
          },
          modelColumns[1],
          modelColumns[2],
          modelColumns[3],
        ],
      },
      {
        code: "comparator-failed",
        columns: [
          {
            ...modelColumns[0],
            compare: (): number => {
              throw new Error("replacement comparator exploded");
            },
          },
          modelColumns[1],
          modelColumns[2],
          modelColumns[3],
        ],
      },
      {
        code: "aggregator-failed",
        columns: [
          modelColumns[0],
          modelColumns[1],
          {
            ...modelColumns[2],
            aggregate: {
              init: () => 0,
              accumulate: (accumulator: number, value: number) =>
                accumulator + value,
              merge: (left: number, right: number) => left + right,
              finalize: (): number | null => {
                throw new Error("replacement aggregate exploded");
              },
            },
          },
          modelColumns[3],
        ],
      },
    ] as const;

    for (const failure of failures) {
      const model = createModel(rows, query);
      const before = model.getState();
      let notifications = 0;
      model.subscribe(() => {
        notifications += 1;
      });
      const transition = model.setDerivations(failure.columns as never);
      await expect(transition.finished).rejects.toMatchObject({
        code: failure.code,
        operation: "set-derivations",
        columnId: failure.code === "aggregator-failed" ? "quantity" : "sector",
        cause: expect.objectContaining({
          message: expect.stringContaining("exploded"),
        }),
      });
      expect(model.getState().snapshot).toBe(before.snapshot);
      expect(model.getState().snapshot.revision).toBe(0);
      expect(model.getState().status).toMatchObject({ kind: "error" });
      expect(notifications).toBe(1);
      model.dispose();
    }
  });

  test(`catches up concurrent mutations after supersession (seed ${TRANSITION_SEED})`, async () => {
    const emptyQuery: DifferentialQuery = {
      filters: [],
      sort: [],
      rowGroups: [],
    };
    for (const seed of [TRANSITION_SEED, ...TRANSITION_EXTRA_SEEDS]) {
      await fc.assert(
        fc.asyncProperty(transitionScenarioArbitrary, async (scenario) => {
          fc.pre(JSON.stringify(scenario.first) !== JSON.stringify(emptyQuery));
          fc.pre(
            JSON.stringify(scenario.second) !== JSON.stringify(emptyQuery),
          );
          fc.pre(
            JSON.stringify(scenario.first) !== JSON.stringify(scenario.second),
          );
          const rows = uniqueRows(scenario.rows);
          const scheduler = new ManualScheduler();
          let tick = 0;
          const model = createLocalRowModel({
            rows,
            columns: modelColumns,
            initialExpansion: { kind: "expanded" },
            query: modelQuery(emptyQuery),
            transitionScheduler: scheduler,
            transitionClock: () => tick++,
            transitionBudgetMs: 1,
          });
          const state: ReferenceState = {
            rows: new Map(
              rows.map((row, sourceOrder) => [row.id, { row, sourceOrder }]),
            ),
            nextSourceOrder: rows.length,
            query: emptyQuery,
            expansion: {
              default: { kind: "expanded" },
              overrides: new Map(),
            },
            revision: 0,
            notifications: 0,
            aggregateFilteredRows: false,
            derivations: "sum",
          };
          let notifications = 0;
          model.subscribe(() => {
            notifications += 1;
          });

          let active: { readonly finished: Promise<number> } = model.setQuery(
            modelQuery(scenario.first),
          );
          expect(model.getState().status).toMatchObject({ kind: "rebuilding" });
          expect(model.getState().snapshot.revision).toBe(0);
          expect(notifications).toBe(1);
          state.notifications = notifications;
          for (const update of scenario.updates) {
            if (update.kind === "update") {
              await applyOperation(model, state, update);
              expect(notifications).toBe(state.notifications);
              assertSnapshot(model, state, "rebuilding");
            }
          }

          for (const operation of scenario.concurrent) {
            if (
              operation.kind === "setQuery" ||
              operation.kind === "setDerivations"
            ) {
              const previousState = model.getState();
              const previousNotifications = notifications;
              const superseded = active;
              active =
                operation.kind === "setQuery"
                  ? model.setQuery(modelQuery(operation.query))
                  : model.setDerivations(
                      modelDerivations(operation.derivations),
                    );
              void superseded.finished.catch(() => undefined);
              expect(notifications - previousNotifications).toBe(
                model.getState() === previousState ? 0 : 1,
              );
              if (
                operation.kind === "setDerivations" &&
                model.getState().status.kind === "ready"
              ) {
                state.derivations = operation.derivations;
              }
              state.notifications = notifications;
            } else {
              await applyOperation(model, state, operation);
              expect(notifications).toBe(state.notifications);
            }
            assertSnapshot(
              model,
              state,
              model.getState().status.kind === "rebuilding"
                ? "rebuilding"
                : "ready",
            );
          }

          const second = model.setQuery(modelQuery(scenario.second));
          void active.finished.catch(() => undefined);
          expect(model.getState().snapshot.query).toEqual(
            modelQuery(emptyQuery),
          );
          expect(notifications).toBe(state.notifications + 1);
          state.notifications = notifications;

          while (scheduler.entries.length > 0) {
            const previousState = model.getState();
            const previousNotifications = notifications;
            const previousSnapshot = previousState.snapshot;
            const previousRevision = previousSnapshot.revision;
            scheduler.flushOne();
            expect(notifications - previousNotifications).toBe(
              model.getState() === previousState ? 0 : 1,
            );
            expect(previousState.snapshot).toBe(previousSnapshot);
            if (model.getState().status.kind === "rebuilding") {
              expect(model.getState().snapshot).toBe(previousSnapshot);
              expect(model.getState().snapshot.revision).toBe(previousRevision);
              assertSnapshot(model, state, "rebuilding");
            } else {
              expect(model.getState().snapshot.revision).toBe(
                previousRevision + 1,
              );
            }
          }
          const revision = await second.finished;
          state.query = scenario.second;
          state.revision += 1;
          state.notifications = notifications;
          expect(revision).toBe(state.revision);
          assertSnapshot(model, state);
          model.dispose();
        }),
        {
          seed,
          numRuns: seed === TRANSITION_SEED ? 30 : 15,
          verbose: 2,
        },
      );
    }
  }, 60_000);

  test("prints deterministic replay data for arbitrary operation shrinking", () => {
    fc.assert(
      fc.property(operationArbitrary, (operation) => operation.kind.length > 0),
      { seed: 0x5eed_1302, numRuns: 25, verbose: true },
    );
  });
});
