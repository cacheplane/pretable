import { describe, expect, test } from "vitest";

import { createColumnHelper, createLocalRowModel } from "../index";
import {
  createCooperativeTransitionRuntime,
  runCooperativeTransitionSlice,
  TRANSITION_CLOCK_CHECK_STRIDE,
  type CooperativeTransitionScheduler,
} from "../cooperative-transition";
import { getLocalRowModelActiveTransitionCandidateForTesting } from "../create-local-row-model";

/**
 * #500: applying row grouping cost seconds because the cooperative grouped
 * candidate charged one seal unit per (row × aggregated column × population
 * root) and consulted the budget clock once per unit. These tests pin the
 * coarsened accounting — one seal unit per ROW — and the amortized clock.
 */

interface Row {
  readonly id: number;
  readonly team: string;
  readonly score: number;
  readonly m0: number;
  readonly m1: number;
  readonly m2: number;
  readonly m3: number;
  readonly m4: number;
  readonly m5: number;
  readonly m6: number;
  readonly m7: number;
}

const AGGREGATED_COLUMN_COUNT = 8;
const TEAMS = ["Alpha", "Beta", "Gamma", "Delta"] as const;

/** Per-column-distinct values so a cross-column mixup cannot pass. */
function metric(id: number, column: number): number {
  return ((id * 31 + column * 7) % 101) + column * 1_000;
}

function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, id) => ({
    id,
    team: TEAMS[id % TEAMS.length]!,
    score: id,
    m0: metric(id, 0),
    m1: metric(id, 1),
    m2: metric(id, 2),
    m3: metric(id, 3),
    m4: metric(id, 4),
    m5: metric(id, 5),
    m6: metric(id, 6),
    m7: metric(id, 7),
  }));
}

const helper = createColumnHelper<Row>();

function makeColumns() {
  return [
    helper.accessor("team", { type: "text" }),
    helper.accessor("score", { type: "number" }),
    helper.accessor("m0", { type: "number", aggregate: "sum" }),
    helper.accessor("m1", { type: "number", aggregate: "avg" }),
    helper.accessor("m2", { type: "number", aggregate: "min" }),
    helper.accessor("m3", { type: "number", aggregate: "max" }),
    helper.accessor("m4", { type: "number", aggregate: "sum" }),
    helper.accessor("m5", { type: "number", aggregate: "avg" }),
    helper.accessor("m6", { type: "number", aggregate: "min" }),
    helper.accessor("m7", { type: "number", aggregate: "max" }),
  ] as const;
}

interface ScheduledEntry {
  readonly task: () => void;
  cancelled: boolean;
}

class ManualScheduler implements CooperativeTransitionScheduler {
  readonly entries: ScheduledEntry[] = [];

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

function groupAggregates(model: {
  getState(): { snapshot: { range(a: number, b: number): readonly unknown[] } };
}) {
  const byGroup = new Map<string, Readonly<Record<string, unknown>>>();
  for (const row of model
    .getState()
    .snapshot.range(0, Number.MAX_SAFE_INTEGER)) {
    const candidate = row as {
      kind: string;
      groupId: string;
      aggregates: Readonly<Record<string, unknown>>;
    };
    if (candidate.kind === "group") {
      byGroup.set(candidate.groupId, { ...candidate.aggregates });
    }
  }
  return byGroup;
}

describe("grouping-apply cooperative cost (#500)", () => {
  test("the grouped candidate charges O(R) units, not R × columns × roots", () => {
    // R = 600 rows over 8 aggregated columns and 4 groups. Charged units:
    //   insert phase: exactly R (one row evaluated per unit), then
    //   seal phase:   one unit per ROW (all aggregated columns and both
    //                 population roots sealed together) plus 2 node units
    //                 per group (finalize + parent/root edge).
    // The old accounting charged R × 8 columns × 2 roots = 16R seal units,
    // which cannot fit under R + C for any small constant C.
    const rowCount = 600;
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: makeRows(rowCount),
      columns: makeColumns(),
      getRowId: (row) => row.id,
      query: { filters: [], sort: [], rowGroups: [] },
      transitionScheduler: scheduler,
      // Frozen clock: the 256-unit cap alone bounds each slice, so the
      // charged totals below are deterministic.
      transitionClock: () => 0,
    });
    const transition = model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "team", direction: "asc" }],
    });
    const candidate =
      getLocalRowModelActiveTransitionCandidateForTesting(model);
    expect(candidate).toBeDefined();
    let maxTotalRows = 0;
    let flushed = 0;
    while (model.getState().status.kind !== "ready") {
      maxTotalRows = Math.max(maxTotalRows, candidate!.totalRows);
      if (!scheduler.flushOne()) break;
      flushed += 1;
      if (flushed > 100_000) throw new Error("Transition did not settle.");
    }
    expect(model.getState().status).toEqual({ kind: "ready" });
    void transition;

    // The seal-phase charge is everything added on top of the R insert
    // units: pin it to R + C (C = 64 covers the per-group finalize/edge
    // units and completion bookkeeping with slack).
    const sealCharge = maxTotalRows - rowCount;
    expect(sealCharge).toBeGreaterThan(0);
    expect(sealCharge).toBeLessThanOrEqual(rowCount + 64);
    // Control: the fixture really carries enough aggregated columns that
    // per-column charging (≥ 8 × R) cannot slip under the pin.
    expect(AGGREGATED_COLUMN_COUNT * rowCount).toBeGreaterThan(rowCount + 64);
  });

  for (const aggregateFilteredRows of [false, true]) {
    test(`aggregates survive the per-row seal (aggregateFilteredRows: ${aggregateFilteredRows})`, async () => {
      // 41 rows (not a multiple of the team count) with per-column-distinct
      // values, and a filter that removes rows so the two population roots
      // MUST differ — the fixture can disprove a wrong-population read.
      const rowCount = 41;
      const rows = makeRows(rowCount);
      const scheduler = new ManualScheduler();
      let tick = 0;
      const model = createLocalRowModel({
        rows,
        columns: makeColumns(),
        getRowId: (row) => row.id,
        aggregateFilteredRows,
        initialExpansion: { kind: "expanded" },
        query: { filters: [], sort: [], rowGroups: [] },
        transitionScheduler: scheduler,
        transitionClock: () => tick++,
        transitionBudgetMs: 1,
      });
      const transition = model.setQuery({
        filters: [{ columnId: "score", operator: "gte", value: 15 }],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "team", direction: "asc" }],
      });
      let flushed = 0;
      while (scheduler.flushOne()) {
        flushed += 1;
        if (flushed > 100_000) throw new Error("Transition did not settle.");
      }
      await transition.finished;
      expect(model.getState().status).toEqual({ kind: "ready" });

      // Expected values computed independently from the raw fixture.
      const expectAggregates = (team: string) => {
        const population = rows.filter(
          (row) =>
            row.team === team && (aggregateFilteredRows || row.score >= 15),
        );
        const values = (column: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7) =>
          population.map((row) => row[`m${column}`]);
        const sum = (items: number[]) =>
          items.reduce((total, value) => total + value, 0);
        return {
          m0: sum(values(0)),
          m1: sum(values(1)) / values(1).length,
          m2: Math.min(...values(2)),
          m3: Math.max(...values(3)),
          m4: sum(values(4)),
          m5: sum(values(5)) / values(5).length,
          m6: Math.min(...values(6)),
          m7: Math.max(...values(7)),
        };
      };
      const actual = groupAggregates(model);
      expect(actual.size).toBe(TEAMS.length);
      for (const [groupId, aggregates] of actual) {
        const team = TEAMS.find((name) => groupId.includes(name));
        expect(team).toBeDefined();
        expect(aggregates).toEqual(expectAggregates(team!));
      }
      // Control: the two populations genuinely disagree under this filter,
      // so a wrong-root read cannot produce these numbers by accident.
      const alphaFiltered = rows.filter(
        (row) => row.team === "Alpha" && row.score >= 15,
      );
      const alphaAll = rows.filter((row) => row.team === "Alpha");
      expect(alphaFiltered.length).not.toBe(alphaAll.length);
    });
  }

  test("a full 8k-row grouped rebuild completes within the derived slice bound", () => {
    // Charged units ≈ R inserts + R row-seals + 2 units per group node +
    // completion bookkeeping ≈ 2R + small. With the clock frozen, every
    // slice runs exactly the 256-unit cap, so slices ≈ ceil((2 × 8_000 +
    // small) / 256) ≈ 63. The bound below allows ~1.5× headroom; the old
    // per-(row × column × root) accounting needed ~530 slices here and
    // ~9,540 at the 50k bench scale.
    const rowCount = 8_000;
    const scheduler = new ManualScheduler();
    const model = createLocalRowModel({
      rows: makeRows(rowCount),
      columns: makeColumns(),
      getRowId: (row) => row.id,
      query: { filters: [], sort: [], rowGroups: [] },
      transitionScheduler: scheduler,
      transitionClock: () => 0,
    });
    model.setQuery({
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "team", direction: "asc" }],
    });
    let slices = 0;
    while (scheduler.flushOne()) {
      slices += 1;
      if (slices > 100_000) throw new Error("Transition did not settle.");
    }
    expect(model.getState().status).toEqual({ kind: "ready" });
    expect(slices).toBeGreaterThan(0);
    expect(slices).toBeLessThanOrEqual(100);
  });

  test("the budget clock is consulted at unit one and then once per stride", () => {
    // The clock advances 0.1 per reading against the default 0.25ms budget:
    //   startedAt reads 0; the first-unit check reads 0.1 (< 0.25, go on);
    //   the stride-boundary check at unit 32 reads 0.2 (< 0.25, go on);
    //   the check at unit 64 reads 0.3 (>= 0.25, stop).
    // Exactly two strides run. This is the test that consumes the stride
    // constant: a per-unit clock check stops after 3 units and fails it.
    let tick = 0;
    let steps = 0;
    const runtime = createCooperativeTransitionRuntime({
      scheduler: { schedule: () => () => {} },
      now: () => {
        const current = tick;
        tick += 0.1;
        return current;
      },
    });
    expect(
      runCooperativeTransitionSlice(runtime, () => {
        steps += 1;
        return false;
      }),
    ).toBe(false);
    expect(steps).toBe(2 * TRANSITION_CLOCK_CHECK_STRIDE);
    // The hard unit cap must remain a whole number of strides so the cap
    // still lands exactly (decision 3: budget and cap are untouched).
    expect(runtime.maxUnitsPerSlice % TRANSITION_CLOCK_CHECK_STRIDE).toBe(0);
  });

  test("an over-budget first unit still ends the slice immediately", () => {
    // Units can run arbitrary consumer code (custom aggregators/accessors).
    // The first-unit clock check keeps a slice honest when one unit alone
    // blows the budget — and it is what lets tests drive one-unit slices
    // with a whole-millisecond ticking clock.
    let tick = 0;
    let steps = 0;
    const runtime = createCooperativeTransitionRuntime({
      scheduler: { schedule: () => () => {} },
      now: () => tick++,
    });
    expect(
      runCooperativeTransitionSlice(runtime, () => {
        steps += 1;
        return false;
      }),
    ).toBe(false);
    expect(steps).toBe(1);
  });
});
