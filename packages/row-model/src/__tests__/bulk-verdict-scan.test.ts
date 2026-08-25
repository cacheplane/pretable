/**
 * Bulk columnar verdict scan (Amendment J §5) + its filter-rebuild
 * consumption: the columnar-vs-per-row equivalence oracle on a seeded
 * randomized script, the zero-fills work pin (the milestone's work
 * assertion), the setDerivations plan-reuse laundering fix, and
 * accessor-error shape parity with the per-row path.
 */

import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  PretableRowModelError,
  type PretableQueryFor,
} from "../index";
import {
  bulkFilterVerdictScan,
  compileQuery,
  filterVerdict,
} from "../compiled-query";
import { rowPassesFilter } from "../filter-membership";
import { getLocalRowModelSlotInternalsForTesting } from "../create-local-row-model";
import { createInstrumentedLocalRowModel } from "../diagnostics";

interface Row {
  id: string;
  num: number;
  extra: number;
  txt: string;
}

const helper = createColumnHelper<Row>();

function createColumns() {
  return [
    helper.accessor("num", (row: Row) => row.num, { type: "number" }),
    helper.accessor("extra", (row: Row) => row.extra, { type: "number" }),
    helper.accessor("txt", (row: Row) => row.txt, { type: "text" }),
  ] as const;
}

type FixtureColumns = ReturnType<typeof createColumns>;

function queryFor(
  value: PretableQueryFor<FixtureColumns>,
): PretableQueryFor<FixtureColumns> {
  return value;
}

/** Deterministic PRNG (mulberry32) — the scripts below are seeded, not ad hoc. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["ab", "ba", "aa", "bb", "abc", "ca"] as const;

function randomRow(rng: () => number, id: string): Row {
  return {
    id,
    num: Math.floor(rng() * 100),
    extra: Math.floor(rng() * 100),
    txt: ALPHABET[Math.floor(rng() * ALPHABET.length)],
  };
}

describe("columnar-vs-per-row equivalence oracle", () => {
  /**
   * Seeded script over one model: filter-only commits with varying filters
   * (including the `extra` column becoming NEWLY referenced mid-script — the
   * hole-fill path), update transactions, remove+add slot reuse, and
   * setRows. After every filter-only commit, the model's membership must
   * equal what per-row `filterVerdict` computes FRESH for every live record
   * — computed on a COLD twin plan whose columnar store has never been
   * filled, so the oracle cannot be contaminated by the store under test.
   */
  test("randomized script: visible membership ≡ fresh per-row verdicts for every live record", () => {
    const rng = mulberry32(0xc01a51);
    const columns = createColumns();
    const initialRows = Array.from({ length: 10 }, (_, index) =>
      randomRow(rng, `r${index}`),
    );
    const makeQuery = (
      step: number,
      includeExtra: boolean,
    ): PretableQueryFor<FixtureColumns> =>
      queryFor({
        filters: [
          {
            columnId: "num",
            operator: "gte",
            // The step-scaled jitter keeps every step's operand distinct, so
            // each setQuery is a REAL filter change (filtersChanged), never
            // a plan-identity no-op that would skip the rebuild.
            value: Math.floor(rng() * 100) + step * 1e-6,
          },
          { columnId: "txt", operator: "contains", value: "a" },
          ...(includeExtra
            ? [
                {
                  columnId: "extra" as const,
                  operator: "gte" as const,
                  value: Math.floor(rng() * 100) + step * 1e-6,
                },
              ]
            : []),
        ],
        sort: [{ columnId: "num", direction: "asc" as const }],
        rowGroups: [],
      });
    const instrumented = createInstrumentedLocalRowModel({
      rows: initialRows,
      columns,
      getRowId: (row: Row) => row.id,
      query: makeQuery(0, false),
    });
    const model = instrumented.model;
    let nextId = initialRows.length;
    let filterCommits = 0;

    const assertOracle = () => {
      const { root } = getLocalRowModelSlotInternalsForTesting(model);
      // Cold twin: same derivations and query, compiled fresh — its verdicts
      // are pure accessor reads (its columnar store has no cells).
      const twin = compileQuery({
        derivations: columns,
        query: root.queryPlan.query as PretableQueryFor<FixtureColumns>,
      });
      let liveRecords = 0;
      for (const [rowId, record] of root.rows.entries()) {
        liveRecords += 1;
        const fresh = filterVerdict(twin, {
          rowId,
          row: record.row,
          sourceOrder: record.sourceOrder,
          slot: record.slot,
        } as never);
        expect(
          rowPassesFilter(root as never, rowId),
          `membership for ${String(rowId)} under ${JSON.stringify(
            root.queryPlan.query.filters,
          )}`,
        ).toBe(fresh);
      }
      expect(liveRecords).toBeGreaterThan(0);
    };

    for (let step = 1; step <= 40; step += 1) {
      const roll = rng();
      if (roll < 0.5) {
        // Filter-only commit. From step 12 on, `extra` joins the filters —
        // a column no prior scan filled, so its first scan exercises the
        // hole-fill fallback for every live row.
        const before = instrumented.diagnostics.read().work.filterRebuilds;
        model.setQuery(makeQuery(step, step >= 12 && rng() < 0.6));
        expect(instrumented.diagnostics.read().work.filterRebuilds).toBe(
          before + 1,
        );
        filterCommits += 1;
        assertOracle();
      } else if (roll < 0.7) {
        // Update transaction: rewrite a random live row's filtered values.
        const { root } = getLocalRowModelSlotInternalsForTesting(model);
        const ids = [...root.rows.entries()].map(([rowId]) => String(rowId));
        const target = ids[Math.floor(rng() * ids.length)];
        model.applyTransaction({
          update: [
            {
              id: target,
              changes: {
                num: Math.floor(rng() * 100),
                extra: Math.floor(rng() * 100),
                txt: ALPHABET[Math.floor(rng() * ALPHABET.length)],
              },
            },
          ],
        } as never);
      } else if (roll < 0.85) {
        // Remove + add: the add reuses the released slot, so a stale cell
        // waiting on a freed slot would answer for the WRONG row.
        const { root } = getLocalRowModelSlotInternalsForTesting(model);
        const ids = [...root.rows.entries()].map(([rowId]) => String(rowId));
        const target = ids[Math.floor(rng() * ids.length)];
        model.applyTransaction({ remove: [target] } as never);
        model.applyTransaction({
          add: [randomRow(rng, `r${nextId++}`)],
        } as never);
      } else {
        // setRows: arbitrary replacement under the SAME plan (wholesale
        // columnar reset on the commit side).
        const { root } = getLocalRowModelSlotInternalsForTesting(model);
        const survivors = [...root.rows.entries()]
          .map(([, record]) => record.row as Row)
          .filter(() => rng() < 0.7);
        model.setRows([
          ...survivors.map((row) =>
            rng() < 0.3 ? { ...row, num: Math.floor(rng() * 100) } : row,
          ),
          randomRow(rng, `r${nextId++}`),
        ]);
      }
    }
    // The script really exercised the scan path, repeatedly.
    expect(filterCommits).toBeGreaterThan(10);
    expect(instrumented.diagnostics.read().work.columnarVerdictScans).toBe(
      filterCommits,
    );
    model.dispose();
  });
});

describe("scan work counters", () => {
  const ROWS: readonly Row[] = Object.freeze([
    { id: "a", num: 1, extra: 10, txt: "aa" },
    { id: "b", num: 2, extra: 20, txt: "ab" },
    { id: "c", num: 3, extra: 30, txt: "ba" },
  ]);

  const passEverything = (jitter: number): PretableQueryFor<FixtureColumns> =>
    queryFor({
      filters: [
        { columnId: "num", operator: "gte", value: -1000 + jitter },
        { columnId: "txt", operator: "contains", value: "" },
      ],
      sort: [],
      rowGroups: [],
    });

  test("THE zero-fills pin: a second filter-only commit on unchanged data performs ZERO fills", () => {
    const instrumented = createInstrumentedLocalRowModel({
      rows: ROWS,
      columns: createColumns(),
      getRowId: (row: Row) => row.id,
      query: passEverything(0),
    });
    const model = instrumented.model;
    const work = () => instrumented.diagnostics.read().work;
    expect(work().columnarVerdictScans).toBe(0);
    expect(work().columnarCellFills).toBe(0);

    // First filter-only commit: every cell is a hole (the initial build
    // never writes), so the scan fills 3 rows × 2 filter columns. The first
    // filter passes every row, so the second filter's cells fill too — the
    // count is exact, not a bound (the positive twin the zero assertion
    // below needs: fills demonstrably HAPPEN when cells are absent).
    model.setQuery(passEverything(1));
    expect(work().columnarVerdictScans).toBe(1);
    expect(work().columnarCellFills).toBe(ROWS.length * 2);

    // Second filter-only commit, data untouched: the adopted cells serve
    // every verdict — ZERO fills. This is the milestone's work assertion:
    // the store, not the accessors, now answers repeat filter commits.
    model.setQuery(passEverything(2));
    expect(work().columnarVerdictScans).toBe(2);
    expect(work().columnarCellFills).toBe(ROWS.length * 2);
    model.dispose();
  });
});

describe("setDerivations plan reuse resets the columnar store", () => {
  /**
   * The laundering sequence the Task 3 review flagged. `setDerivations`'
   * plan-REUSE branch (`derivationsEqualForPlan` compares accessors only
   * for columns the CURRENT query references) keeps the shared store even
   * though an UNREFERENCED column's accessor changed. The stale cells
   * cannot bite immediately — re-adding the filter right away classifies
   * as derivations-changed against the still-old plan and recompiles from
   * scratch — but one intermediate filter-only adoption puts a NEW-accessor
   * plan on the SAME store, and from there a re-added filter on the column
   * is filter-only and would scan the old accessor's cells. The reuse
   * branch therefore resets the store.
   */
  test("re-added filter on a swapped-accessor column sees the NEW accessor's values", () => {
    interface SwapRow {
      id: string;
      value: number;
      label: string;
    }
    const swapHelper = createColumnHelper<SwapRow>();
    // The label column is SHARED between both derivation sets: plan reuse
    // demands accessor identity for every referenced column, and at the
    // setDerivations step only `label` is referenced. Only the value
    // accessor (unreferenced there) differs.
    const labelColumn = swapHelper.accessor(
      "label",
      (row: SwapRow) => row.label,
      { type: "text" },
    );
    const buildColumns = (scale: number) =>
      [
        swapHelper.accessor("value", (row: SwapRow) => row.value * scale, {
          type: "number",
        }),
        labelColumn,
      ] as const;
    type SwapColumns = ReturnType<typeof buildColumns>;
    const withValueFilter = (
      threshold: number,
      labelNeedle: string,
    ): PretableQueryFor<SwapColumns> => ({
      filters: [
        { columnId: "value", operator: "gte", value: threshold },
        { columnId: "label", operator: "contains", value: labelNeedle },
      ],
      sort: [],
      rowGroups: [],
    });
    const labelOnly = (needle: string): PretableQueryFor<SwapColumns> => ({
      filters: [{ columnId: "label", operator: "contains", value: needle }],
      sort: [],
      rowGroups: [],
    });
    const model = createLocalRowModel({
      rows: [
        { id: "a", value: 1, label: "alpha" },
        { id: "b", value: 2, label: "beta" },
        { id: "c", value: 3, label: "gamma" },
      ],
      columns: buildColumns(1),
      getRowId: (row: SwapRow) => row.id,
      query: withValueFilter(-1000, ""),
    });
    const visibleIds = () =>
      model
        .getState()
        .snapshot.range(0, Number.MAX_SAFE_INTEGER)
        .flatMap((row) =>
          (row as { kind: string }).kind === "data"
            ? [String((row as { rowId: unknown }).rowId)]
            : [],
        );

    // 1. Filter-only commit while `value` is filtered: the scan fills
    //    value's cells under the ORIGINAL accessor (1, 2, 3).
    model.setQuery(withValueFilter(-999, ""));
    expect(visibleIds()).toEqual(["a", "b", "c"]);

    // 2. Remove the value filter — filter-only, the store is ADOPTED, so
    //    value's cells ride along even though nothing references the column.
    model.setQuery(labelOnly(""));
    expect(visibleIds()).toEqual(["a", "b", "c"]);

    // 3. setDerivations swapping value's accessor (×10). The current query
    //    references only `label`, whose accessor is identity-unchanged, so
    //    the plan is REUSED — this is the branch under test: without its
    //    reset, value's ×1 cells survive on the shared store.
    void model.setDerivations(buildColumns(10) as never);

    // 4. An intermediate filter-only commit on the OTHER column: the
    //    new-accessor plan adopts the same store. This is the step that
    //    launders the delta — both plans now agree accessor-for-accessor,
    //    so the next step is classified filter-only.
    model.setQuery(labelOnly("a") as never);
    expect(visibleIds()).toEqual(["a", "b", "c"]);

    // 5. Re-add the value filter (filter-only). Verdicts MUST reflect the
    //    NEW accessor: values are 10/20/30, so gte 25 keeps exactly c.
    //    Under stale ×1 cells (1/2/3) nobody passes — the outcomes are
    //    disjoint, so the fixture can disprove.
    model.setQuery(withValueFilter(25, "a") as never);
    expect(visibleIds()).toEqual(["c"]);
    model.dispose();
  });
});

describe("accessor-error semantics", () => {
  test("a throwing accessor during the scan surfaces the SAME accessor-failed shape as the per-row path", () => {
    interface BoomRow {
      id: string;
      value: number;
    }
    const boomHelper = createColumnHelper<BoomRow>();
    const boom = new Error("boom");
    const columns = [
      boomHelper.accessor(
        "value",
        (row: BoomRow): number => {
          if (row.id === "bad") throw boom;
          return row.value;
        },
        { type: "number" },
      ),
    ] as const;
    type BoomColumns = typeof columns;
    const query: PretableQueryFor<BoomColumns> = {
      filters: [{ columnId: "value", operator: "gte", value: 0 }],
      sort: [],
      rowGroups: [],
    };
    const plan = compileQuery({ derivations: columns, query });
    const input = {
      rowId: "bad",
      row: { id: "bad", value: 1 },
      sourceOrder: 0,
      slot: 0,
    };
    const capture = (run: () => unknown): PretableRowModelError => {
      let thrown: unknown;
      try {
        run();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(PretableRowModelError);
      return thrown as PretableRowModelError;
    };

    // Per-row first, then the scan: the scan's slot 0 cell is a hole, so it
    // takes the accessor fallback — the same `#readColumnValue` seam.
    const perRow = capture(() => filterVerdict(plan, input as never));
    const scanned = capture(() => bulkFilterVerdictScan(plan, input as never));
    expect(scanned.code).toBe("accessor-failed");
    expect(scanned.code).toBe(perRow.code);
    expect(scanned.columnId).toBe(perRow.columnId);
    expect(scanned.rowId).toBe(perRow.rowId);
    expect(scanned.cause).toBe(boom);
    expect(perRow.cause).toBe(boom);
    expect(scanned.message).toBe(perRow.message);
  });
});
