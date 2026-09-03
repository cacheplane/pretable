# S8 PMS Benchmark Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add scenario `S8` (a 20k-position portfolio-management workload with a price-tick ripple stream and strategy→sector grouping) to the bench, measured flat and grouped, as committed baselines with no new gates.

**Architecture:** `packages/scenario-data` gains a `roles` block on every dataset that names the sort/filter/group/aggregate/stream columns; the four bench files that hardcode `col_N` read roles instead. S1–S7 declare roles equal to today's literals so nothing they measure moves. The update-plan generator gains a `ripple` mode that emits multi-cell patches; the runtime forwards `changes` whole. `packages/bench-runner` admits S8 to the script allowlists it can run.

**Tech Stack:** TypeScript, vitest (`--environment jsdom` in apps/bench), Playwright for the bench e2e, pnpm workspaces. Node 24 required (see memory `reference_pretable_node24_worktree_trap`).

**Spec:** `docs/superpowers/specs/2026-08-30-pms-benchmark-profile-design.md`. The spec outranks this plan; this plan outranks your assumptions; **the code outranks both** — if a file does not look like the snippet here, read it and adapt, and say so in your report.

**Run tests from the worktree root**, never from `~/repos/pretable`:

```bash
pnpm --filter @pretable-internal/scenario-data test
pnpm --filter @pretable/app-bench test
pnpm --filter @pretable-internal/bench-runner test
```

If a filter runs zero tests and exits 0, the filter name is wrong (memory: `reference_pretable_node24_worktree_trap`). Check `name` in the package's `package.json`.

---

## File map

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/scenario-data/src/index.ts` | scenario registry, generic generator, public types | add `type` to `ScenarioColumn`, `ScenarioRoles`/`ScenarioStream` types, `roles` on `ScenarioDataset`, `legacyScenarioRoles`, S8 registration |
| `packages/scenario-data/src/pms-profile.ts` | **new** — S8 columns, rows, derivation, roles | create |
| `packages/scenario-data/src/__tests__/scenario-data.test.ts` | registry tests | add S8 + roles tests |
| `packages/scenario-data/src/__tests__/pms-profile.test.ts` | **new** — S8 data invariants | create |
| `apps/bench/src/bench-types.ts` | query-state type | `"S8"` in union |
| `apps/bench/src/query-state.ts` | URL parsing | accept `S8` |
| `apps/bench/src/update-plan.ts` | deterministic patch schedule | `roles` input; `ripple` mode; widened grouping types |
| `apps/bench/src/bench-runtime.ts` | measurement loop | forward `changes`; pass roles |
| `apps/bench/src/interaction-plan.ts` | per-script plan | roles-driven; tuple group keys |
| `apps/bench/src/row-model-diagnostics.ts` | row-model gate controller | typing via roles; tuple group tracking |
| `apps/bench/src/pretable-adapter.tsx` | pretable bench adapter | roles for `updates-grouped` |
| `apps/bench/src/bench-app.tsx` | script dispatch | one call-site signature change |
| `packages/bench-runner/src/index.ts` | script/scenario allowlists | admit S8 |

---

### Task 1: Roles types and legacy roles in scenario-data

**Files:**
- Modify: `packages/scenario-data/src/index.ts`
- Test: `packages/scenario-data/src/__tests__/scenario-data.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `describe("scenario-data registry")` in `scenario-data.test.ts`:

```ts
  test.each(["S1", "S2", "S3", "S4", "S5", "S6", "S7"] as const)(
    "%s declares roles equal to the bench's historical col_N picks",
    (id) => {
      // These literals are what apps/bench hardcoded before roles existed.
      // Changing any of them moves an existing baseline; do that on purpose,
      // in its own PR, never here.
      expect(createScenarioDataset(id).roles).toEqual({
        sortColumnId: "col_3",
        textFilter: { columnId: "col_0", value: "Bonjour" },
        metadataFilter: { columnId: "col_6", value: "running" },
        groupColumnIds: ["col_5"],
        streamingGrouping: {
          groupColumnIds: ["col_1"],
          aggregateColumnId: "col_3",
        },
        stream: { mode: "uniform-cell" },
      });
    },
  );

  test("legacy columns carry no explicit type", () => {
    const dataset = createScenarioDataset("S5");
    expect(dataset.columns.every((column) => column.type === undefined)).toBe(
      true,
    );
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable-internal/scenario-data test -- scenario-data`
Expected: FAIL — `roles` is `undefined`.

- [ ] **Step 3: Add the types and legacy roles**

In `packages/scenario-data/src/index.ts`, replace the `ScenarioColumn` interface and add the roles types directly after `ScenarioRow`:

```ts
export interface ScenarioColumn {
  id: string;
  header: string;
  wrap: boolean;
  widthPx?: number;
  pinned?: "left";
  /**
   * Value type. Absent means "legacy typing": the bench types the
   * `roles.sortColumnId` column as number and everything else as text, which
   * is exactly what it did before this field existed.
   */
  type?: "text" | "number";
}

export type ScenarioRow = Record<string, string | number>;

export interface ScenarioStreamUniformCell {
  readonly mode: "uniform-cell";
}

export interface ScenarioStreamRipple {
  readonly mode: "ripple";
  /** The column each patch moves. */
  readonly tickColumnId: string;
  /** Columns recomputed from the moved tick in the same patch. */
  readonly derivedColumnIds: readonly string[];
  /**
   * Recompute `derivedColumnIds` from a row whose tick column has already
   * been updated. Returns only the derived cells.
   */
  derive(row: ScenarioRow): Readonly<Record<string, number>>;
}

export type ScenarioStream = ScenarioStreamUniformCell | ScenarioStreamRipple;

/**
 * Which columns the bench scripts act on. Read by apps/bench instead of the
 * `col_N` literals it used to carry — see the 2026-08-30 PMS profile spec.
 */
export interface ScenarioRoles {
  /** Numeric column the `sort` script orders by. */
  readonly sortColumnId: string;
  readonly textFilter: { readonly columnId: string; readonly value: string };
  readonly metadataFilter: {
    readonly columnId: string;
    readonly value: string;
  };
  /**
   * Grouping levels, outermost first, for `group`, `group-expand`,
   * `group-updates` and `group-updates-stable-keys`.
   */
  readonly groupColumnIds: readonly string[];
  /**
   * Grouping for `updates-grouped` and the row-model diagnostics controller.
   * Kept separate from `groupColumnIds` because the bench has always grouped
   * those two families on DIFFERENT columns (col_5 vs col_1), and reproducing
   * that is what keeps S5's baselines still.
   */
  readonly streamingGrouping: {
    readonly groupColumnIds: readonly string[];
    readonly aggregateColumnId: string;
  };
  readonly stream: ScenarioStream;
}

/** The bench's pre-roles column picks, verbatim. Every S1–S7 dataset uses it. */
export const legacyScenarioRoles: ScenarioRoles = Object.freeze({
  sortColumnId: "col_3",
  textFilter: Object.freeze({ columnId: "col_0", value: "Bonjour" }),
  metadataFilter: Object.freeze({ columnId: "col_6", value: "running" }),
  groupColumnIds: Object.freeze(["col_5"]),
  streamingGrouping: Object.freeze({
    groupColumnIds: Object.freeze(["col_1"]),
    aggregateColumnId: "col_3",
  }),
  stream: Object.freeze({ mode: "uniform-cell" as const }),
});
```

Add `roles: ScenarioRoles;` to `ScenarioDataset` after `seed`, and in `createScenarioDataset` add `roles: legacyScenarioRoles,` to the returned object.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable-internal/scenario-data test -- scenario-data`
Expected: PASS.

- [ ] **Step 5: Typecheck the consumers**

Run: `pnpm --filter @pretable-internal/scenario-data typecheck && pnpm --filter @pretable/app-bench typecheck`
Expected: both pass. `roles` is additive; the bench's test fixtures that build `ScenarioDataset` literals by hand (search `apps/bench/src/__tests__` for `rowCount:`) may now fail typecheck for the missing field — add `roles: legacyScenarioRoles` (imported from `@pretable-internal/scenario-data`) to each such literal.

- [ ] **Step 6: Commit**

```bash
git add packages/scenario-data apps/bench/src/__tests__
git commit -m "feat(scenario-data): scenario-declared column roles, legacy roles on S1-S7"
```

---

### Task 2: The S8 dataset generator

**Files:**
- Create: `packages/scenario-data/src/pms-profile.ts`
- Create: `packages/scenario-data/src/__tests__/pms-profile.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";

import {
  buildPmsRows,
  derivePmsRow,
  PMS_SECTORS,
  PMS_STRATEGIES,
  pmsColumns,
} from "../pms-profile";

describe("S8 pms-positions generator", () => {
  test("has 40 named columns, two pinned, notes wrapped, every column typed", () => {
    expect(pmsColumns).toHaveLength(40);
    expect(pmsColumns.slice(0, 2).map((c) => c.pinned)).toEqual(["left", "left"]);
    expect(pmsColumns.filter((c) => c.wrap).map((c) => c.id)).toEqual(["notes"]);
    expect(pmsColumns.every((c) => c.type === "number" || c.type === "text")).toBe(true);
    expect(pmsColumns.filter((c) => c.type === "number")).toHaveLength(30);
  });

  test.each([120, 750, 3_000, 20_000])(
    "%i rows hold exactly 88 strategy×sector groups and every strategy and sector",
    (count) => {
      const rows = buildPmsRows(808, count);
      const pairs = new Set(rows.map((r) => `${r.strategy} ${r.sector}`));
      expect(pairs.size).toBe(88);
      expect(new Set(rows.map((r) => r.strategy)).size).toBe(PMS_STRATEGIES.length);
      expect(new Set(rows.map((r) => r.sector)).size).toBe(PMS_SECTORS.length);
    },
  );

  test("is deterministic per seed and row-stable across scales", () => {
    expect(buildPmsRows(808, 300)).toEqual(buildPmsRows(808, 300));
    expect(buildPmsRows(808, 300)).not.toEqual(buildPmsRows(809, 300));
    // Row i at a small scale is row i at a larger one, so a smoke run
    // looks at the same positions target does.
    expect(buildPmsRows(808, 300)).toEqual(buildPmsRows(808, 3_000).slice(0, 300));
  });

  test("derived columns satisfy their formulas on every generated row", () => {
    for (const row of buildPmsRows(808, 750)) {
      expect(derivePmsRow(row)).toEqual({
        marketValue: row.marketValue,
        unrealizedPnl: row.unrealizedPnl,
        dayPnl: row.dayPnl,
        dayChangePct: row.dayChangePct,
      });
      expect(Number(row.lastPrice)).toBeGreaterThan(0);
      expect(Number(row.quantity)).toBeGreaterThan(0);
    }
  });

  test("tickers are unique and the filter probes hit a strict subset", () => {
    const rows = buildPmsRows(808, 3_000);
    expect(new Set(rows.map((r) => r.ticker)).size).toBe(rows.length);
    expect(PMS_SECTORS).toContain("Technology");
    const earnings = rows.filter((r) => String(r.notes).includes("earnings"));
    expect(earnings.length).toBeGreaterThan(0);
    expect(earnings.length).toBeLessThan(rows.length);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable-internal/scenario-data test -- pms-profile`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the generator**

`packages/scenario-data/src/pms-profile.ts`:

```ts
import type { ScenarioColumn, ScenarioRow } from "./index";

export const PMS_STRATEGIES = [
  "Long/Short Equity",
  "Event Driven",
  "Global Macro",
  "Credit",
  "Quant Equity",
  "Convertible Arb",
  "Merger Arb",
  "Distressed",
] as const;

export const PMS_SECTORS = [
  "Technology",
  "Health Care",
  "Financials",
  "Consumer Discretionary",
  "Industrials",
  "Energy",
  "Materials",
  "Utilities",
  "Real Estate",
  "Communication Services",
  "Consumer Staples",
] as const;

const books = ["Alpha", "Beta", "Gamma", "Delta", "Omega"] as const;
const assetClasses = ["Equity", "Bond", "Option", "Future", "ETF"] as const;
const regions = ["US", "EU", "UK", "JP", "APAC", "LATAM"] as const;
const currencies = ["USD", "EUR", "GBP", "JPY", "CHF"] as const;
const traders = ["akim", "bpatel", "cwu", "dnovak", "emorales", "fokafor"] as const;
const tickerPrefixes = ["AAP", "MSF", "NVD", "AMZ", "GOO", "MET", "BRK", "JPM", "XOM", "UNH", "LLY", "AVG", "TSM", "NVO", "ASM"] as const;

/** Sentences the notes column is stitched from. Three of eight mention
 *  earnings so the `filter-text` probe ("earnings") hits a strict subset. */
const noteFragments = [
  "Trimmed into strength ahead of the earnings print.",
  "Position sized to the desk's sector limit.",
  "Hedged with index futures after the guidance cut.",
  "Watching earnings revisions for a re-rate.",
  "Liquidity thin below the 30-day average; work orders slowly.",
  "Core holding; add on any 5% pullback.",
  "Post-earnings drift still playing out.",
  "Rates sensitivity higher than the model implies.",
] as const;

const identityColumns: readonly ScenarioColumn[] = [
  { id: "ticker", header: "Ticker", wrap: false, widthPx: 110, pinned: "left", type: "text" },
  { id: "name", header: "Name", wrap: false, widthPx: 200, pinned: "left", type: "text" },
  { id: "strategy", header: "Strategy", wrap: false, widthPx: 150, type: "text" },
  { id: "sector", header: "Sector", wrap: false, widthPx: 170, type: "text" },
  { id: "book", header: "Book", wrap: false, widthPx: 100, type: "text" },
  { id: "assetClass", header: "Asset class", wrap: false, widthPx: 110, type: "text" },
  { id: "region", header: "Region", wrap: false, widthPx: 90, type: "text" },
  { id: "currency", header: "Ccy", wrap: false, widthPx: 80, type: "text" },
  { id: "trader", header: "Trader", wrap: false, widthPx: 110, type: "text" },
  { id: "notes", header: "Notes", wrap: true, widthPx: 260, type: "text" },
];

const numericColumnIds = [
  "quantity", "lastPrice", "prevClose", "avgCost", "marketValue",
  "unrealizedPnl", "dayPnl", "dayChangePct", "weightPct", "costBasis",
  "realizedPnl", "mtdPnl", "ytdPnl", "beta", "delta", "gamma", "vega",
  "theta", "dv01", "var95", "grossExposure", "netExposure", "leverage",
  "impliedVol", "bidPrice", "askPrice", "volume", "adv30d",
  "daysToLiquidate", "lotCount",
] as const;

export const pmsColumns: readonly ScenarioColumn[] = Object.freeze([
  ...identityColumns,
  ...numericColumnIds.map(
    (id): ScenarioColumn => ({
      id,
      header: humanize(id),
      wrap: false,
      widthPx: 110,
      type: "number",
    }),
  ),
]);

/** The four columns a price tick ripples into. Pure function of the row. */
export function derivePmsRow(row: ScenarioRow): Readonly<Record<string, number>> {
  const quantity = Number(row.quantity);
  const lastPrice = Number(row.lastPrice);
  const prevClose = Number(row.prevClose);
  const avgCost = Number(row.avgCost);
  const marketValue = round(quantity * lastPrice, 2);
  return Object.freeze({
    marketValue,
    unrealizedPnl: round(marketValue - round(quantity * avgCost, 2), 2),
    dayPnl: round(quantity * (lastPrice - prevClose), 2),
    dayChangePct: round(((lastPrice - prevClose) / prevClose) * 100, 4),
  });
}

export function buildPmsRows(seed: number, count: number): readonly ScenarioRow[] {
  return Array.from({ length: count }, (_, rowIndex) =>
    buildPmsRow(seed, rowIndex),
  );
}

function buildPmsRow(seed: number, rowIndex: number): ScenarioRow {
  // Seeded per row so row i is identical at every scale.
  const random = mulberry32((Math.imul(seed, 1_000_003) + rowIndex) >>> 0);
  const pick = <T,>(pool: readonly T[]) => pool[Math.floor(random() * pool.length)]!;
  const between = (lo: number, hi: number, decimals: number) =>
    round(lo + random() * (hi - lo), decimals);

  const strategy = PMS_STRATEGIES[rowIndex % PMS_STRATEGIES.length]!;
  const sector =
    PMS_SECTORS[Math.floor(rowIndex / PMS_STRATEGIES.length) % PMS_SECTORS.length]!;
  const prefix = pick(tickerPrefixes);
  const quantity = Math.floor(between(100, 250_000, 0));
  const lastPrice = between(1, 900, 2);
  const prevClose = round(lastPrice * (1 + between(-0.05, 0.05, 4)), 2);
  const avgCost = round(lastPrice * (1 + between(-0.3, 0.3, 4)), 2);
  const fragmentCount = 1 + Math.floor(random() * 4);
  const notes = Array.from({ length: fragmentCount }, () => pick(noteFragments)).join(" ");

  const row: ScenarioRow = {
    id: `S8-row-${rowIndex}`,
    ticker: `${prefix}${rowIndex}`,
    name: `${prefix} Holdings ${rowIndex}`,
    strategy,
    sector,
    book: pick(books),
    assetClass: pick(assetClasses),
    region: pick(regions),
    currency: pick(currencies),
    trader: pick(traders),
    notes,
    quantity,
    lastPrice,
    prevClose,
    avgCost,
    marketValue: 0,
    unrealizedPnl: 0,
    dayPnl: 0,
    dayChangePct: 0,
    weightPct: between(0, 4, 4),
    costBasis: round(quantity * avgCost, 2),
    realizedPnl: between(-500_000, 500_000, 2),
    mtdPnl: between(-800_000, 800_000, 2),
    ytdPnl: between(-4_000_000, 4_000_000, 2),
    beta: between(-0.5, 2, 3),
    delta: between(-1, 1, 4),
    gamma: between(0, 0.2, 4),
    vega: between(0, 5_000, 2),
    theta: between(-2_000, 0, 2),
    dv01: between(0, 20_000, 2),
    var95: between(0, 2_000_000, 2),
    grossExposure: between(0, 50_000_000, 2),
    netExposure: between(-25_000_000, 25_000_000, 2),
    leverage: between(0.5, 4, 2),
    impliedVol: between(0.1, 1.2, 4),
    bidPrice: round(lastPrice * 0.999, 2),
    askPrice: round(lastPrice * 1.001, 2),
    volume: Math.floor(between(1_000, 50_000_000, 0)),
    adv30d: Math.floor(between(1_000, 60_000_000, 0)),
    daysToLiquidate: between(0.1, 30, 1),
    lotCount: Math.floor(between(1, 40, 0)),
  };
  return Object.assign(row, derivePmsRow(row));
}

function humanize(id: string) {
  return id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function round(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
```

`identityColumns` (10) + `numericColumnIds` (30) = 40. If the type-only import from `./index` creates a circular import warning under eslint, move `ScenarioColumn`/`ScenarioRow` into a new `packages/scenario-data/src/types.ts` and re-export them from `index.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable-internal/scenario-data test -- pms-profile`
Expected: PASS. If the derived-formula test fails on `unrealizedPnl` by a cent, the double-rounding order in `derivePmsRow` and `costBasis` differ — make `costBasis` in `buildPmsRow` use the same `round(quantity * avgCost, 2)` expression (it does above; keep them identical).

- [ ] **Step 5: Commit**

```bash
git add packages/scenario-data/src/pms-profile.ts packages/scenario-data/src/__tests__/pms-profile.test.ts
git commit -m "feat(scenario-data): S8 pms-positions generator"
```

---

### Task 3: Register S8 with its roles

**Files:**
- Modify: `packages/scenario-data/src/index.ts`
- Modify: `packages/scenario-data/src/pms-profile.ts` (add `pmsRoles`)
- Test: `packages/scenario-data/src/__tests__/scenario-data.test.ts`

- [ ] **Step 1: Write the failing tests**

Change the registry-order test's expected array to end `"S7", "S8"`. Append:

```ts
  test("registers S8 pms-positions with the S5 row ladder and named columns", () => {
    expect(getScenarioById("S8")).toMatchObject({
      id: "S8",
      name: "pms-positions",
      rows: 20_000,
      cols: 40,
      row_height_mode: "variable",
      wrapped_columns: 1,
      pinned_left: 2,
      update_stream: { mode: "batched", batch_every_ms: 50 },
    });
    expect(createScenarioDataset("S8").rowCount).toBe(120);
    expect(createScenarioDataset("S8", { scale: "dev" }).rowCount).toBe(750);
    expect(createScenarioDataset("S8", { scale: "hypothesis" }).rowCount).toBe(3_000);
    expect(createScenarioDataset("S8", { scale: "target" }).rowCount).toBe(20_000);
    expect(createScenarioDataset("S8", { scale: "local-max" }).rowCount).toBe(100_000);

    const dataset = createScenarioDataset("S8");
    expect(dataset.seed).toBe(808);
    expect(dataset.columns.map((c) => c.id).slice(0, 3)).toEqual(["ticker", "name", "strategy"]);
    expect(dataset.rows[0]).toMatchObject({ id: "S8-row-0", ticker: expect.any(String) });
  }, 30_000);

  test("S8 roles name the finance columns and a ripple stream", () => {
    const { roles } = createScenarioDataset("S8");
    expect(roles).toMatchObject({
      sortColumnId: "marketValue",
      textFilter: { columnId: "notes", value: "earnings" },
      metadataFilter: { columnId: "sector", value: "Technology" },
      groupColumnIds: ["strategy", "sector"],
      streamingGrouping: {
        groupColumnIds: ["strategy", "sector"],
        aggregateColumnId: "marketValue",
      },
      stream: {
        mode: "ripple",
        tickColumnId: "lastPrice",
        derivedColumnIds: ["marketValue", "unrealizedPnl", "dayPnl", "dayChangePct"],
      },
    });
    expect(roles.stream.mode === "ripple" && typeof roles.stream.derive).toBe("function");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable-internal/scenario-data test -- scenario-data`
Expected: FAIL — `Unknown scenario: S8` / type error on `"S8"`.

- [ ] **Step 3: Register S8**

In `pms-profile.ts` add:

```ts
import type { ScenarioColumn, ScenarioRoles, ScenarioRow } from "./index";

export const pmsRoles: ScenarioRoles = Object.freeze({
  sortColumnId: "marketValue",
  textFilter: Object.freeze({ columnId: "notes", value: "earnings" }),
  metadataFilter: Object.freeze({ columnId: "sector", value: "Technology" }),
  groupColumnIds: Object.freeze(["strategy", "sector"]),
  streamingGrouping: Object.freeze({
    groupColumnIds: Object.freeze(["strategy", "sector"]),
    aggregateColumnId: "marketValue",
  }),
  stream: Object.freeze({
    mode: "ripple" as const,
    tickColumnId: "lastPrice",
    derivedColumnIds: Object.freeze(["marketValue", "unrealizedPnl", "dayPnl", "dayChangePct"]),
    derive: derivePmsRow,
  }),
});
```

In `index.ts`:

1. `export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";`
2. Add to `scenarioScaleRowCounts`: `S8: { smoke: 120, dev: 750, hypothesis: 3_000, target: 20_000, "local-max": 100_000 },`
3. Add to `scenarioSeeds`: `S8: 808,`
4. Append to `scenarioDefinitions` after S7:

```ts
  {
    id: "S8",
    name: "pms-positions",
    rows: 20_000,
    cols: 40,
    row_height_mode: "variable",
    wrapped_columns: 1,
    pinned_left: 2,
    purpose:
      "Portfolio-management cockpit: grouped positions under a price stream.",
    update_stream: {
      mode: "batched",
      batch_every_ms: 50,
      visible_update_rate_per_sec: 200,
      offscreen_update_rate_per_sec: 800,
    },
  },
```

5. Import at the top: `import { buildPmsRows, pmsColumns, pmsRoles } from "./pms-profile";` and re-export: `export { derivePmsRow, PMS_SECTORS, PMS_STRATEGIES } from "./pms-profile";`
6. In `createScenarioDataset`, branch before the return:

```ts
  if (id === "S8") {
    return {
      scenario,
      scale,
      columns: pmsColumns,
      rows: buildPmsRows(seed, rowCount),
      rowCount,
      seed,
      roles: pmsRoles,
    };
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable-internal/scenario-data test && pnpm --filter @pretable-internal/scenario-data typecheck && pnpm --filter @pretable-internal/scenario-data lint`
Expected: all pass. `buildColumns`/`buildRows` must not be reached for S8 — they would emit `col_N`.

- [ ] **Step 5: Commit**

```bash
git add packages/scenario-data
git commit -m "feat(scenario-data): register S8 with finance column roles"
```

---

### Task 4: The bench accepts `scenario=S8`

**Files:**
- Modify: `apps/bench/src/bench-types.ts:8`
- Modify: `apps/bench/src/query-state.ts:40-51`
- Test: `apps/bench/src/__tests__/query-state.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `query-state.test.ts`:

```ts
  test("accepts scenario S8 for the pms profile", () => {
    expect(parseBenchQuery("?scenario=S8&script=group-updates").scenarioId).toBe("S8");
    expect(parseBenchQuery("?scenario=S8&script=group-updates").scriptName).toBe("group-updates");
  });
```

The existing "falls back to safe defaults" test with `scenario=S6` must keep passing — S6 stays unsupported.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- query-state`
Expected: FAIL — `scenarioId` is `"S1"`.

- [ ] **Step 3: Implement**

`bench-types.ts`: `scenarioId: "S1" | "S2" | "S3" | "S4" | "S5" | "S7" | "S8";`

`query-state.ts`, extend the ternary chain:

```ts
              : scenario === "S7"
                ? "S7"
                : scenario === "S8"
                  ? "S8"
                  : DEFAULT_QUERY_STATE.scenarioId,
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- query-state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/src/bench-types.ts apps/bench/src/query-state.ts apps/bench/src/__tests__/query-state.test.ts
git commit -m "feat(bench): accept scenario S8"
```

---

### Task 5: Pin the S5 schedule, then add the ripple mode to the update plan

**Files:**
- Modify: `apps/bench/src/update-plan.ts`
- Test: `apps/bench/src/__tests__/update-plan.test.ts`

- [ ] **Step 1: Capture the current S5 checksum BEFORE touching the generator**

Run from the worktree root:

```bash
cat > /tmp/s5-checksum.test.ts <<'EOF'
import { test } from "vitest";
import { createScenarioDataset } from "@pretable-internal/scenario-data";
import { createDeterministicUpdatePlan } from "../update-plan";
test("print", () => {
  const plan = createDeterministicUpdatePlan({
    dataset: createScenarioDataset("S5", { scale: "target" }), grouped: false, seed: 505,
  });
  console.log("S5_CHECKSUM", plan.scheduleChecksum, plan.ticks[0]!.patches[0]);
});
EOF
cp /tmp/s5-checksum.test.ts apps/bench/src/__tests__/zz-s5-checksum.test.ts
pnpm --filter @pretable/app-bench test -- zz-s5-checksum 2>&1 | grep S5_CHECKSUM
rm apps/bench/src/__tests__/zz-s5-checksum.test.ts
```

Record the printed `fnv1a-xxxxxxxx` value and the first patch's `id`/`columnId`. If nothing prints, the filter name is wrong — see the note at the top of this plan.

- [ ] **Step 2: Write the failing tests**

Add to `update-plan.test.ts` (replace `<CHECKSUM>`, `<ID>`, `<COL>` with the values from Step 1):

```ts
  test("keeps the S5 uniform-cell schedule byte-identical (negative control)", () => {
    const plan = createDeterministicUpdatePlan({
      dataset: createScenarioDataset("S5", { scale: "target" }),
      grouped: false,
      seed: 505,
    });
    // Captured before the ripple mode existed. A change here means an S5
    // baseline moved; that is never a side effect, always its own PR.
    expect(plan.scheduleChecksum).toBe("<CHECKSUM>");
    expect(plan.ticks[0]!.patches[0]).toMatchObject({ id: "<ID>", columnId: "<COL>" });
    expect(plan.ticks[0]!.patches[0]!.changes).toEqual({
      ["<COL>"]: plan.ticks[0]!.patches[0]!.value,
    });
  });

  describe("ripple stream", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 808,
      roles: dataset.roles,
    });
    const patches = plan.ticks.flatMap((tick) => tick.patches);

    test("every patch moves lastPrice and recomputes exactly the derived columns", () => {
      expect(patches).toHaveLength(3_000);
      for (const patch of patches) {
        expect(patch.columnId).toBe("lastPrice");
        expect(Object.keys(patch.changes).sort()).toEqual(
          ["dayChangePct", "dayPnl", "lastPrice", "marketValue", "unrealizedPnl"],
        );
        expect(patch.changes.lastPrice).toBe(patch.value);
        expect(Number(patch.value)).toBeGreaterThan(0);
      }
    });

    test("never writes a group column", () => {
      for (const patch of patches) {
        expect("strategy" in patch.changes).toBe(false);
        expect("sector" in patch.changes).toBe(false);
      }
    });

    test("derived values are the formulas applied to the compounded row", () => {
      const working = new Map(dataset.rows.map((row) => [String(row.id), { ...row }]));
      for (const patch of patches) {
        const row = working.get(patch.id)!;
        row.lastPrice = patch.changes.lastPrice!;
        const expected = dataset.roles.stream.mode === "ripple"
          ? dataset.roles.stream.derive(row)
          : {};
        expect(patch.changes).toEqual({ lastPrice: patch.changes.lastPrice, ...expected });
        Object.assign(row, patch.changes);
      }
    });

    test("is deterministic and reads its grouping from roles", () => {
      const again = createDeterministicUpdatePlan({
        dataset, grouped: true, seed: 808, roles: dataset.roles,
      });
      expect(again.scheduleChecksum).toBe(plan.scheduleChecksum);
      expect(again.ticks).toEqual(plan.ticks);
      expect(plan.grouping).toEqual({
        initialExpansion: { kind: "expanded" },
        rowGroups: [{ columnId: "strategy" }, { columnId: "sector" }],
        aggregate: { columnId: "marketValue", operation: "sum" },
        sort: [{ columnId: "marketValue", direction: "asc" }],
      });
      expect(plan.rebuild?.sort).toEqual([{ columnId: "marketValue", direction: "desc" }]);
    });
  });
```

- [ ] **Step 3: Run to verify**

Run: `pnpm --filter @pretable/app-bench test -- update-plan`
Expected: the S5 negative control PASSES already (nothing changed yet); the ripple tests FAIL (`roles` unknown, patches write random columns).

- [ ] **Step 4: Implement**

In `update-plan.ts`:

Import: `import { legacyScenarioRoles, type ScenarioDataset, type ScenarioRoles, type ScenarioRow } from "@pretable-internal/scenario-data";`

Widen the plan's grouping types:

```ts
  readonly grouping: {
    readonly initialExpansion: { readonly kind: "expanded" };
    readonly rowGroups: readonly { readonly columnId: string }[];
    readonly aggregate: { readonly columnId: string; readonly operation: "sum" };
    readonly sort: readonly [{ readonly columnId: string; readonly direction: "asc" }];
  } | null;
  readonly rebuild: {
    readonly startAfterTick: 10;
    readonly sort: readonly [{ readonly columnId: string; readonly direction: "desc" }];
    readonly preservesSourceRowCount: true;
    readonly preservesGroupCount: true;
  } | null;
```

Add `readonly roles?: Pick<ScenarioRoles, "stream" | "streamingGrouping">;` to the input, and at the top of the function:

```ts
  const roles = input.roles ?? legacyScenarioRoles;
  const { stream, streamingGrouping } = roles;
```

Replace the `patches = Array.from(...)` body with a mode switch. The uniform-cell branch is the **existing code, unchanged**:

```ts
  const working = new Map<string, ScenarioRow>();
  const ticks = Array.from({ length: tickCount }, (_, tickIndex) => {
    const patches = Array.from(
      { length: patchesPerTick },
      (): DeterministicUpdatePatch =>
        stream.mode === "ripple"
          ? createRipplePatch(input.dataset.rows, stream, working, random)
          : createUniformCellPatch(input.dataset, input.seed, ordinal++, random),
    );
    ...
```

Extract today's body into `createUniformCellPatch` verbatim (same draw order: row first, then column, then `createPatchValue`):

```ts
function createUniformCellPatch(
  dataset: Pick<ScenarioDataset, "rows" | "columns">,
  seed: number,
  currentOrdinal: number,
  random: () => number,
): DeterministicUpdatePatch {
  const rowIndex = Math.floor(random() * dataset.rows.length);
  const columnIndex = Math.floor(random() * dataset.columns.length);
  const row = dataset.rows[rowIndex]!;
  const columnId = dataset.columns[columnIndex]!.id;
  const id = String(row.id ?? rowIndex);
  const value = createPatchValue(columnId, seed, currentOrdinal, random);
  return Object.freeze({ id, columnId, value, changes: Object.freeze({ [columnId]: value }) });
}
```

Note `ordinal` must still advance once per patch in BOTH modes so `totalPatches` stays right — increment it in the ripple branch too (`ordinal++` as a statement before the call).

```ts
/** Daily-vol-scale log-normal step: 0.2% per tick keeps prices positive and
 *  plausible across a 3 s run. */
const RIPPLE_SIGMA = 0.002;

function createRipplePatch(
  rows: readonly ScenarioRow[],
  stream: Extract<ScenarioRoles["stream"], { mode: "ripple" }>,
  working: Map<string, ScenarioRow>,
  random: () => number,
): DeterministicUpdatePatch {
  const rowIndex = Math.floor(random() * rows.length);
  const source = rows[rowIndex]!;
  const id = String(source.id ?? rowIndex);
  let row = working.get(id);
  if (row === undefined) {
    row = { ...source };
    working.set(id, row);
  }
  // Box–Muller; `1 - u1` keeps log() away from 0.
  const u1 = random();
  const u2 = random();
  const z = Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
  const price = Math.round(Number(row[stream.tickColumnId]) * Math.exp(RIPPLE_SIGMA * z) * 100) / 100;
  row[stream.tickColumnId] = price;
  const derived = stream.derive(row);
  Object.assign(row, derived);
  const changes = Object.freeze({ [stream.tickColumnId]: price, ...derived });
  return Object.freeze({ id, columnId: stream.tickColumnId, value: price, changes });
}
```

Replace the `grouping` and `rebuild` literals to read from `streamingGrouping`:

```ts
    grouping: input.grouped
      ? Object.freeze({
          initialExpansion: Object.freeze({ kind: "expanded" as const }),
          rowGroups: Object.freeze(
            streamingGrouping.groupColumnIds.map((columnId) => Object.freeze({ columnId })),
          ),
          aggregate: Object.freeze({
            columnId: streamingGrouping.aggregateColumnId,
            operation: "sum" as const,
          }),
          sort: Object.freeze([
            Object.freeze({ columnId: streamingGrouping.aggregateColumnId, direction: "asc" as const }),
          ]) as readonly [{ readonly columnId: string; readonly direction: "asc" }],
        })
      : null,
    rebuild: input.grouped
      ? Object.freeze({
          startAfterTick: 10 as const,
          sort: Object.freeze([
            Object.freeze({ columnId: streamingGrouping.aggregateColumnId, direction: "desc" as const }),
          ]) as readonly [{ readonly columnId: string; readonly direction: "desc" }],
          preservesSourceRowCount: true as const,
          preservesGroupCount: true as const,
        })
      : null,
```

`createPatchValue` keeps its `col_1`/`col_3` literals — it is the legacy generator and those literals ARE its behaviour.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- update-plan`
Expected: all PASS, including the S5 negative control. If the S5 checksum test fails, the uniform-cell extraction changed the draw order — compare against `git show HEAD:apps/bench/src/update-plan.ts`.

- [ ] **Step 6: Prove the negative control can fail**

In `createUniformCellPatch`, temporarily swap the order of the two draws so `columnIndex` is drawn before `rowIndex`. Run `pnpm --filter @pretable/app-bench test -- update-plan -t "negative control"`: it must FAIL on the checksum. Revert the swap and re-run: PASS. Report both results in the task summary — a control that cannot fail proves nothing.

- [ ] **Step 7: Commit**

```bash
git add apps/bench/src/update-plan.ts apps/bench/src/__tests__/update-plan.test.ts
git commit -m "feat(bench): ripple stream mode in the update plan; S5 schedule pinned"
```

---

### Task 6: The runtime forwards multi-cell changes and passes roles

**Files:**
- Modify: `apps/bench/src/bench-runtime.ts:1341-1401,1495-1498`
- Test: `apps/bench/src/__tests__/bench-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

Next to the existing `measureBenchUpdatesRun writes every column…` test (reuse its DOM setup and rAF stub pattern verbatim — copy the `document.body.innerHTML`, `previousRaf`/`previousCancelRaf` blocks and the `finally` restore):

```ts
  test("measureBenchUpdatesRun forwards every cell of a ripple patch", async () => {
    // (same DOM + rAF setup as the test above)
    const dataset = createScenarioDataset("S8", { scale: "smoke" });
    const seen: Record<string, unknown>[] = [];
    try {
      const result = await measureBenchUpdatesRun(
        root!,
        "pretable",
        (patches) => { seen.push(...patches); },
        dataset,
        { seed: 808 },
      );
      expect(result.status).toBe("completed");
      expect(seen.length).toBeGreaterThan(0);
      for (const patch of seen) {
        expect(Object.keys(patch).sort()).toEqual(
          ["dayChangePct", "dayPnl", "id", "lastPrice", "marketValue", "unrealizedPnl"],
        );
      }
    } finally { /* restore rAF */ }
  });
```

Add `createScenarioDataset` to the file's imports from `@pretable-internal/scenario-data` if absent.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- bench-runtime -t "ripple patch"`
Expected: FAIL — keys are `["id", "<random col>"]`.

- [ ] **Step 3: Implement**

In `measureBenchUpdatesRun`, widen the `dataset` parameter:

```ts
  dataset: {
    rows: readonly Record<string, unknown>[];
    columns: readonly { id: string }[];
    roles?: ScenarioRoles;
  },
```

(import `type ScenarioRoles` from `@pretable-internal/scenario-data`). Pass roles into the plan:

```ts
    createDeterministicUpdatePlan({
      dataset: { rows: dataset.rows, columns: planColumns } as never,
      grouped: options.grouped ?? false,
      seed: options.seed ?? 505,
      patchRatePerSec: updateRatePerSec,
      ...(dataset.roles ? { roles: dataset.roles } : {}),
    });
```

Change the projection at ~L1495:

```ts
          const patches = tick.patches.map((patch) => ({
            id: patch.id,
            ...patch.changes,
          }));
```

- [ ] **Step 4: Run the whole runtime suite**

Run: `pnpm --filter @pretable/app-bench test -- bench-runtime`
Expected: PASS, including `writes every column by default and honours excludeColumnIds` — its fixture has no `roles`, so it stays on uniform-cell and `changes` is the same single key.

- [ ] **Step 5: Mutation check**

Revert the projection to `[patch.columnId]: patch.value`; the ripple test must FAIL. Restore. Report.

- [ ] **Step 6: Commit**

```bash
git add apps/bench/src/bench-runtime.ts apps/bench/src/__tests__/bench-runtime.test.ts
git commit -m "feat(bench): forward multi-cell patch changes; pass scenario roles to the plan"
```

---

### Task 7: Interaction plan reads roles and counts two-level groups

**Files:**
- Modify: `apps/bench/src/interaction-plan.ts`
- Modify: `apps/bench/src/bench-app.tsx:731-735`
- Modify: `apps/bench/src/__tests__/bench-runtime.test.ts:1818-1829`
- Test: `apps/bench/src/__tests__/interaction-plan.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  benchUpdatesExcludedColumnIds,
  createBenchInteractionPlan,
} from "../interaction-plan";

describe("interaction plan reads column roles", () => {
  test("S5 plans are unchanged: col_3 sort, col_6/col_0 filters, col_5 grouping", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    expect(createBenchInteractionPlan(dataset, "sort")?.sort).toEqual([
      { columnId: "col_3", direction: "desc" },
    ]);
    expect(createBenchInteractionPlan(dataset, "filter-metadata")?.probeColumnId).toBe("col_6");
    expect(createBenchInteractionPlan(dataset, "filter-text")?.probeColumnId).toBe("col_0");
    expect(createBenchInteractionPlan(dataset, "group")?.rowGroups).toEqual(["col_5"]);
    expect(createBenchInteractionPlan(dataset, "group")?.resultRowCount).toBe(
      dataset.rows.length + 4,
    );
    expect(benchUpdatesExcludedColumnIds(dataset, "group-updates-stable-keys")).toEqual(["col_5"]);
    expect(benchUpdatesExcludedColumnIds(dataset, "updates")).toEqual([]);
  });

  test("S8 sort/filter plans use the finance columns", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    expect(createBenchInteractionPlan(dataset, "sort")?.sort).toEqual([
      { columnId: "marketValue", direction: "desc" },
    ]);
    const meta = createBenchInteractionPlan(dataset, "filter-metadata")!;
    expect(meta.filters).toEqual({ sector: { operator: "contains", value: "Technology" } });
    expect(meta.resultRowCount).toBe(
      dataset.rows.filter((row) => row.sector === "Technology").length,
    );
    const text = createBenchInteractionPlan(dataset, "filter-text")!;
    expect(text.resultRowCount).toBe(
      dataset.rows.filter((row) => String(row.notes).includes("earnings")).length,
    );
    expect(text.resultRowCount).toBeGreaterThan(0);
  });

  test("S8 group plan counts one group row per strategy and per strategy×sector", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    const plan = createBenchInteractionPlan(dataset, "group")!;
    expect(plan.rowGroups).toEqual(["strategy", "sector"]);
    expect(plan.resultRowCount).toBe(dataset.rows.length + 8 + 88);
  });

  test("S8 group-expand collapses the first strategy and its sectors", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    const plan = createBenchInteractionPlan(dataset, "group-expand")!;
    const strategies = [...new Set(dataset.rows.map((r) => String(r.strategy)))].sort(
      new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare,
    );
    const first = strategies[0]!;
    const collapsedRows = dataset.rows.filter((r) => r.strategy === first);
    const collapsedSectors = new Set(collapsedRows.map((r) => r.sector)).size;
    expect(collapsedSectors).toBe(11);
    expect(plan.resultRowCount).toBe(
      dataset.rows.length - collapsedRows.length + (8 + 88) - collapsedSectors,
    );
    const probe = dataset.rows.find((r) => String(r.id) === plan.focusedRowId)!;
    expect(probe.strategy).toBe(strategies[1]);
  });

  test("S8 stable-keys excludes both grouping levels", () => {
    const dataset = createScenarioDataset("S8", { scale: "smoke" });
    expect(benchUpdatesExcludedColumnIds(dataset, "group-updates-stable-keys")).toEqual([
      "strategy",
      "sector",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- interaction-plan`
Expected: FAIL — S8 plans use `col_3`; `benchUpdatesExcludedColumnIds` has the wrong arity.

- [ ] **Step 3: Implement**

In `interaction-plan.ts` delete `SORT_COLUMN_ID`, `METADATA_FILTER`, `TEXT_FILTER`, `GROUP_COLUMN_ID` and their doc comment (move the explanation of *why* S5 groups on `col_5` to `legacyScenarioRoles` in scenario-data if it is not already there — it is the same paragraph). At the top of `createBenchInteractionPlan`:

```ts
  const { roles } = dataset;
  const SORT_COLUMN_ID = roles.sortColumnId;
  const METADATA_FILTER = roles.metadataFilter;
  const TEXT_FILTER = roles.textFilter;
  const GROUP_COLUMN_IDS = roles.groupColumnIds;
```

(Keeping the local names means the `sort`/`filter-*` branches need no edit.) Then in the grouping branches replace `GROUP_COLUMN_ID` uses:

`group`:
```ts
      probeColumnId: GROUP_COLUMN_IDS[0]!,
      resultRowCount: rows.length + countGroupRows(rows, GROUP_COLUMN_IDS),
      rows,
      rowGroups: [...GROUP_COLUMN_IDS],
```

`group-expand`:
```ts
    const rows = dataset.rows;
    const outerId = GROUP_COLUMN_IDS[0]!;
    const keys = sortedGroupKeys(rows, outerId);
    const collapsedKey = keys[0] ?? null;
    const survivingKey = keys[1] ?? keys[0] ?? null;
    const inCollapsed = (row: ScenarioRow) =>
      collapsedKey !== null && String(row[outerId] ?? "") === collapsedKey;
    const probeRow =
      survivingKey === null
        ? rows[0]
        : (rows.find((row) => String(row[outerId] ?? "") === survivingKey) ?? rows[0]);
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;
    const collapsedRows = rows.filter(inCollapsed);
    // Collapsing the outermost group hides its data rows AND every group row
    // nested under it; the engine's visibleRowCount drops both.
    const hiddenNestedGroupRows =
      countGroupRows(collapsedRows, GROUP_COLUMN_IDS) - (collapsedRows.length > 0 ? 1 : 0);

    return {
      focusedRowId: probeRowId,
      filters: {},
      mode: "group-expand",
      probeColumnId: outerId,
      resultRowCount:
        rows.length - collapsedRows.length + countGroupRows(rows, GROUP_COLUMN_IDS) - hiddenNestedGroupRows,
      rows,
      rowGroups: [...GROUP_COLUMN_IDS],
      selectedRowId: probeRowId,
      sort: [],
    };
```

`group-updates` / `group-updates-stable-keys`:
```ts
      probeColumnId: GROUP_COLUMN_IDS[0]!,
      resultRowCount: rows.length + countGroupRows(rows, GROUP_COLUMN_IDS),
      rows,
      rowGroups: [...GROUP_COLUMN_IDS],
```

Replace `countGroupKeys` with a level-aware counter; keep `sortedGroupKeys` (single column, exported) as is:

```ts
/** One group row per distinct key prefix at every level, outermost first —
 *  what the engine's `visibleRowCount` adds on top of the data rows when all
 *  groups are expanded. */
function countGroupRows(rows: readonly ScenarioRow[], columnIds: readonly string[]) {
  let total = 0;
  for (let depth = 1; depth <= columnIds.length; depth += 1) {
    const prefixes = new Set<string>();
    for (const row of rows) {
      prefixes.add(columnIds.slice(0, depth).map((id) => String(row[id] ?? "")).join(" "));
    }
    total += prefixes.size;
  }
  return total;
}
```

Change `benchUpdatesExcludedColumnIds`:

```ts
export function benchUpdatesExcludedColumnIds(
  dataset: Pick<ScenarioDataset, "roles">,
  scriptName: BenchQueryState["scriptName"],
): readonly string[] {
  return scriptName === "group-updates-stable-keys"
    ? [...dataset.roles.groupColumnIds]
    : [];
}
```

Update its doc comment: "group-updates groups on `roles.groupColumnIds` (col_5 on S5)". Update the two call sites in `bench-app.tsx` (~L731 and ~L734) to `benchUpdatesExcludedColumnIds(dataset, scriptName)`, and the three calls in `bench-runtime.test.ts` (~L1818–1829) to pass `createScenarioDataset("S5", { scale: "smoke" })` as the first argument (add the import if missing).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- interaction-plan bench-runtime bench-app && pnpm --filter @pretable/app-bench typecheck`
Expected: PASS. The S5 assertions are the negative control: they pin the legacy picks through the roles indirection.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/src/interaction-plan.ts apps/bench/src/bench-app.tsx apps/bench/src/__tests__
git commit -m "feat(bench): interaction plans read scenario roles; two-level group counting"
```

---

### Task 8: Diagnostics controller types by roles and tracks tuple group keys

**Files:**
- Modify: `apps/bench/src/row-model-diagnostics.ts:99-118,198-243,368-378`
- Test: `apps/bench/src/__tests__/row-model-diagnostics.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  test("types columns from roles: legacy datasets keep col_3 as the only number", () => {
    const s5 = createScenarioDataset("S5", { scale: "smoke" });
    const columns = createBenchModelColumns(s5, false);
    expect(columns.filter((c) => c.type === "number").map((c) => c.id)).toEqual(["col_3"]);
    const s8 = createScenarioDataset("S8", { scale: "smoke" });
    const s8Columns = createBenchModelColumns(s8, true);
    expect(s8Columns.filter((c) => c.type === "number")).toHaveLength(30);
    expect(s8Columns.find((c) => c.id === "marketValue")).toMatchObject({ aggregate: "sum" });
    expect(s8Columns.find((c) => c.id === "dayPnl")?.aggregate).toBeUndefined();
  });

  test("tracks group counts under a two-level tuple key", () => {
    const dataset = createScenarioDataset("S8", { scale: "smoke" });
    const plan = createDeterministicUpdatePlan({
      dataset, grouped: true, seed: 808, roles: dataset.roles,
    });
    const controller = createRowModelDiagnosticsController({ dataset, plan });
    const before = controller.read();
    controller.model.applyTransaction({
      update: [{ id: String(dataset.rows[0]!.id), changes: { sector: "Nowhere" } }],
    });
    // One row moved to a brand-new (strategy, sector) leaf: 88 → 89 keys
    // unless its old leaf had only that row, in which case 88 → 88.
    const oldLeafSize = dataset.rows.filter(
      (r) => r.strategy === dataset.rows[0]!.strategy && r.sector === dataset.rows[0]!.sector,
    ).length;
    controller.startQueryCandidate();
    const summary = controller.createRunSummary();
    expect(summary.rebuild?.groupCountAfter).toBe(88 + (oldLeafSize === 1 ? 0 : 1));
    expect(before.rebuild).toBeNull();
    controller.dispose();
  });
```

Import `createBenchModelColumns` from `../row-model-diagnostics`. If `createRunSummary` needs `startQueryCandidate`'s transition to finish before `groupCountAfter` is populated, `await transition!.finished` as the existing "canonicalizes grouped visible order" test does — read `createRunSummary` in the file to see which field carries the live count and adapt the assertion to the field that actually holds it.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- row-model-diagnostics`
Expected: FAIL — S8 columns are all `text` except none; group count keyed on `row.col_1` is `undefined`.

- [ ] **Step 3: Implement**

`createBenchModelColumns`:

```ts
export function createBenchModelColumns(
  dataset: Pick<ScenarioDataset, "columns" | "roles">,
  grouped: boolean,
): readonly BenchColumn[] {
  const { sortColumnId, streamingGrouping } = dataset.roles;
  return Object.freeze(
    dataset.columns.map((column) => {
      const accessor = (row: ScenarioRow) => row[column.id] ?? "";
      return Object.freeze({
        ...column,
        // Explicit type wins; otherwise the legacy rule — only the sort
        // column is numeric — which is what this did before roles existed.
        type: column.type ?? (column.id === sortColumnId ? ("number" as const) : ("text" as const)),
        accessorKey: column.id,
        accessor,
        value: accessor,
        ...(grouped && column.id === streamingGrouping.aggregateColumnId
          ? { aggregate: "sum" as const }
          : {}),
      });
    }),
  );
}
```

Group tracking (~L198–243): replace the single-column bookkeeping with a tuple key.

```ts
  const groupColumnIds = input.dataset.roles.streamingGrouping.groupColumnIds;
  const groupKeyOf = (values: readonly unknown[]) => values.map(String).join(" ");
  const rowGroupValues = new Map<string, unknown[]>();
  const groupCounts = new Map<string, number>();
  if (input.plan.grouping !== null) {
    for (const row of input.dataset.rows) {
      const id = String(row.id ?? "");
      const values = groupColumnIds.map((columnId) => row[columnId]);
      rowGroupValues.set(id, values);
      const key = groupKeyOf(values);
      groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1);
    }
  }
```

and inside `timedApply`:

```ts
    if (input.plan.grouping !== null) {
      for (const update of transaction.update ?? []) {
        const previous = rowGroupValues.get(update.id);
        if (previous === undefined) continue;
        let moved = false;
        const next = previous.slice();
        groupColumnIds.forEach((columnId, level) => {
          if (columnId in update.changes && !Object.is(previous[level], update.changes[columnId])) {
            next[level] = update.changes[columnId];
            moved = true;
          }
        });
        if (!moved) continue;
        const previousKey = groupKeyOf(previous);
        const previousCount = groupCounts.get(previousKey) ?? 0;
        if (previousCount <= 1) groupCounts.delete(previousKey);
        else groupCounts.set(previousKey, previousCount - 1);
        rowGroupValues.set(update.id, next);
        const nextKey = groupKeyOf(next);
        groupCounts.set(nextKey, (groupCounts.get(nextKey) ?? 0) + 1);
      }
    }
```

`churnRevisions` (~L376): replace `changes: { col_0: ... }` with `changes: { [columns[0]!.id]: \`retention-${retentionRevision}\` }` — `columns[0]` is `col_0` on every legacy scenario, so the gate's behaviour is unchanged.

Anything else in the file that reads `groupCounts.size` for `groupCountBefore/After` keeps working — the map is still keyed per leaf.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- row-model-diagnostics pretable-adapter && pnpm --filter @pretable/app-bench typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/src/row-model-diagnostics.ts apps/bench/src/__tests__/row-model-diagnostics.test.ts
git commit -m "feat(bench): diagnostics controller types and groups by scenario roles"
```

---

### Task 9: pretable adapter's `updates-grouped` path reads roles

**Files:**
- Modify: `apps/bench/src/pretable-adapter.tsx:236-296`
- Test: `apps/bench/src/__tests__/pretable-adapter.test.tsx`

- [ ] **Step 1: Write the failing test**

Following the file's existing render pattern (see its first test for `render(<PretableAdapter dataset={dataset} runKey={1} />)` and how `onGridReady` is captured):

```ts
  test("updates-grouped on S8 groups by strategy then sector and sums marketValue", async () => {
    const dataset = createScenarioDataset("S8", { scale: "smoke" });
    let grid: Parameters<NonNullable<PretableSurfaceProps<ScenarioRow>["onGridReady"]>>[0] | null = null;
    render(
      <PretableAdapter
        dataset={dataset}
        runKey={1}
        scriptName="updates-grouped"
        onGridReady={(g) => { grid = g as never; }}
      />,
    );
    await waitFor(() => expect(grid).not.toBeNull());
    await waitFor(() =>
      expect(grid!.rowModel.getState().snapshot.visibleRowCount).toBe(
        dataset.rows.length + 8 + 88,
      ),
    );
  });
```

Adapt the `grid` typing to whatever the file already uses for `onGridReady` in other tests — copy it rather than inventing one.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- pretable-adapter -t "updates-grouped on S8"`
Expected: FAIL — grouped on `col_1`, which S8 lacks, so `visibleRowCount` is `rows + 1` (one empty-key group) or the query is rejected.

- [ ] **Step 3: Implement**

In `pretable-adapter.tsx`:

```ts
  const { streamingGrouping } = dataset.roles;
```

then replace the three literal sites:

```ts
    return groupedUpdates
      ? withRenderers.map((column) =>
          column.id === streamingGrouping.aggregateColumnId
            ? { ...column, aggregate: "sum" }
            : column,
        )
```

```ts
      sort:
        interactionPlan !== null && interactionPlan !== undefined
          ? interactionPlan.sort
          : groupedUpdates
            ? [{ columnId: streamingGrouping.aggregateColumnId, direction: "asc" as const }]
            : [],
      rowGroups:
        interactionPlan !== null && interactionPlan !== undefined
          ? interactionPlan.rowGroups.map((columnId) => ({ columnId }))
          : groupedUpdates
            ? streamingGrouping.groupColumnIds.map((columnId) => ({ columnId }))
            : [],
```

```ts
  const initialSurfaceQuery = useMemo(
    () => ({
      filters: [],
      sort: groupedUpdates
        ? [{ columnId: streamingGrouping.aggregateColumnId, direction: "asc" as const }]
        : [],
      rowGroups: groupedUpdates
        ? streamingGrouping.groupColumnIds.map((columnId) => ({ columnId }))
        : [],
    }),
    [groupedUpdates, streamingGrouping],
  );
```

Add `streamingGrouping` to the `surfaceQuery` dependency array, and pass roles to the plan:

```ts
      createDeterministicUpdatePlan({
        dataset: modelDataset,
        grouped: groupedUpdates || groupingScript,
        seed,
        roles: modelDataset.roles,
      }),
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- pretable-adapter && pnpm --filter @pretable/app-bench typecheck && pnpm --filter @pretable/app-bench lint`
Expected: PASS.

- [ ] **Step 5: Grep for leftovers**

Run: `grep -n '"col_[0-9]"' apps/bench/src/*.ts apps/bench/src/*.tsx`
Expected: only `createPatchValue` in `update-plan.ts` (the legacy generator's own values) and comments. Anything else is a missed site — fix it.

- [ ] **Step 6: Commit**

```bash
git add apps/bench/src/pretable-adapter.tsx apps/bench/src/__tests__/pretable-adapter.test.tsx
git commit -m "feat(bench): pretable adapter groups updates-grouped by scenario roles"
```

---

### Task 10: bench-runner admits S8

**Files:**
- Modify: `packages/bench-runner/src/index.ts:314,417-452,529-550`
- Test: `packages/bench-runner/src/__tests__/bench-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe` that holds the S5 gate tests (`baseRequest` is defined at ~L18):

```ts
  test("admits S8 to the streaming, grouping and sort/filter scripts only", () => {
    const ok = (scriptName: BenchScriptName, adapterId: BenchAdapterId = "pretable") =>
      validateSupportedP0aRequest({ ...baseRequest, adapterId, scenarioId: "S8", scriptName });

    for (const scriptName of [
      "initial", "scroll", "sort", "filter-metadata", "filter-text",
      "updates", "updates-grouped", "group", "group-expand",
      "group-updates", "group-updates-stable-keys", "replace", "append",
    ] as const) {
      expect(ok(scriptName)).toEqual({ ok: true });
    }
    for (const adapterId of ["ag-grid", "tanstack", "mui"] as const) {
      expect(ok("updates", adapterId)).toEqual({ ok: true });
      expect(ok("sort", adapterId)).toEqual({ ok: true });
    }
    for (const scriptName of [
      "autosize", "select-range-extend", "keyboard-nav-row", "select-all",
      "scroll-with-format", "scroll-with-render", "scroll-with-heavy-render",
    ] as const) {
      expect(ok(scriptName)).toEqual({ ok: false, reason: expect.stringContaining("scenario") });
    }
  });
```

Import `BenchScriptName`/`BenchAdapterId` types from `../index` if not already imported.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @pretable-internal/bench-runner test`
Expected: FAIL — `Unsupported scenario for P0a: S8`.

- [ ] **Step 3: Implement**

In `validateSupportedP0aRequest`:

- L314: `if (!["S1", "S2", "S3", "S4", "S5", "S7", "S8"].includes(request.scenarioId))`
- `updates` (L421): `if (request.scenarioId !== "S5" && request.scenarioId !== "S8")`; comment: "S5 is the synthetic streaming scenario, S8 the PMS one."
- `updates-grouped` (L437): same two-scenario check.
- interaction scripts (L446): `if (!["S2", "S7", "S8"].includes(request.scenarioId))` and the reason string `(S2/S7/S8 only)`.
- grouping interaction (L532): `["S2", "S7", "S8"]`, reason `(S2/S7/S8 only)`.
- grouping streaming (L544): `request.scenarioId !== "S5" && request.scenarioId !== "S8"`, reason `(S5/S8 only)`.

Leave `autosize`, selection, cell-renderer gates untouched. If any existing test asserts the exact old reason string (`grep -n "S2/S7 only" packages/bench-runner/src/__tests__`), update it.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @pretable-internal/bench-runner test && pnpm --filter @pretable-internal/bench-runner typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-runner
git commit -m "feat(bench-runner): admit S8 to streaming, grouping and sort/filter scripts"
```

---

### Task 11: End-to-end verification in the real bench

**Files:** none modified unless something fails.

- [ ] **Step 1: Full unit + typecheck + lint across the three packages**

```bash
pnpm --filter @pretable-internal/scenario-data --filter @pretable/app-bench --filter @pretable-internal/bench-runner test
pnpm --filter @pretable-internal/scenario-data --filter @pretable/app-bench --filter @pretable-internal/bench-runner typecheck
pnpm --filter @pretable-internal/scenario-data --filter @pretable/app-bench --filter @pretable-internal/bench-runner lint
```

Expected: all pass. Random 1–2 vitest timeouts in a full run are a known local flake (memory `project_test_suite_load_flakes`) — re-run the file before believing it.

- [ ] **Step 2: Build the workspace so the bench reads fresh `dist/`**

```bash
pnpm build
```

The bench imports built packages; a stale `dist/` makes every e2e result below meaningless (memory `reference_ci_false_signals`).

- [ ] **Step 3: Run S8 through the bench e2e at dev scale**

Check that port 4173 is free first (`lsof -iTCP:4173 -sTCP:LISTEN`); if another session holds it the run measures their build (memory `reference_bench_port_collision`).

```bash
PRETABLE_BENCH_SCENARIO=S8 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=group pnpm bench:e2e
PRETABLE_BENCH_SCENARIO=S8 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=group-expand pnpm bench:e2e
PRETABLE_BENCH_SCENARIO=S8 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=updates pnpm bench:e2e
PRETABLE_BENCH_SCENARIO=S8 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=group-updates pnpm bench:e2e
PRETABLE_BENCH_SCENARIO=S8 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=sort pnpm bench:e2e
PRETABLE_BENCH_SCENARIO=S8 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=filter-text pnpm bench:e2e
```

Read `apps/bench/tests/bench.spec.ts` L28–L120 for the exact env-var names the spec reads (`PRETABLE_BENCH_SCENARIO` is confirmed; check the scale/script/adapter names before running). Each run writes `status/*.summary.json`; every one must have `"status": "completed"`. For `group` and `group-expand` the summary's notes include `group rows after grouping: N` — for dev scale that must be **96** (8 + 88). If the interaction run reports a result-row-count mismatch, the arithmetic in Task 7 disagrees with the engine — fix the plan builder, not the engine.

- [ ] **Step 4: The existing row-model gate is untouched**

```bash
node scripts/bench-row-model-gate.mjs > /tmp/gate-after.txt 2>&1; echo "exit=$?"
```

Expected: exit 0 with the same verdicts as on `main` — run the same command from a `main` checkout in a separate worktree (never `git checkout` in `~/repos/pretable`) for the before file, and diff the verdict lines. Redirect to a file, not `| head` — SIGPIPE kills the gate before its assertions (memory `feedback_bench_gates_need_full_output`).

- [ ] **Step 5: Confirm S5 summaries are unchanged**

```bash
PRETABLE_BENCH_SCENARIO=S5 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=updates pnpm bench:e2e
```

Its summary's `notes` should carry the same schedule checksum as a pre-change run (the checksum from Task 5 Step 1 if the summary records it; otherwise compare `total_updates` and the written-column set).

- [ ] **Step 6: Commit any fixes; nothing to commit if all green**

---

### Task 12: Baseline evidence at target scale

**Files:**
- Create: `status/milestones/<run-date>-s8-pms-baseline.json`

- [ ] **Step 1: Check the machine before measuring**

```bash
uptime; sysctl vm.swapusage; vm_stat | head -5
```

Load ≈ 9.5 on ten cores is FULL occupancy; swap above ~2 GB or free pages below ~100k (×16 KB) means the numbers will describe the machine, not the grid. If it is not quiet, stop here and say so — a baseline taken on a thrashing machine is worse than none.

- [ ] **Step 2: Run the runset with the S5 control interleaved in ONE invocation**

```bash
node scripts/bench-matrix.mjs \
  --adapters=pretable \
  --scenarios=S8,S5 \
  --scale=target \
  --repeats=3 \
  --scripts=initial,scroll,sort,filter-metadata,filter-text,updates,group,group-expand,group-updates \
  > /tmp/s8-runset.txt 2>&1; echo "exit=$?"
```

`bench-matrix` rejects (scenario, script) pairs the runner does not support (S5 × sort etc. report `unsupported`); that is expected and is not a failure of this task. Confirm the port is free first, as in Task 11.

- [ ] **Step 3: Write the milestone**

Copy the runset's `status/runsets/<id>.hypotheses.json` to `status/milestones/<run-date>-s8-pms-baseline.json` and add a top-level `"notes"` array containing: the machine state from Step 1 verbatim, the `@pretable/react` version, the sentence "Baseline only — no ceiling is asserted against these numbers", and, for `group-updates` vs `group-updates-stable-keys`, "on S8 these are twins by construction (the ripple never writes a group column)". Check `scripts/__tests__/bench-comparator-provenance.test.mjs` for the milestone-shape assertions it enforces and satisfy them.

- [ ] **Step 4: Run the provenance and budget tests**

```bash
node --test scripts/__tests__/
node scripts/check-bench-budgets.mjs
```

Expected: both exit 0. The budget gate still judges `pretable/default/S1/dev` only; if it now reports an S8 run, `CLIENT_BUDGET_RUN` filtering broke — that is a regression, not a feature.

- [ ] **Step 5: Commit**

```bash
git add status/milestones/
git commit -m "docs(bench): S8 pms-positions baseline at target scale"
```

- [ ] **Step 6: Open the PR**

Branch off `origin/main` (re-fetch first — another session may have moved it), squash-merge with auto-merge, and **verify `autoMergeRequest` is non-null** with `gh pr view --json autoMergeRequest`. Check failing checks with `gh pr checks | awk -F'\t' '$2=="fail"'` — names contain spaces. The PR body states: baselines only, no gate added, S1–S7 roles pinned to legacy literals, S5 checksum pinned, and links the spec.
