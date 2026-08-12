import * as fc from "fast-check";
import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";
import type { PretableRowModelSnapshot, PretableVisibleRowRef } from "../types";
import {
  propertyOperationArbitrary,
  propertyScenarioArbitrary,
  propertyTransitionScenarioArbitrary,
  type PropertyDerivations,
  type PropertyOperation,
  type PropertyQuery,
  type PropertyRow,
  type PropertyRowId,
} from "./property-arbitraries";

interface Holding {
  readonly id: number;
  readonly sector: string;
  readonly analyst: string;
  readonly quantity: number;
}

const helper = createColumnHelper<Holding>();
const customTotal = Object.freeze({
  init: () => 0,
  accumulate: (total: number, value: number) => total + value + 1,
  merge: (left: number, right: number) => left + right,
  finalize: (total: number): number | null => total,
});
const columns = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("analyst", { type: "text" }),
  helper.accessor("quantity", { type: "number", aggregate: customTotal }),
] as const;

const propertyHelper = createColumnHelper<PropertyRow>();
const propertyColumns = [
  propertyHelper.accessor("sector", { type: "text" }),
  propertyHelper.accessor("analyst", { type: "text" }),
  propertyHelper.accessor("quantity", { type: "number", aggregate: "sum" }),
  propertyHelper.accessor("label", { type: "text" }),
] as const;
const reverseSector = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const propertyDerivations = {
  sum: propertyColumns,
  avg: [
    propertyColumns[0],
    propertyColumns[1],
    { ...propertyColumns[2], aggregate: "avg" as const },
    propertyColumns[3],
  ],
  "custom-total": [
    propertyColumns[0],
    propertyColumns[1],
    { ...propertyColumns[2], aggregate: customTotal },
    propertyColumns[3],
  ],
  "absolute-quantity": [
    propertyColumns[0],
    propertyColumns[1],
    {
      ...propertyColumns[2],
      accessor: (row: PropertyRow) => Math.abs(row.quantity),
      value: (row: PropertyRow) => Math.abs(row.quantity),
    },
    propertyColumns[3],
  ],
  "reverse-sector": [
    {
      ...propertyColumns[0],
      compare: (left: string, right: string) =>
        reverseSector.compare(right, left),
    },
    propertyColumns[1],
    propertyColumns[2],
    propertyColumns[3],
  ],
} as const;

const rowArbitrary = fc.record({
  id: fc.integer({ min: 0, max: 24 }),
  sector: fc.constantFrom("Tech/Growth", "Energy%Core", "Cash=Other", ""),
  analyst: fc.constantFrom("Ada=One", "Bob/Two", "Cy%Three"),
  quantity: fc.integer({ min: -100, max: 500 }),
});

const scenarioArbitrary = fc.record({
  rows: fc.uniqueArray(rowArbitrary, {
    minLength: 1,
    maxLength: 16,
    selector: (row) => row.id,
  }),
  operations: fc.array(
    fc.record({
      selector: fc.nat({ max: 100 }),
      sector: fc.constantFrom("Tech/Growth", "Energy%Core", "Cash=Other", ""),
      quantity: fc.integer({ min: -100, max: 500 }),
    }),
    { minLength: 1, maxLength: 35 },
  ),
});

function assertIndexedSnapshot(
  snapshot: PretableRowModelSnapshot<Holding, number, typeof columns>,
): void {
  const rows = snapshot.range(0, snapshot.visibleRowCount);
  expect(rows).toHaveLength(snapshot.visibleRowCount);
  expect(snapshot.rowAt(-1)).toBeUndefined();
  expect(snapshot.rowAt(snapshot.visibleRowCount)).toBeUndefined();
  expect(snapshot.range(-10, snapshot.visibleRowCount + 10)).toEqual(rows);

  const dataRows = rows.filter((row) => row.kind === "data");
  expect(snapshot.visibleDataRowCount).toBe(dataRows.length);
  expect(snapshot.sourceRowCount).toBeGreaterThanOrEqual(dataRows.length);

  rows.forEach((row, index) => {
    const ref: PretableVisibleRowRef<number> =
      row.kind === "data"
        ? { kind: "data", rowId: row.rowId }
        : { kind: "group", groupId: row.groupId };
    expect(snapshot.indexOf(ref)).toBe(index);
    expect(snapshot.nearestVisibleRef(ref)).toEqual(ref);
  });
  dataRows.forEach((row, index) => {
    expect(snapshot.dataRowAt(index)?.rowId).toBe(row.rowId);
  });
  expect(snapshot.dataRowAt(dataRows.length)).toBeUndefined();
}

class ManualScheduler {
  readonly tasks: Array<() => void> = [];

  schedule(task: () => void): () => void {
    this.tasks.push(task);
    return () => {
      const index = this.tasks.indexOf(task);
      if (index >= 0) this.tasks.splice(index, 1);
    };
  }

  flushAll(): void {
    while (this.tasks.length > 0) this.tasks.shift()!();
  }
}

function propertyModel(
  rows: readonly PropertyRow[],
  query: PropertyQuery,
  derivations: PropertyDerivations,
  scheduler?: ManualScheduler,
  aggregateFilteredRows = false,
) {
  let tick = 0;
  return createLocalRowModel({
    rows,
    columns: propertyColumns,
    derivations: propertyDerivations[derivations],
    query,
    aggregateFilteredRows,
    initialExpansion: { kind: "expanded" },
    transitionScheduler: scheduler,
    transitionClock: scheduler === undefined ? undefined : () => tick++,
    transitionBudgetMs: scheduler === undefined ? undefined : 1,
  });
}

function normalizedPropertySnapshot(
  snapshot: PretableRowModelSnapshot<
    PropertyRow,
    PropertyRowId,
    typeof propertyColumns
  >,
) {
  return snapshot.range(0, snapshot.visibleRowCount).map((row) =>
    row.kind === "data"
      ? {
          kind: row.kind,
          rowId: row.rowId,
          row: row.row,
          depth: row.depth,
        }
      : {
          kind: row.kind,
          groupId: row.groupId,
          depth: row.depth,
          columnId: row.columnId,
          value: row.value,
          childCount: row.childCount,
          aggregates: row.aggregates,
          expanded: row.expanded,
        },
  );
}

function propertySnapshotRows(model: ReturnType<typeof propertyModel>) {
  return normalizedPropertySnapshot(model.getState().snapshot);
}

function assertPropertySnapshot(
  model: ReturnType<typeof propertyModel>,
  expectedRows: readonly PropertyRow[],
  expectedRevision: number,
  expectedQuery: PropertyQuery,
): void {
  const snapshot = model.getState().snapshot;
  const visible = snapshot.range(0, snapshot.visibleRowCount);
  expect(snapshot.revision).toBe(expectedRevision);
  expect(snapshot.sourceRowCount).toBe(expectedRows.length);
  expect(snapshot.query).toEqual(expectedQuery);
  expect(snapshot.rowAt(-1)).toBeUndefined();
  expect(snapshot.rowAt(snapshot.visibleRowCount)).toBeUndefined();
  expect(snapshot.range(-2, snapshot.visibleRowCount + 2)).toEqual(visible);
  const source = new Map(expectedRows.map((row) => [row.id, row]));
  visible.forEach((row, index) => {
    const ref =
      row.kind === "data"
        ? ({ kind: "data", rowId: row.rowId } as const)
        : ({ kind: "group", groupId: row.groupId } as const);
    expect(snapshot.indexOf(ref)).toBe(index);
    expect(snapshot.nearestVisibleRef(ref)).toEqual(ref);
    if (row.kind === "data") expect(row.row).toEqual(source.get(row.rowId));
  });
}

function derivationChangeRebuilds(
  previous: PropertyDerivations,
  next: PropertyDerivations,
  query: PropertyQuery,
): boolean {
  const sectorOrdered = [...query.sort, ...query.rowGroups].some(
    (entry) => entry.columnId === "sector",
  );
  const aggregateKind = (mode: PropertyDerivations) =>
    mode === "avg" ? "avg" : mode === "custom-total" ? "custom" : "sum";
  return (
    (previous === "absolute-quantity") !== (next === "absolute-quantity") ||
    (sectorOrdered &&
      (previous === "reverse-sector") !== (next === "reverse-sector")) ||
    aggregateKind(previous) !== aggregateKind(next)
  );
}

function duplicateId(rows: readonly PropertyRow[]): PropertyRowId | undefined {
  const seen = new Set<PropertyRowId>();
  for (const row of rows) {
    if (seen.has(row.id)) return row.id;
    seen.add(row.id);
  }
  return undefined;
}

interface PropertyMachineState {
  rows: PropertyRow[];
  query: PropertyQuery;
  derivations: PropertyDerivations;
  revision: number;
}

async function applyPropertyOperation(
  model: ReturnType<typeof propertyModel>,
  state: PropertyMachineState,
  operation: PropertyOperation,
  scheduler: ManualScheduler,
): Promise<void> {
  const before = model.getState();
  const previousRevision = state.revision;
  switch (operation.kind) {
    case "add": {
      if (state.rows.some((row) => Object.is(row.id, operation.row.id))) {
        expect(() => model.applyTransaction({ add: [operation.row] })).toThrow(
          expect.objectContaining({ code: "existing-row-id" }),
        );
        expect(model.getState()).toBe(before);
        return;
      }
      const result = model.applyTransaction({ add: [operation.row] });
      state.rows.push(operation.row);
      state.revision += 1;
      expect(result).toMatchObject({
        previousRevision,
        revision: state.revision,
        added: 1,
      });
      return;
    }
    case "update": {
      const index = state.rows.findIndex((row) =>
        Object.is(row.id, operation.id),
      );
      if (index < 0) {
        const result = model.applyTransaction({
          update: [{ id: operation.id, changes: operation.changes }],
        });
        expect(result).toMatchObject({
          previousRevision,
          revision: previousRevision,
          ignored: 1,
        });
        expect(model.getState()).toBe(before);
        return;
      }
      const previous = state.rows[index]!;
      const next = { ...previous, ...operation.changes };
      const changed = Object.keys(operation.changes).some(
        (key) =>
          !Object.is(
            previous[key as keyof PropertyRow],
            next[key as keyof PropertyRow],
          ),
      );
      const result = model.applyTransaction({
        update: [{ id: operation.id, changes: operation.changes }],
      });
      if (changed) {
        state.rows[index] = next;
        state.revision += 1;
      }
      expect(result).toMatchObject({
        previousRevision,
        revision: state.revision,
        updated: changed ? 1 : 0,
        unchanged: changed ? 0 : 1,
      });
      return;
    }
    case "remove": {
      const index = state.rows.findIndex((row) =>
        Object.is(row.id, operation.id),
      );
      const result = model.applyTransaction({ remove: [operation.id] });
      if (index >= 0) {
        state.rows.splice(index, 1);
        state.revision += 1;
      }
      expect(result).toMatchObject({
        previousRevision,
        revision: state.revision,
        removed: index >= 0 ? 1 : 0,
        ignored: index < 0 ? 1 : 0,
      });
      return;
    }
    case "setRows": {
      if (duplicateId(operation.rows) !== undefined) {
        expect(() => model.setRows(operation.rows)).toThrow(
          expect.objectContaining({ code: "duplicate-row-id" }),
        );
        expect(model.getState()).toBe(before);
        return;
      }
      const changed =
        operation.rows.length !== state.rows.length ||
        operation.rows.some((row, index) => state.rows[index] !== row);
      const result = model.setRows(operation.rows);
      state.rows = [...operation.rows];
      if (changed) state.revision += 1;
      expect(result).toMatchObject({
        previousRevision,
        revision: state.revision,
      });
      return;
    }
    case "setQuery": {
      const changed =
        JSON.stringify(state.query) !== JSON.stringify(operation.query);
      const transition = model.setQuery(operation.query);
      scheduler.flushAll();
      if (changed) {
        state.query = operation.query;
        state.revision += 1;
      }
      await expect(transition.finished).resolves.toBe(state.revision);
      return;
    }
    case "setDerivations": {
      const changed = state.derivations !== operation.derivations;
      const rebuild =
        changed &&
        derivationChangeRebuilds(
          state.derivations,
          operation.derivations,
          state.query,
        );
      const transition = model.setDerivations(
        propertyDerivations[operation.derivations],
      );
      scheduler.flushAll();
      if (changed) state.derivations = operation.derivations;
      if (rebuild) state.revision += 1;
      await expect(transition.finished).resolves.toBe(state.revision);
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
        expect.objectContaining({ code: "invalid-query" }),
      );
      expect(model.getState()).toBe(before);
      return;
    }
    case "duplicateTransaction": {
      const id = `__duplicate__:${typeof operation.id}:${String(operation.id)}`;
      const row = {
        id,
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
                  { id, changes: { quantity: 1 } },
                  { id, changes: { quantity: 2 } },
                ],
              }
            : operation.duplicate === "remove"
              ? { remove: [id, id] }
              : { add: [row], remove: [id] };
      if (
        operation.duplicate === "update" ||
        operation.duplicate === "remove"
      ) {
        expect(model.applyTransaction(transaction)).toMatchObject({
          previousRevision,
          revision: previousRevision,
          ignored: 1,
        });
      } else {
        expect(() => model.applyTransaction(transaction)).toThrow(
          expect.objectContaining({
            code:
              operation.duplicate === "add"
                ? "duplicate-row-id"
                : "transaction-conflict",
          }),
        );
      }
      expect(model.getState()).toBe(before);
      return;
    }
    case "toggleGroup": {
      const groups = model
        .getState()
        .snapshot.range(0, model.getState().snapshot.visibleRowCount)
        .filter((row) => row.kind === "group");
      const group = groups[operation.selector % Math.max(1, groups.length)];
      if (group === undefined) return;
      const desired = !model.getState().snapshot.isGroupExpanded(group.groupId);
      const result = model.setGroupExpanded(group.groupId, desired);
      state.revision += 1;
      expect(result).toMatchObject({
        previousRevision,
        revision: state.revision,
      });
      return;
    }
    case "setExpansionDefault": {
      const expansion = model.getState().snapshot.expansion;
      const changed =
        JSON.stringify(expansion.default) !==
          JSON.stringify(operation.policy) || expansion.overrideCount > 0;
      const result = model.setExpansionDefault(operation.policy);
      if (changed) state.revision += 1;
      expect(result).toMatchObject({
        previousRevision,
        revision: state.revision,
      });
      return;
    }
    case "expandAll":
    case "collapseAll": {
      const desired = operation.kind === "expandAll" ? "expanded" : "collapsed";
      const expansion = model.getState().snapshot.expansion;
      const changed =
        expansion.default.kind !== desired || expansion.overrideCount > 0;
      const result =
        operation.kind === "expandAll"
          ? model.expandAll()
          : model.collapseAll();
      if (changed) state.revision += 1;
      expect(result).toMatchObject({
        previousRevision,
        revision: state.revision,
      });
      return;
    }
    case "conflict": {
      const row = state.rows.find((candidate) =>
        Object.is(candidate.id, operation.id),
      ) ?? {
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

describe("incremental row-model properties", () => {
  test("keeps the migrated operation domain broad and deterministic", () => {
    const samples = fc.sample(propertyOperationArbitrary, {
      seed: 0x5eed_2300,
      numRuns: 1_000,
    });
    expect(new Set(samples.map((operation) => operation.kind))).toEqual(
      new Set([
        "add",
        "update",
        "remove",
        "setRows",
        "setQuery",
        "setDerivations",
        "invalidQuery",
        "duplicateTransaction",
        "toggleGroup",
        "setExpansionDefault",
        "expandAll",
        "collapseAll",
        "conflict",
      ]),
    );
    expect(
      new Set(
        samples.flatMap((operation) =>
          operation.kind === "setDerivations" ? [operation.derivations] : [],
        ),
      ),
    ).toEqual(
      new Set([
        "sum",
        "avg",
        "custom-total",
        "absolute-quantity",
        "reverse-sector",
      ]),
    );
  });

  test("preserves state-machine outcomes and indexed snapshots across every operation family", async () => {
    await fc.assert(
      fc.asyncProperty(
        propertyScenarioArbitrary,
        async ({ rows, query, aggregateFilteredRows, operations }) => {
          const scheduler = new ManualScheduler();
          const model = propertyModel(
            rows,
            query,
            "sum",
            scheduler,
            aggregateFilteredRows,
          );
          const state: PropertyMachineState = {
            rows: [...rows],
            query,
            derivations: "sum",
            revision: 0,
          };
          for (const operation of operations) {
            const captured = model.getState().snapshot;
            const capturedRows = propertySnapshotRows(model);
            await applyPropertyOperation(model, state, operation, scheduler);
            expect(normalizedPropertySnapshot(captured)).toEqual(capturedRows);
            assertPropertySnapshot(
              model,
              state.rows,
              state.revision,
              state.query,
            );
          }
          model.dispose();
        },
      ),
      { seed: 0x5eed_2302, numRuns: 30, verbose: 2 },
    );
  }, 30_000);

  test("matches a fresh final model after superseded query catch-up", async () => {
    const initialQuery: PropertyQuery = {
      filters: [],
      sort: [],
      rowGroups: [],
    };
    await fc.assert(
      fc.asyncProperty(
        propertyTransitionScenarioArbitrary,
        async ({ rows, first, second, concurrent }) => {
          const scheduler = new ManualScheduler();
          const model = propertyModel(rows, initialQuery, "sum", scheduler);
          const firstTransition = model.setQuery(first);
          const firstOutcome = firstTransition.finished.catch(
            (error: unknown) => error,
          );
          const secondTransition = model.setQuery(second);
          const state: PropertyMachineState = {
            rows: [...rows],
            query: initialQuery,
            derivations: "sum",
            revision: 0,
          };
          for (const operation of concurrent) {
            await applyPropertyOperation(model, state, operation, scheduler);
          }
          scheduler.flushAll();
          await firstOutcome;
          await secondTransition.finished;
          state.query = second;
          if (JSON.stringify(second) !== JSON.stringify(initialQuery)) {
            state.revision += 1;
          }
          assertPropertySnapshot(model, state.rows, state.revision, second);

          const reference = propertyModel(state.rows, second, "sum");
          expect(propertySnapshotRows(model)).toEqual(
            propertySnapshotRows(reference),
          );
          reference.dispose();
          model.dispose();
        },
      ),
      { seed: 0x5eed_2303, numRuns: 30, verbose: 2 },
    );
  }, 30_000);

  test("keeps indexed reads, revisions, notifications, and captured roots coherent through group-key churn", () => {
    fc.assert(
      fc.property(scenarioArbitrary, ({ rows, operations }) => {
        const model = createLocalRowModel({
          rows,
          columns,
          initialExpansion: { kind: "expanded" },
          query: {
            filters: [],
            sort: [{ columnId: "quantity", direction: "desc" }],
            rowGroups: [
              { columnId: "sector", direction: "asc" },
              { columnId: "analyst", direction: "asc" },
            ],
          },
        });
        let notifications = 0;
        model.subscribe(() => {
          notifications += 1;
        });
        assertIndexedSnapshot(model.getState().snapshot);

        for (const operation of operations) {
          const before = model.getState().snapshot;
          const beforeRows = before.range(0, before.visibleRowCount);
          const target = rows[operation.selector % rows.length]!;
          const result = model.applyTransaction({
            update: [
              {
                id: target.id,
                changes: {
                  sector: operation.sector,
                  quantity: operation.quantity,
                },
              },
            ],
          });
          const changed = result.revision !== result.previousRevision;
          expect(result.revision - result.previousRevision).toBe(
            changed ? 1 : 0,
          );
          expect(notifications).toBe(result.revision);
          expect(before.range(0, before.visibleRowCount)).toEqual(beforeRows);
          assertIndexedSnapshot(model.getState().snapshot);
        }
        model.dispose();
      }),
      { seed: 0x5eed_2301, numRuns: 100, verbose: 2 },
    );
  });

  test("preserves escaping, custom filtered totals, and group identity through disappearance and return", async () => {
    const model = createLocalRowModel({
      rows: [
        { id: 1, sector: "Tech/Growth", analyst: "Ada=One", quantity: 20 },
        { id: 2, sector: "Tech/Growth", analyst: "Bob/Two", quantity: 5 },
        { id: 3, sector: "Energy%Core", analyst: "Ada=One", quantity: 40 },
      ],
      columns,
      aggregateFilteredRows: true,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [{ columnId: "quantity", operator: "gte", value: 20 }],
        sort: [],
        rowGroups: [{ columnId: "sector", direction: "asc" }],
      },
    });
    const tech = model
      .getState()
      .snapshot.range(0, model.getState().snapshot.visibleRowCount)
      .find((row) => row.kind === "group" && row.value === "Tech/Growth");
    expect(tech).toMatchObject({
      kind: "group",
      childCount: 1,
      aggregates: { quantity: 27 },
    });
    if (tech?.kind !== "group") throw new Error("missing Tech group");
    const groupId = tech.groupId;
    model.setGroupExpanded(groupId, false);
    model.applyTransaction({ remove: [1, 2] });
    expect(model.getState().snapshot.indexOf({ kind: "group", groupId })).toBe(
      -1,
    );
    model.applyTransaction({
      add: [
        { id: 4, sector: "Tech/Growth", analyst: "Cy%Three", quantity: 30 },
      ],
    });
    expect(model.getState().snapshot.isGroupExpanded(groupId)).toBe(false);
    expect(model.getState().snapshot.indexOf({ kind: "data", rowId: 4 })).toBe(
      -1,
    );
    model.dispose();
  });

  test("rolls transaction conflicts back without revision or publication", () => {
    const model = createLocalRowModel({
      rows: [{ id: 1, sector: "Tech/Growth", analyst: "Ada=One", quantity: 1 }],
      columns,
    });
    const before = model.getState();
    let notifications = 0;
    model.subscribe(() => {
      notifications += 1;
    });
    expect(() =>
      model.applyTransaction({
        update: [{ id: 1, changes: { quantity: 2 } }],
        remove: [1],
      }),
    ).toThrow(expect.objectContaining({ code: "transaction-conflict" }));
    expect(model.getState()).toBe(before);
    expect(notifications).toBe(0);
    model.dispose();
  });

  test("catches a staged query up through concurrent group-key updates", async () => {
    const scheduler = new ManualScheduler();
    let tick = 0;
    const model = createLocalRowModel({
      rows: Array.from({ length: 12 }, (_, id) => ({
        id,
        sector: id % 2 === 0 ? "Tech/Growth" : "Energy%Core",
        analyst: id % 3 === 0 ? "Ada=One" : "Bob/Two",
        quantity: id,
      })),
      columns,
      initialExpansion: { kind: "expanded" },
      transitionScheduler: scheduler,
      transitionClock: () => tick++,
      transitionBudgetMs: 1,
    });
    const transition = model.setQuery({
      filters: [{ columnId: "quantity", operator: "gte", value: 5 }],
      sort: [{ columnId: "quantity", direction: "desc" }],
      rowGroups: [{ columnId: "sector", direction: "asc" }],
    });
    model.applyTransaction({
      update: [{ id: 1, changes: { sector: "Tech/Growth", quantity: 99 } }],
    });
    scheduler.flushAll();
    await expect(transition.finished).resolves.toBe(
      model.getState().snapshot.revision,
    );
    const snapshot = model.getState().snapshot;
    assertIndexedSnapshot(snapshot);
    expect(snapshot.rowAt(0)).toMatchObject({ kind: "group", childCount: 4 });
    expect(snapshot.indexOf({ kind: "data", rowId: 1 })).toBeGreaterThan(0);
    model.dispose();
  });
});
