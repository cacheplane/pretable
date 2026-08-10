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
  type DifferentialOperation,
  type DifferentialQuery,
  type DifferentialRow,
} from "./arbitraries";
import { runLegacyOracle, type LegacyOracleRow } from "./oracle";

const SEQUENTIAL_SEED = 0x5eed_1301;
const TRANSITION_SEED = 0x5eed_1303;
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
  rows: Map<string, { row: DifferentialRow; sourceOrder: number }>;
  nextSourceOrder: number;
  query: DifferentialQuery;
  expansion: {
    default: PretableExpansionDefault;
    overrides: Map<string, boolean>;
  };
  revision: number;
  notifications: number;
  aggregateFilteredRows: boolean;
}

function uniqueRows(
  rows: readonly DifferentialRow[],
): readonly DifferentialRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

function modelQuery(query: DifferentialQuery) {
  return {
    filters:
      query.minimum === undefined
        ? []
        : [
            {
              columnId: "quantity" as const,
              operator: "gte" as const,
              value: query.minimum,
            },
          ],
    sort:
      query.direction === undefined
        ? []
        : [
            {
              columnId: "quantity" as const,
              direction: query.direction,
            },
          ],
    rowGroups: query.groups.map((columnId) => ({
      columnId,
      direction: "asc" as const,
    })),
  };
}

function legacyRows(state: ReferenceState, fullyExpanded = false) {
  const rows: SourceRow<DifferentialRow>[] = [...state.rows.values()]
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map(({ row, sourceOrder }) => ({
      id: row.id,
      row,
      sourceIndex: sourceOrder,
    }));
  const filters: Record<string, ColumnFilter> =
    state.query.minimum === undefined
      ? {}
      : {
          quantity: { operator: "gte", value: state.query.minimum },
        };
  const sort: PretableSortEntry[] =
    state.query.direction === undefined
      ? []
      : [{ columnId: "quantity", direction: state.query.direction }];
  return runLegacyOracle({
    columns: [...legacyColumns],
    rows,
    filters,
    sort,
    rowGroups: [...state.query.groups],
    aggregateFilteredRows: state.aggregateFilteredRows,
    expansion: fullyExpanded
      ? { default: { kind: "expanded" } }
      : state.expansion,
  });
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

function refOf(row: LegacyOracleRow<DifferentialRow>) {
  return row.ref as PretableVisibleRowRef<string>;
}

function groupAncestors(rows: readonly LegacyOracleRow<DifferentialRow>[]) {
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
): void {
  const snapshot = model.getState().snapshot;
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
) {
  return createLocalRowModel({
    rows,
    columns: modelColumns,
    initialExpansion: { kind: "expanded" },
    query: modelQuery(query),
    aggregateFilteredRows,
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
      const revision = await transition.finished;
      if (changed) {
        state.query = operation.query;
        expectedMutation(state, true);
      }
      expect(revision).toBe(state.revision);
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
  test("keeps approved legacy differences explicit and closed", () => {
    expect(APPROVED_INTENTIONAL_DIFFERENCES).toEqual([
      "collapsed-default-expansion",
      "typed-null-and-nan-ordering",
      "independent-group-direction",
      "strict-correlated-query-validation",
      "multiple-filters-per-column",
      "date-signed-zero-and-object-group-identity",
      "exact-numeric-aggregation",
      "number-row-ids",
      "structured-transaction-results",
      "monotonic-transaction-source-tokens",
      "custom-derivation-replacement",
    ]);
  });

  test(`matches every sequential prefix (seed ${SEQUENTIAL_SEED})`, async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async (scenario) => {
        const initialRows = uniqueRows(scenario.rows);
        const model = createModel(
          initialRows,
          scenario.query,
          scenario.aggregateFilteredRows,
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
        };
        let notifications = 0;
        model.subscribe(() => {
          notifications += 1;
        });
        assertSnapshot(model, state);
        for (const operation of scenario.operations) {
          const captured = model.getState().snapshot;
          const capturedRows = captured.range(0, captured.visibleRowCount);
          await applyOperation(model, state, operation);
          expect(notifications).toBe(state.notifications);
          expect(captured.range(0, captured.visibleRowCount)).toEqual(
            capturedRows,
          );
          assertSnapshot(model, state);
        }
        model.dispose();
      }),
      { seed: SEQUENTIAL_SEED, numRuns: 60, verbose: true },
    );
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

  test(`catches up concurrent mutations after supersession (seed ${TRANSITION_SEED})`, async () => {
    const emptyQuery: DifferentialQuery = {
      minimum: undefined,
      direction: undefined,
      groups: [],
    };
    await fc.assert(
      fc.asyncProperty(transitionScenarioArbitrary, async (scenario) => {
        fc.pre(JSON.stringify(scenario.first) !== JSON.stringify(emptyQuery));
        fc.pre(JSON.stringify(scenario.second) !== JSON.stringify(emptyQuery));
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
        };
        let notifications = 0;
        model.subscribe(() => {
          notifications += 1;
        });

        const first = model.setQuery(modelQuery(scenario.first));
        expect(model.getState().status).toMatchObject({ kind: "rebuilding" });
        expect(model.getState().snapshot.revision).toBe(0);
        expect(notifications).toBe(1);
        state.notifications = notifications;
        for (const update of scenario.updates) {
          if (update.kind === "update") {
            await applyOperation(model, state, update);
            expect(notifications).toBe(state.notifications);
            assertSnapshot(model, state);
          }
        }

        const second = model.setQuery(modelQuery(scenario.second));
        await expect(first.finished).rejects.toMatchObject({
          reason: "superseded",
        });
        expect(model.getState().snapshot.query).toEqual(modelQuery(emptyQuery));
        expect(notifications).toBe(state.notifications + 1);
        state.notifications = notifications;

        while (scheduler.entries.length > 0) {
          const previousState = model.getState();
          const previousNotifications = notifications;
          scheduler.flushOne();
          expect(notifications - previousNotifications).toBe(
            model.getState() === previousState ? 0 : 1,
          );
        }
        const revision = await second.finished;
        state.query = scenario.second;
        state.revision += 1;
        state.notifications = notifications;
        expect(revision).toBe(state.revision);
        assertSnapshot(model, state);
        model.dispose();
      }),
      { seed: TRANSITION_SEED, numRuns: 30, verbose: true },
    );
  }, 30_000);

  test("prints deterministic replay data for arbitrary operation shrinking", () => {
    fc.assert(
      fc.property(operationArbitrary, (operation) => operation.kind.length > 0),
      { seed: 0x5eed_1302, numRuns: 25, verbose: true },
    );
  });
});
