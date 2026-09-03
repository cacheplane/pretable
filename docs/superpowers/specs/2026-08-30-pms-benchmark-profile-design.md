# PMS benchmark profile (S8) — design

Date: 2026-08-30. Closes the last `Now` line in `ROADMAP.md`: "Add deterministic
PMS and financial-planning benchmark profiles without weakening existing 60 Hz,
zero-gap, and interaction-continuity gates."

## Decisions already taken

These were settled in the brainstorm and are not reopened here.

1. **Baselines, not gates.** The profile produces committed evidence of where
   pretable stands on a realistic PMS workload. It adds **no** entry to
   `CLIENT_BUDGETS` in `scripts/check-bench-budgets.mjs` and **no** row to
   `createRowModelGateMatrixEntries` in `scripts/bench-matrix.mjs`. Ceilings
   come later, once numbers exist. The roadmap's "without weakening" clause is a
   constraint on this work, not an instruction to gate.
2. **A new scenario, `S8`.** The bench's `profile` query axis stays `"default"`.
   Scales, seeds, adapters and scripts all already key off `scenarioId`.
3. **`S9` (financial planning) is deferred.** The planning track's
   interactions — range editing, fill, formulas, provenance, scenario
   comparison — mostly do not exist in the grid yet, so a profile for them is
   not measurable. It gets designed when they do.
4. **20k positions × 40 columns at `target`, 100k at `local-max`.** Same row
   ladder as S5 so grouped-streaming numbers read directly against it.
5. **S8 is measured both flat and grouped.** Flat is the control that isolates
   grouping cost; grouped is the realistic cockpit and the deterministic pin on
   the known 60 Hz miss at 20k rows (see
   `status/milestones/2026-08-10-grouping-streaming-disambiguation.json`).
6. **The stream is a price tick with a derived ripple.** One patch moves a
   row's `lastPrice` and recomputes its derived columns in the same patch.
   Rate stays at the harness default (1,000 patches/sec in 50-patch ticks).
7. **Grouping is strategy → sector**, summing `marketValue`, `dayPnl` and
   `unrealizedPnl`.
8. **The bench learns column roles from the scenario**, not from column
   position. See §2 — this is the load-bearing structural change.

## Why the structure has to change

The bench derives column semantics from `packages/scenario-data`'s generator
pattern (`columnIndex % 4`), hardcoded as `col_N` literals:

| literal | meaning                                                                                | where                                                                                       |
| ------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `col_3` | sort key; the only `number`-typed model column; aggregate                              | `interaction-plan.ts`, `update-plan.ts`, `pretable-adapter.tsx`, `row-model-diagnostics.ts` |
| `col_5` | group column for `group`, `group-expand`, `group-updates`, `group-updates-stable-keys` | `interaction-plan.ts` (`GROUP_COLUMN_ID`)                                                   |
| `col_1` | group column for `updates-grouped` and the diagnostics controller                      | `update-plan.ts`, `pretable-adapter.tsx`, `row-model-diagnostics.ts`                        |
| `col_6` | metadata filter probe (`"running"`)                                                    | `interaction-plan.ts`                                                                       |
| `col_0` | text filter probe (`"Bonjour"`)                                                        | `interaction-plan.ts`                                                                       |

A finance-shaped scenario with named columns satisfies none of these. Two
alternatives were rejected: `scenarioId === "S8"` branches at each site (a
fifth hardcode, repeated per future scenario), and laying S8's columns so
finance fields land in the positional slots (two-level grouping cannot fit one
`GROUP_COLUMN_ID`, and `col_3 = market value` is unreadable in every artifact).

Two further facts shape the design:

- `measureBenchUpdatesRun` (`apps/bench/src/bench-runtime.ts` ~L1495) builds
  each patch as `{ id, [columnId]: value }` and ignores the `changes` field
  `DeterministicUpdatePatch` already carries. The ripple needs multi-cell
  patches honoured.
- `packages/bench-runner/src/index.ts` gates every script to specific scenario
  ids (`updates` and the grouped-streaming scripts are S5-only; grouping
  interaction and sort/filter are S2/S7-only). S6 has been absent from that
  allowlist since the original streaming commit — a scenario can exist in
  `scenario-data` without the bench knowing it, and nothing breaks.

## 1. The S8 scenario

```ts
{
  id: "S8",
  name: "pms-positions",
  rows: 20_000,
  cols: 40,
  row_height_mode: "variable",
  wrapped_columns: 1,
  pinned_left: 2,
  update_stream: { mode: "batched", batch_every_ms: 50,
                   visible_update_rate_per_sec: 200,
                   offscreen_update_rate_per_sec: 800 },
  purpose: "Portfolio-management cockpit: grouped positions under a price stream.",
}
```

Scale ladder: smoke 120, dev 750, hypothesis 3,000, target 20,000, local-max
100,000. Seed 808.

### Columns

Forty named columns, in this order. The first two are pinned left; `notes` is
the single wrapped column.

- **Identity (string):** `ticker`, `name`, `strategy`, `sector`, `book`,
  `assetClass`, `region`, `currency`, `trader`
- **Wrapped text:** `notes` — 1–4 sentences drawn from a deterministic English
  pool of analyst-note fragments
- **Numeric (30):** `quantity`, `lastPrice`, `prevClose`, `avgCost`,
  `marketValue`, `unrealizedPnl`, `dayPnl`, `dayChangePct`, `weightPct`,
  `costBasis`, `realizedPnl`, `mtdPnl`, `ytdPnl`, `beta`, `delta`, `gamma`,
  `vega`, `theta`, `dv01`, `var95`, `grossExposure`, `netExposure`,
  `leverage`, `impliedVol`, `bidPrice`, `askPrice`, `volume`, `adv30d`,
  `daysToLiquidate`, `lotCount`

Derived numerics are computed from primitives at generation time so the dataset
is internally consistent before the first tick:

- `marketValue = quantity × lastPrice`
- `costBasis = quantity × avgCost`
- `unrealizedPnl = marketValue − costBasis`
- `dayPnl = quantity × (lastPrice − prevClose)`
- `dayChangePct = (lastPrice − prevClose) / prevClose × 100`

Everything else is seeded noise in a plausible range. Numeric cells are plain
numbers; currency and percent _formatting_ is not a scenario concern (bench
adapters render raw values and the bench does not measure formatting).

### Group cardinality

8 strategies × 11 sectors. Assignment is `strategy = strategies[rowIndex % 8]`,
`sector = sectors[floor(rowIndex / 8) % 11]`, so every strategy holds every
sector and there are **exactly 88 leaf groups at every scale** from smoke up
(smoke's 120 rows give 1–2 positions per leaf; target gives ~227). The group
count is pinned while rows scale, which is the same property `col_5`'s
four-value pool gave S2/S5/S7 and is what lets a measurement separate per-row
from per-group cost.

`ticker` is unique per row (`${prefix}${rowIndex}` from a pool of real-looking
prefixes) so `getRowId` and the ticker column agree.

## 2. Scenario-declared roles

### Types

```ts
export interface ScenarioColumn {
  id: string;
  header: string;
  wrap: boolean;
  widthPx?: number;
  pinned?: "left";
  /** Value type. Absent = legacy typing (see below). */
  type?: "text" | "number";
}

export interface ScenarioRoles {
  /** Numeric column the `sort` script orders by. */
  sortColumnId: string;
  textFilter: { columnId: string; value: string };
  metadataFilter: { columnId: string; value: string };
  /** Grouping levels, outermost first, for `group`, `group-expand`,
   *  `group-updates`, `group-updates-stable-keys`. */
  groupColumnIds: readonly string[];
  /** Grouping for `updates-grouped` and the row-model diagnostics controller.
   *  Separate from `groupColumnIds` because the existing bench groups those
   *  two families on DIFFERENT columns (col_5 vs col_1) and reproducing that
   *  is what keeps S5's baselines still. */
  streamingGrouping: {
    groupColumnIds: readonly string[];
    aggregateColumnId: string;
  };
  stream:
    | { mode: "uniform-cell" }
    | {
        mode: "ripple";
        tickColumnId: string;
        derivedColumnIds: readonly string[];
        /** Recompute `derivedColumnIds` from a row whose tick column has
         *  already been updated. Returns only the derived cells. */
        derive: (row: ScenarioRow) => Readonly<Record<string, number>>;
      };
}

export interface ScenarioDataset {
  // …existing fields…
  roles: ScenarioRoles;
}
```

`roles` is a property of the dataset (built by `createScenarioDataset`) rather
than of `ScenarioDefinition`, because the ripple's derivation is a function of
the row and lives in `scenario-data` beside the generator; the definition
stays a plain literal.

### S1–S7 roles — today's picks, verbatim

```ts
{
  sortColumnId: "col_3",
  textFilter: { columnId: "col_0", value: "Bonjour" },
  metadataFilter: { columnId: "col_6", value: "running" },
  groupColumnIds: ["col_5"],
  streamingGrouping: { groupColumnIds: ["col_1"], aggregateColumnId: "col_3" },
  stream: { mode: "uniform-cell" },
}
```

The `col_5` / `col_1` split is the truth of the current bench, not a design
choice. A test pins these literals for every legacy scenario so no future edit
can move an existing baseline by changing a role.

### S8 roles

```ts
{
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
}
```

The `notes` pool must contain "earnings" in a known fraction of fragments so the
text filter's `resultRowCount` is predictable, and `"Technology"` must be one
of the 11 sectors.

### Column typing

`createBenchModelColumns` in `row-model-diagnostics.ts` currently types
`col_3` as `number` and everything else `text`. With roles it becomes:

- if `column.type` is set, use it;
- otherwise `column.id === roles.sortColumnId ? "number" : "text"`.

S1–S7 columns omit `type`, so they resolve to exactly today's typing. S8 sets
`type` on every column. The comparator adapters keep their existing
sample-row sniffing; no change there.

`applyGroupAggregates` in `pretable-adapter.tsx` (avg on every numeric column
for grouping scripts, by sniffing the sample row) is unchanged. The
`updates-grouped` path replaces its `col_3 → sum` literal with
`roles.streamingGrouping.aggregateColumnId → sum`.

The brainstorm's "sum of marketValue, dayPnl, unrealizedPnl" is realised
through the existing sniff (all three are numeric, so all three aggregate on
the grouping scripts); the single `aggregateColumnId` is the one the
`updates-grouped` family and the diagnostics controller sum, mirroring today's
single `col_3`.

## 3. The ripple stream

`createDeterministicUpdatePlan` in `apps/bench/src/update-plan.ts` gains a
`stream` input (from `dataset.roles.stream`).

**`uniform-cell`** is the existing generator, byte for byte: same random draws
in the same order, same `createPatchValue`. The S5 `scheduleChecksum` at
seed 505 / 1,000 patches/sec is pinned as a literal in a test — a negative
control that fails if the legacy path drifts by a single draw.

**`ripple`** per patch:

1. Draw a row uniformly (one `random()` call).
2. Draw a log-normal step: `lastPrice' = lastPrice × exp(σ · z)` with
   `σ = 0.002` and `z` from Box–Muller over two `random()` calls. Prices stay
   positive by construction.
3. Recompute `derivedColumnIds` by calling `roles.stream.derive(row)` on the
   working row with the new price applied. The formulas live in
   `scenario-data` beside the generator; the plan calls the function and never
   knows them.
4. Emit one patch whose `changes` holds `tickColumnId` plus every derived
   column. `columnId`/`value` on the patch are set to the tick column for
   backward compatibility with any reader that still uses them.

The generator keeps a working `Map<rowId, row>` of mutated rows so successive
ticks on the same row compound from the previous price, not the original.
`applyUpdatePlanToRows` already applies `changes` and needs no change.

Group columns are never written in ripple mode. Consequences, stated rather
than hidden:

- `group-updates` on S8 is already stable-keys. `group-updates-stable-keys` on
  S8 is an exact twin, and `benchUpdatesExcludedColumnIds` still returns the
  group columns for it — harmless, since the generator never picks them. The
  milestone notes will say the two are expected to be identical on S8 and any
  difference is noise.
- The `plan.rebuild` step (a mid-run sort flip after tick 10) keeps working:
  its sort targets `roles.streamingGrouping.aggregateColumnId`.

`measureBenchUpdatesRun` changes its patch projection from
`{ id, [patch.columnId]: patch.value }` to `{ id, ...patch.changes }`. For a
uniform-cell patch `changes` is `{ [columnId]: value }`, so S5 is unaffected.

## 4. Bench plumbing

Every `col_N` literal in the four files becomes a read from `dataset.roles`:

- `interaction-plan.ts`: `SORT_COLUMN_ID`, `METADATA_FILTER`, `TEXT_FILTER`,
  `GROUP_COLUMN_ID` deleted; `createBenchInteractionPlan` and
  `benchUpdatesExcludedColumnIds` take the dataset and read roles.
  `rowGroups` becomes `roles.groupColumnIds` (already an array in the plan
  type). `countGroupKeys` / `sortedGroupKeys` generalise to a tuple key over
  all group levels; `resultRowCount` for `group` counts one group row per
  distinct key **at each level** (strategy rows + strategy×sector rows), which
  is what the engine's `rowModelRowCount` reports for a two-level tree.
  `group-expand` collapses the first _outermost_ group; the probe row comes
  from the second outermost group as today.
- `update-plan.ts`: the `grouping` block's literal `col_1`/`col_3` types widen
  to `readonly { columnId: string }[]` / `string`; values come from
  `roles.streamingGrouping`.
- `pretable-adapter.tsx`: the `updates-grouped` `col_1` / `col_3` literals in
  `surfaceColumns`, `surfaceQuery` and `initialSurfaceQuery` read roles.
- `row-model-diagnostics.ts`: `createBenchModelColumns` types per §2; the
  group-count tracker keys on the tuple of `streamingGrouping.groupColumnIds`
  values (joined into one string key; the implementation uses `JSON.stringify` of the tuple, since values like "Consumer Discretionary" contain spaces) instead of `row.col_1`, and checks
  `changes` for any of those ids instead of `"col_1" in changes`.
- `bench-types.ts` `scenarioId` union and `query-state.ts` parser accept
  `"S8"`.
- `packages/bench-runner/src/index.ts`: `"S8"` joins the P0a scenario list and
  the allowlists for `updates`, `updates-grouped`, the grouping-streaming
  scripts, the grouping-interaction scripts, and `sort`/`filter-metadata`/
  `filter-text`. **Not** added to `autosize` (S2-only), the selection scripts
  (Slab 1, S2-only) or the cell-renderer scripts (S2-only) — those scopes are
  unrelated to this work. `replace`/`append` are gated by adapter only and
  need no change.
- `scripts/bench-matrix.mjs`: `DEFAULT_SCENARIOS` unchanged (S8 is selected
  with `--scenarios=S8`); `createRowModelGateMatrixEntries` unchanged (decision
  1).

No docs page enumerates scenarios (verified by grep across `apps/website` and
`docs/`), so there is no docs table to register with the api-surface guards.

## 5. Evidence

One pretable-only runset at `target`, three repeats, via `bench-matrix`:

```
--adapters=pretable --scenarios=S8 --scale=target --repeats=3
--scripts=initial,scroll,sort,filter-metadata,filter-text,updates,group,group-expand,group-updates
```

with S5 `updates` and `group-updates` interleaved in the same invocation as the
control, per the measuring rules in `docs/handoff/2026-08-27-session-handoff.md`
("every comparative claim needs a same-session control, interleaved"). The
runset is committed under `status/milestones/` as
`<run date>-s8-pms-baseline.json`, dated on the day it is run, with the
machine state at run time (load average, swap used, free pages) recorded in
its notes.

The deliverable number is the flat `updates` / grouped `group-updates` pair on
S8 at 20k: that is the deterministic, finance-realistic pin on the
grouped-streaming 60 Hz miss.

`scripts/bench-row-model-gate.mjs` runs unchanged before and after the change,
and both results are attached to the PR, to demonstrate the existing gates are
untouched.

Comparator adapters (ag-grid, tanstack, mui) are **not** run in this pass. They
belong to the owed comparative re-baseline, which needs a quiet machine.

Known limit: at `dev` scale (750 rows) `replace` and `append` report
`unsupported` on S8, exactly as on S5, because `createBenchDataUpdatePlan`
needs 1,200 rows.

## 6. Tests

`packages/scenario-data`:

- S8 is listed after S7 in registry order; definition fields match §1.
- Every scale produces exactly 88 distinct (strategy, sector) pairs and all 8
  strategies and 11 sectors appear.
- Same seed → identical `checksumScenarioRows`; different seed → different.
- Derived-column invariants hold on every generated row.
- `"Technology"` is a sector; a known fraction of `notes` contain "earnings".
- S1–S7 `roles` equal the literal block in §2 (one assertion per scenario).
- `ticker` is unique per row.

`apps/bench`:

- `update-plan`: S5 `scheduleChecksum` at seed 505 equals its current literal.
  Ripple: every patch's `changes` contains the tick column and all derived
  columns and no group column; derived values satisfy the formulas against the
  working row; prices remain > 0 over a full 3 s plan; same seed → same plan.
- `bench-runtime`: a multi-key `changes` reaches `apply` intact (mutate by
  reverting the projection to `[columnId]: value` — the test must fail).
- `interaction-plan`: two-level `resultRowCount` for `group` and `group-expand`
  matches an engine-built tree on a small S8 fixture.
- `row-model-diagnostics`: group count tracks correctly under tuple keys when a
  patch changes one level.
- `query-state`: `scenario=S8` parses; the existing unsupported-params test
  still falls back to S1.

`packages/bench-runner`: S8 accepted for each script listed in §4 and rejected
for `autosize`, selection and cell-renderer scripts.

Every test that pins legacy behaviour (S5 checksum, S1–S7 roles, typing
fallback) is a negative control: the plan must show each one failing under a
deliberate mutation before it counts.

## Out of scope

- S9 / financial planning.
- Comparator runs and any competitive claim.
- Any new budget ceiling or gate entry.
- Currency / percent formatting in the bench adapters.
- Extending S8 to the selection, cell-renderer or autosize scripts.
