# Pinned-Column Inspection Scenario Design

## Goal

Add a new benchmark scenario (S7) that proves pretable delivers zero-artifact scroll quality and competitive interaction latency with 3 pinned columns on variable-height inspection content. This extends the proof surface beyond S2's single pinned column to cover real inspection-table layouts where multiple metadata columns are pinned alongside dense scrollable content.

## Current Behavior

S2 ("wrap-auto-height") is the primary wedge benchmark: 40 cols, 3 wrapped, 1 pinned left, variable-height, multilingual. All scroll and interaction hypotheses (H1, H6-H8) evaluate against S2 only. The bench app supports S1 and S2; S3-S6 are defined in scenario-data but not runnable (they represent unbuilt engine features).

Pretable already supports pinned columns — S2 uses one, the playground inspection profile pins two (timestamp, severity). But the proof surface doesn't exercise multiple pinned columns under benchmark conditions.

## Target Behavior

S7 ("pinned-inspection") is runnable in the bench app with all four adapters. Four new hypotheses (H9-H12) independently evaluate scroll quality and interaction latency on S7, using the same thresholds as their S2 counterparts.

## Scenario Definition

| Property | Value |
|----------|-------|
| id | S7 |
| name | pinned-inspection |
| rows | 50,000 |
| cols | 40 |
| row_height_mode | variable |
| wrapped_columns | 3 |
| pinned_left | 3 |
| corpus | multilingual |
| update_stream | none |
| purpose | Pinned-column overhead on variable-height inspection content |

Row count scales (identical to S2):

| Scale | Rows |
|-------|------|
| smoke | 120 |
| dev | 750 |
| hypothesis | 3,000 |
| target | 50,000 |

Column layout: The first 3 columns are pinned left with narrow widths (100-160px, not wrapped). Columns 3-5 are wrapped. The pinned zone shows compact metadata while the scrollable area has dense wrapped text.

Seed: 707 (next in sequence after S6's 606).

## Bench App Integration

### packages/scenario-data/src/index.ts

- Add `"S7"` to the `ScenarioId` type union.
- Add S7 to `scenarioDefinitions` array with the properties above.
- Add S7 row counts to `scenarioScaleRowCounts`.
- Add seed `707` to `scenarioSeeds`.

### apps/bench/src/bench-types.ts

Expand `scenarioId` in `BenchQueryState` from `"S1" | "S2"` to `"S1" | "S2" | "S7"`.

### apps/bench/src/query-state.ts

Add `"S7"` recognition in `parseBenchQuery` so `?scenario=S7` routes correctly.

### packages/bench-runner/src/index.ts

- Add `"S7"` to the allowed scenarios in `validateSupportedP0aRequest`.
- Allow interaction scripts (sort, filter-metadata, filter-text) on S7 (currently restricted to S2 only).

### scripts/bench-matrix.mjs

Add `"S7"` to `DEFAULT_SCENARIOS` so matrix runs include it alongside S1 and S2.

### No adapter changes

All four adapters (pretable, Grid Alpha, GridBeta, GridGamma) already respect `column.pinned` from the dataset and handle variable-height rows. S7 feeds them different column config through the same `ScenarioDataset` interface.

## Hypothesis Evaluation

Four new hypotheses mirror their S2 counterparts:

| Hypothesis | Mirrors | Scenario | Purpose |
|------------|---------|----------|---------|
| H9 | H1 (composite scroll quality) | S7 | Zero-artifact scroll with pinned-column overhead |
| H10 | H6 (sort interaction) | S7 | Sort latency ≤ 64ms with 3 pinned columns |
| H11 | H7 (metadata filter) | S7 | Filter-metadata latency ≤ 64ms with 3 pinned columns |
| H12 | H8 (filter-text) | S7 | Filter-text latency ≤ 64ms with 3 pinned columns |

### Implementation

Refactor `evaluateH1`, `evaluateH6`, `evaluateH7`, `evaluateH8` to accept a `scenarioId` parameter (no default — always explicit). H9-H12 are thin wrappers:

```javascript
function evaluateH9(runs) {
  return { ...evaluateH1(runs, "S7"), id: "H9" };
}
function evaluateH10(runs) {
  return { ...evaluateH6(runs, "S7"), id: "H10" };
}
function evaluateH11(runs) {
  return { ...evaluateH7(runs, "S7"), id: "H11" };
}
function evaluateH12(runs) {
  return { ...evaluateH8(runs, "S7"), id: "H12" };
}
```

Existing calls update to pass `"S2"` explicitly:

```javascript
hypotheses: [
  evaluateH1(runs, "S2"),
  evaluateH6(runs, "S2"),
  evaluateH7(runs, "S2"),
  evaluateH8(runs, "S2"),
  evaluateH5(entries, runs),
  evaluateH9(runs),
  evaluateH10(runs),
  evaluateH11(runs),
  evaluateH12(runs),
]
```

### H9 thresholds (same as composite H1)

- Frame parity: ≤ 110% of best full-grid competitor median
- Row height error: ≤ 1px
- Anchor shift: ≤ 16px
- Blank gaps: 0
- Long tasks: 0
- Uniqueness gate: at least one full-grid competitor fails at least one quality threshold

### H10-H12 thresholds (same as H6-H8)

Interaction latency p95 ≤ 64ms.

## Test Changes

### packages/scenario-data/src/\_\_tests\_\_/scenario-data.test.ts

Add test for S7 dataset creation: correct column count (40), 3 pinned columns, 3 wrapped columns, variable-height mode, row counts match each scale.

### apps/bench/src/\_\_tests\_\_/query-state.test.ts

Add test that `?scenario=S7` parses correctly.

### packages/bench-runner/src/\_\_tests\_\_/bench-runner.test.ts

Add tests that `validateSupportedP0aRequest` accepts S7 for scroll and interaction scripts.

### scripts/\_\_tests\_\_/bench-matrix.test.mjs

- Update all existing H1/H6/H7/H8 evaluate function calls to pass `"S2"` explicitly.
- Add tests for H9: satisfied, failing absolute threshold, failing frame parity, directional uniqueness.
- Add tests for H10-H12: satisfied and failing cases.
- Assert hypothesis array has 9 entries with no duplicate IDs.

## What This Does Not Change

- S1-S6 definitions — unchanged. S3-S6 remain aspirational.
- Adapters — no code changes.
- H1, H5-H8 — unchanged behavior, updated call signatures to accept explicit `scenarioId`.
- Bench scripts (scroll, sort, filter-metadata, filter-text) — no changes.
- Playwright E2E tests (`apps/bench/tests/bench.spec.ts`) — no changes.
- `packages/bench-runner` — only the validation function changes.
- Inspection profile (`inspection-profile.ts`) — unchanged.

## Verification

1. Unit tests: `pnpm test` (all packages + scripts)
2. Dev-scale matrix run: `pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S7 --scripts=scroll,sort,filter-metadata,filter-text --scale=dev --repeats=3`
3. Hypothesis-scale comparative: `pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta,gridgamma --scenarios=S7 --scripts=scroll --scale=hypothesis --repeats=3`
4. Inspect `*.hypotheses.json`: H9-H12 present with appropriate statuses, 9 hypotheses total.

## Risk

Low. S7 reuses all existing infrastructure — data generation, adapters, bench scripts, hypothesis evaluation logic. The primary risk is that 3 pinned columns expose a performance cliff in pretable's layout engine that doesn't appear with 1 pinned column. That would be a genuine finding (the point of this project), not an implementation bug.

The column width pattern for pinned columns (100-160px) keeps the total pinned width under ~450px in a 1440px viewport, leaving adequate room for scrollable content.
