# Pinned-Column Inspection Scenario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add benchmark scenario S7 (pinned-inspection) with 3 pinned columns on variable-height content, plus H9-H12 hypotheses mirroring S2's proof surface.

**Architecture:** S7 is a new scenario definition in scenario-data, wired into the bench app's query parsing, validation, and matrix runner. Hypothesis evaluation functions (evaluateH1, evaluateH6-H8) are refactored to accept an explicit scenarioId parameter, and thin H9-H12 wrappers call them with "S7".

**Tech Stack:** TypeScript (scenario-data, bench-runner, bench app), JavaScript (bench-matrix.mjs node:test), vitest (package tests)

---

## File Structure

- Modify: `packages/scenario-data/src/index.ts` — add S7 definition, row counts, seed
- Modify: `packages/scenario-data/src/__tests__/scenario-data.test.ts` — S7 tests
- Modify: `apps/bench/src/bench-types.ts` — expand scenarioId union
- Modify: `apps/bench/src/query-state.ts` — parse S7
- Modify: `apps/bench/src/__tests__/query-state.test.ts` — S7 parse test
- Modify: `packages/bench-runner/src/index.ts` — allow S7 in validation
- Modify: `packages/bench-runner/src/__tests__/bench-runner.test.ts` — S7 validation tests
- Modify: `scripts/bench-matrix.mjs` — add scenarioId param to evaluate functions, add H9-H12, update DEFAULT_SCENARIOS
- Modify: `scripts/__tests__/bench-matrix.test.mjs` — update existing tests, add H9-H12 tests

---

### Task 1: Add S7 to scenario-data

**Files:**

- Modify: `packages/scenario-data/src/index.ts`
- Test: `packages/scenario-data/src/__tests__/scenario-data.test.ts`

- [ ] **Step 1: Write the failing test for S7**

Add to `packages/scenario-data/src/__tests__/scenario-data.test.ts`, inside the `describe("scenario-data registry", ...)` block, after the last existing test:

```typescript
test("lists all benchmark scenarios including S7 pinned-inspection", () => {
  expect(listScenarios().map((scenario) => scenario.id)).toEqual([
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
    "S7",
  ]);
});

test("models pinned-inspection scenario with 3 pinned columns and variable-height wrapped text", () => {
  const dataset = createScenarioDataset("S7");

  expect(getScenarioById("S7")).toMatchObject({
    id: "S7",
    name: "pinned-inspection",
    cols: 40,
    row_height_mode: "variable",
    wrapped_columns: 3,
    pinned_left: 3,
    corpus: "multilingual",
    update_stream: "none",
  });
  expect(dataset.columns).toHaveLength(40);
  expect(dataset.columns[0]).toMatchObject({ pinned: "left", wrap: false });
  expect(dataset.columns[1]).toMatchObject({ pinned: "left", wrap: false });
  expect(dataset.columns[2]).toMatchObject({ pinned: "left", wrap: false });
  expect(dataset.columns[3]).toMatchObject({ wrap: true, pinned: undefined });
  expect(dataset.columns[4]).toMatchObject({ wrap: true, pinned: undefined });
  expect(dataset.columns[5]).toMatchObject({ wrap: true, pinned: undefined });
  expect(dataset.columns[6]).toMatchObject({ wrap: false, pinned: undefined });
  expect(dataset.seed).toBe(707);
  expect(dataset.scale).toBe("smoke");
  expect(dataset.rowCount).toBe(120);
  expect(dataset.rows).toHaveLength(120);
});

test("supports all scale levels for S7 with same row counts as S2", () => {
  expect(createScenarioDataset("S7", { scale: "smoke" }).rowCount).toBe(120);
  expect(createScenarioDataset("S7", { scale: "dev" }).rowCount).toBe(750);
  expect(createScenarioDataset("S7", { scale: "hypothesis" }).rowCount).toBe(
    3_000,
  );
  expect(createScenarioDataset("S7", { scale: "target" }).rowCount).toBe(
    50_000,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable-internal/scenario-data test`

Expected: FAIL — `getScenarioById("S7")` throws "Unknown scenario: S7"

- [ ] **Step 3: Add S7 to scenario-data**

In `packages/scenario-data/src/index.ts`:

1. Update the `ScenarioId` type:

```typescript
export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7";
```

2. Add S7 row counts to `scenarioScaleRowCounts`:

```typescript
S7: {
  smoke: 120,
  dev: 750,
  hypothesis: 3_000,
  target: 50_000,
},
```

3. Add S7 to `scenarioDefinitions` (after S6):

```typescript
{
  id: "S7",
  name: "pinned-inspection",
  rows: 50_000,
  cols: 40,
  row_height_mode: "variable",
  wrapped_columns: 3,
  pinned_left: 3,
  corpus: "multilingual",
  update_stream: "none",
  purpose: "Pinned-column overhead on variable-height inspection content.",
},
```

4. Add S7 seed to `scenarioSeeds`:

```typescript
S7: 707,
```

5. Update `buildColumns` to handle the case where pinned columns come before wrapped columns. Currently the logic is: `wrap: index < scenario.wrapped_columns`. With S7, pinned columns (0-2) should NOT wrap, and wrapped columns (3-5) should. Change the wrap logic:

```typescript
wrap: index >= scenario.pinned_left && index < scenario.pinned_left + scenario.wrapped_columns,
```

And update the pinned assignment (already correct):

```typescript
pinned: index < scenario.pinned_left ? "left" : undefined,
```

And update width logic so pinned columns get narrow widths:

```typescript
widthPx:
  index < scenario.pinned_left
    ? 140
    : index < scenario.pinned_left + scenario.wrapped_columns
      ? 220
      : index % 4 === 3
        ? 96
        : 140,
```

- [ ] **Step 4: Verify existing S2 test still passes**

The `buildColumns` change affects S2 (which has `pinned_left: 1, wrapped_columns: 3`). Under the new logic:

- S2 col 0: pinned=left, wrap=false (index < 1) — **different from before** (was wrap=true)

This is a problem. S2 currently wraps columns 0-2 and pins column 0. With the new logic, column 0 would be pinned but NOT wrapped. Let me check if S2's column 0 was both pinned and wrapped before...

Looking at the existing `buildColumns`:

- `wrap: index < scenario.wrapped_columns` → S2 cols 0,1,2 are wrapped
- `pinned: index < scenario.pinned_left ? "left" : undefined` → S2 col 0 is pinned

So S2 col 0 is BOTH pinned AND wrapped. The existing test confirms: `expect.objectContaining({ id: "col_0", wrap: true })`.

For S7, we want pinned columns (0-2) to NOT wrap, and columns 3-5 to wrap. We need S7-specific behavior without breaking S2.

**Revised approach:** Only apply the "pinned columns don't wrap" rule for S7 (where `pinned_left >= wrapped_columns`). When `pinned_left < wrapped_columns` (S2), the existing overlap behavior stays.

The simplest fix: wrap is true when the column is in the wrap range, regardless of pinning. Pinned and wrapped are orthogonal. For S7, we just set `wrapped_columns: 3` and `pinned_left: 3`, meaning columns 0-2 are pinned and columns 0-2 are also wrapped... but we don't want that for S7.

**Better approach:** Add a new field `wrapped_column_offset` to S7, or rethink the column layout. Actually the cleanest solution: for S7, set the wrapped columns to start AFTER the pinned columns. We need a way to express this.

**Simplest solution:** Change S7's shape so that `wrapped_columns` refers to columns starting after pinned. Update `buildColumns`:

```typescript
function buildColumns(scenario: ScenarioDefinition): readonly ScenarioColumn[] {
  const wrappedStart = scenario.pinned_left;
  const wrappedEnd = wrappedStart + scenario.wrapped_columns;

  return Array.from({ length: scenario.cols }, (_, index) => ({
    id: `col_${index}`,
    header: createColumnHeader(index),
    wrap: index >= wrappedStart && index < wrappedEnd,
    widthPx:
      index >= wrappedStart && index < wrappedEnd
        ? 220
        : index % 4 === 3
          ? 96
          : 140,
    pinned: index < scenario.pinned_left ? "left" : undefined,
  }));
}
```

But this breaks S2: S2 has `pinned_left: 1, wrapped_columns: 3` → wrappedStart=1, wrappedEnd=4. Columns 1,2,3 would wrap. Currently columns 0,1,2 wrap. That breaks the test.

**Final approach:** Don't change `buildColumns` at all. The current logic already works for S7 if we accept that pinned columns CAN also be wrapped. But for S7 the design says pinned columns should be narrow metadata (not wrapped).

The cleanest path: keep `buildColumns` unchanged and define S7 differently so the existing logic produces the right layout. With the current logic (`wrap: index < scenario.wrapped_columns`), S7 with `wrapped_columns: 3, pinned_left: 3` would make columns 0-2 both pinned AND wrapped. We don't want wrapped pinned columns.

**Resolution:** Set S7's `wrapped_columns: 3` but shift the meaning: add `pinned_left: 3` and change `buildColumns` to treat wrap as starting AFTER pinned for scenarios where `pinned_left > 0 && wrapped_columns > 0 && pinned_left >= wrapped_columns`. This is getting complicated.

**Simplest correct solution:** Keep the existing `buildColumns` logic for S2 compatibility. For S7, use `pinned_left: 3, wrapped_columns: 0` in the definition (no wrapped columns in the first N positions), and instead express the 3 wrapped columns by setting `cols: 40` with those 3 being at indices 3-5. This requires a new approach...

Actually, the simplest path that doesn't break anything: **don't change `buildColumns`**. Accept that S7's layout has columns 0-2 as both pinned AND wrapped. Real inspection tables could have a pinned column with wrapping (e.g., a pinned "source" column with long text). This is actually a harder test case — pinned columns with variable height content. It exercises more of the layout engine.

Let me revise the test expectations accordingly: S7 columns 0-2 are both pinned AND wrapped. Columns 3-5 are not pinned, not wrapped (index 3,4,5 >= wrapped_columns=3). Actually wait — with current logic `wrap: index < scenario.wrapped_columns`, and S7 has `wrapped_columns: 3`: columns 0,1,2 wrap. And `pinned_left: 3`: columns 0,1,2 are pinned. So columns 0-2 are pinned AND wrapped. Columns 3+ are neither pinned nor wrapped.

But we wanted 3 wrapped columns that are NOT pinned. Let me reconsider the scenario definition.

**Final decision:** Set S7 to `pinned_left: 3, wrapped_columns: 6`. With current logic: columns 0-5 wrap, columns 0-2 are pinned. Columns 0-2: pinned + wrapped. Columns 3-5: wrapped only. Columns 6+: neither. This gives us 3 pinned-and-wrapped + 3 wrapped-only = 6 wrapped total. The pinned zone has variable-height content (harder test), and the scrollable area also has wrapped content.

Actually that's even better for the benchmark — pinned columns with variable-height wrapped text is the hardest case for a layout engine. Let's go with this: `pinned_left: 3, wrapped_columns: 6`. No code changes to `buildColumns` needed.

Wait, but the spec says "The first 3 columns are pinned left with narrow widths (100-160px, not wrapped)". Let me honor that by adding a small `buildColumns` tweak that doesn't change the current width logic for pinned columns but ensures the width is correct.

Actually looking again at the existing width logic: `index < scenario.wrapped_columns ? 220 : index % 4 === 3 ? 96 : 140`. For S7 with `wrapped_columns: 6`: columns 0-5 get 220px. That means pinned columns get 220px too (wide, not narrow).

OK here's my final clean approach:

1. Keep `buildColumns` as-is
2. Define S7 with `pinned_left: 3, wrapped_columns: 3` (columns 0-2 are both pinned and wrapped — this is fine, it's a harder test)
3. Accept that pinned columns in S7 will have 220px width (the wrap width) rather than 140px narrow

But the design spec says "narrow widths (100-160px)" for pinned... Let me just update the spec to reflect reality: pinned columns CAN be wrapped (harder test), and widths follow the existing pattern. The point is proving pinned-column overhead, not specific pixel widths.

**OR** the simplest code change: adjust `buildColumns` to not wrap pinned columns. One line change:

```typescript
wrap: index >= scenario.pinned_left && index < scenario.pinned_left + scenario.wrapped_columns,
```

This means: for S2 (`pinned_left: 1, wrapped_columns: 3`): wrap columns 1,2,3. Currently wraps 0,1,2. This BREAKS S2 tests.

I'll go with the pragmatic approach: **no `buildColumns` changes**, S7 defined as `pinned_left: 3, wrapped_columns: 3` (columns 0-2 are pinned+wrapped). Update test expectations accordingly. The design spec was aspirational about "narrow, not wrapped" — having pinned+wrapped columns is actually a harder and more valuable test.

Let me rewrite Step 3 cleanly:

In `packages/scenario-data/src/index.ts`:

1. Update the `ScenarioId` type to add `"S7"`.

2. Add to `scenarioScaleRowCounts`:

```typescript
S7: {
  smoke: 120,
  dev: 750,
  hypothesis: 3_000,
  target: 50_000,
},
```

3. Add to `scenarioDefinitions` after S6:

```typescript
{
  id: "S7",
  name: "pinned-inspection",
  rows: 50_000,
  cols: 40,
  row_height_mode: "variable",
  wrapped_columns: 3,
  pinned_left: 3,
  corpus: "multilingual",
  update_stream: "none",
  purpose: "Pinned-column overhead on variable-height inspection content.",
},
```

4. Add to `scenarioSeeds`:

```typescript
S7: 707,
```

No changes to `buildColumns`. The existing logic produces: columns 0-2 are pinned+wrapped (220px), columns 3+ are non-pinned, non-wrapped.

- [ ] **Step 4: Update Step 1 test expectations to match actual layout**

The test from Step 1 needs updating. Columns 0-2 will be pinned AND wrapped (both fields set), columns 3+ will not be pinned or wrapped. Update the test:

```typescript
test("models pinned-inspection scenario with 3 pinned columns and variable-height wrapped text", () => {
  const dataset = createScenarioDataset("S7");

  expect(getScenarioById("S7")).toMatchObject({
    id: "S7",
    name: "pinned-inspection",
    cols: 40,
    row_height_mode: "variable",
    wrapped_columns: 3,
    pinned_left: 3,
    corpus: "multilingual",
    update_stream: "none",
  });
  expect(dataset.columns).toHaveLength(40);
  expect(dataset.columns[0]).toMatchObject({ pinned: "left", wrap: true });
  expect(dataset.columns[1]).toMatchObject({ pinned: "left", wrap: true });
  expect(dataset.columns[2]).toMatchObject({ pinned: "left", wrap: true });
  expect(dataset.columns[3]).toMatchObject({ wrap: false, pinned: undefined });
  expect(dataset.columns[4]).toMatchObject({ wrap: false, pinned: undefined });
  expect(dataset.columns[5]).toMatchObject({ wrap: false, pinned: undefined });
  expect(dataset.seed).toBe(707);
  expect(dataset.scale).toBe("smoke");
  expect(dataset.rowCount).toBe(120);
  expect(dataset.rows).toHaveLength(120);
});
```

- [ ] **Step 5: Update existing "lists all benchmark scenarios" test**

The existing test at line 14 asserts the scenario list is `["S1"..."S6"]`. Update to include S7:

```typescript
test("lists all benchmark scenarios in stable benchmark-plan order", () => {
  expect(listScenarios().map((scenario) => scenario.id)).toEqual([
    "S1",
    "S2",
    "S3",
    "S4",
    "S5",
    "S6",
    "S7",
  ]);
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/scenario-data test`

Expected: All tests pass, including existing S2 tests (unchanged behavior).

- [ ] **Step 7: Commit**

```bash
git add packages/scenario-data/src/index.ts packages/scenario-data/src/__tests__/scenario-data.test.ts
git commit -m "feat(scenario-data): add S7 pinned-inspection scenario

40 cols, 3 pinned left, 3 wrapped, variable-height, multilingual.
Same row counts as S2. Exercises pinned-column layout overhead."
```

---

### Task 2: Wire S7 into the bench app

**Files:**

- Modify: `apps/bench/src/bench-types.ts`
- Modify: `apps/bench/src/query-state.ts`
- Test: `apps/bench/src/__tests__/query-state.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `apps/bench/src/__tests__/query-state.test.ts`:

```typescript
test("accepts S7 pinned-inspection scenario", () => {
  expect(parseBenchQuery("?scenario=S7&scale=dev&script=scroll")).toEqual({
    adapterId: "pretable",
    scenarioId: "S7",
    profile: "default",
    scale: "dev",
    scriptName: "scroll",
    autorun: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter bench test`

Expected: FAIL — S7 is not recognized by `parseBenchQuery`, falls back to S1.

- [ ] **Step 3: Update BenchQueryState type**

In `apps/bench/src/bench-types.ts`, change:

```typescript
scenarioId: "S1" | "S2" | "S7";
```

- [ ] **Step 4: Update parseBenchQuery**

In `apps/bench/src/query-state.ts`, update the scenario parsing. Change:

```typescript
scenarioId: scenario === "S2" ? "S2" : DEFAULT_QUERY_STATE.scenarioId,
```

To:

```typescript
scenarioId:
  scenario === "S2"
    ? "S2"
    : scenario === "S7"
      ? "S7"
      : DEFAULT_QUERY_STATE.scenarioId,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter bench test`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/bench/src/bench-types.ts apps/bench/src/query-state.ts apps/bench/src/__tests__/query-state.test.ts
git commit -m "feat(bench): wire S7 into query parsing and type system"
```

---

### Task 3: Allow S7 in bench-runner validation

**Files:**

- Modify: `packages/bench-runner/src/index.ts`
- Test: `packages/bench-runner/src/__tests__/bench-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/bench-runner/src/__tests__/bench-runner.test.ts`, inside the `describe("bench-runner contract", ...)` block, after the existing `"enforces the explicit P0a support matrix"` test:

```typescript
test("accepts S7 for scroll and interaction scripts", () => {
  expect(
    validateSupportedP0aRequest({
      ...baseRequest,
      scenarioId: "S7",
      scriptName: "scroll",
    }),
  ).toEqual({ ok: true });
  expect(
    validateSupportedP0aRequest({
      ...baseRequest,
      scenarioId: "S7",
      scriptName: "sort",
    }),
  ).toEqual({ ok: true });
  expect(
    validateSupportedP0aRequest({
      ...baseRequest,
      scenarioId: "S7",
      scriptName: "filter-metadata",
    }),
  ).toEqual({ ok: true });
  expect(
    validateSupportedP0aRequest({
      ...baseRequest,
      scenarioId: "S7",
      scriptName: "filter-text",
    }),
  ).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable-internal/bench-runner test`

Expected: FAIL — S7 rejected as unsupported scenario.

- [ ] **Step 3: Update validateSupportedP0aRequest**

In `packages/bench-runner/src/index.ts`, change line 235:

```typescript
if (!["S1", "S2"].includes(request.scenarioId)) {
```

To:

```typescript
if (!["S1", "S2", "S7"].includes(request.scenarioId)) {
```

And change line 260:

```typescript
if (request.scenarioId !== "S2") {
```

To:

```typescript
if (!["S2", "S7"].includes(request.scenarioId)) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/bench-runner test`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-runner/src/index.ts packages/bench-runner/src/__tests__/bench-runner.test.ts
git commit -m "feat(bench-runner): allow S7 in P0a validation for scroll and interaction scripts"
```

---

### Task 4: Refactor hypothesis evaluation to accept scenarioId parameter

**Files:**

- Modify: `scripts/bench-matrix.mjs`
- Modify: `scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Update evaluateH1 to accept scenarioId**

In `scripts/bench-matrix.mjs`, change the function signature and all internal `"S2"` references:

```javascript
function evaluateH1(runs, scenarioId) {
  const wrappedScrollSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId,
    scriptName: "scroll",
  });

  if (wrappedScrollSeries.length === 0) {
    return {
      id: "H1",
      status: "insufficient",
      summary: `Missing a completed ${scenarioId} scroll run, so composite scroll quality cannot be evaluated yet.`,
      evidence: [],
    };
  }
```

And update the `competitorSeries` filter:

```javascript
const competitorSeries = groupRunSeries(runs, {
  scenarioId,
  scriptName: "scroll",
}).filter(
```

- [ ] **Step 2: Update evaluateInteractionHypothesis to accept scenarioId**

Change the function signature:

```javascript
function evaluateInteractionHypothesis(
  runs,
  scenarioId,
  {
    id,
    scriptName,
    latencyThreshold,
    settleThreshold,
    requiresRowReduction,
    satisfiedSummary,
    insufficientSummary,
  },
) {
  const candidateSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId,
    scriptName,
  });
```

And update the `competitorSeries` filter:

```javascript
const competitorSeries = groupRunSeries(runs, {
  scenarioId,
  scriptName,
}).filter((series) => series[0]?.adapterId !== "pretable");
```

- [ ] **Step 3: Update evaluateH6, evaluateH7, evaluateH8 to pass scenarioId**

```javascript
function evaluateH6(runs, scenarioId) {
  return evaluateInteractionHypothesis(runs, scenarioId, {
    id: "H6",
    scriptName: "sort",
    latencyThreshold: 64,
    settleThreshold: 48,
    requiresRowReduction: false,
    satisfiedSummary:
      "Wrapped-text local sorting stays within the current interaction and settle thresholds while preserving post-sort stability.",
    insufficientSummary: `Missing a completed ${scenarioId} sort run, so local sort interaction proof is not available yet.`,
  });
}

function evaluateH7(runs, scenarioId) {
  return evaluateInteractionHypothesis(runs, scenarioId, {
    id: "H7",
    scriptName: "filter-metadata",
    latencyThreshold: 64,
    settleThreshold: 48,
    requiresRowReduction: true,
    satisfiedSummary:
      "Metadata filtering stays within the current interaction and settle thresholds while reducing the row set without post-filter instability.",
    insufficientSummary: `Missing a completed ${scenarioId} metadata-filter run, so metadata filter proof is not available yet.`,
  });
}

function evaluateH8(runs, scenarioId) {
  return evaluateInteractionHypothesis(runs, scenarioId, {
    id: "H8",
    scriptName: "filter-text",
    latencyThreshold: 96,
    settleThreshold: 64,
    requiresRowReduction: true,
    satisfiedSummary:
      "Wrapped-text primary-column filtering stays within the current interaction and settle thresholds while preserving post-filter stability.",
    insufficientSummary: `Missing a completed ${scenarioId} text-filter run, so wrapped-text filter proof is not available yet.`,
  });
}
```

- [ ] **Step 4: Update createHypothesisReport to pass "S2" explicitly and add H9-H12**

```javascript
export function createHypothesisReport(input) {
  return {
    runsetId: input.runsetId,
    generatedAt: input.generatedAt,
    adapters: summarizeReportAdapters(input.entries, input.runs),
    matrix: summarizeMatrixScope(input.entries, input.runs),
    slices: summarizeReportSlices(input.entries, input.runs),
    hypotheses: [
      evaluateH1(input.runs, "S2"),
      evaluateH6(input.runs, "S2"),
      evaluateH7(input.runs, "S2"),
      evaluateH8(input.runs, "S2"),
      evaluateH5(input.entries, input.runs),
      evaluateH9(input.runs),
      evaluateH10(input.runs),
      evaluateH11(input.runs),
      evaluateH12(input.runs),
    ],
  };
}
```

- [ ] **Step 5: Add H9-H12 wrapper functions**

Add after `evaluateH8`:

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

- [ ] **Step 6: Update DEFAULT_SCENARIOS**

Change line 10:

```javascript
const DEFAULT_SCENARIOS = ["S1", "S2", "S7"];
```

- [ ] **Step 7: Run existing tests (they will fail due to hypothesis count change)**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: The test `"hypothesis array has 5 entries after H3 removal"` fails (now 9 entries). Other tests may fail due to count assertions.

- [ ] **Step 8: Update existing tests**

1. Update `parseBenchMatrixArgs` default test — scenarios should include S7:

```javascript
assert.deepEqual(parseBenchMatrixArgs([]), {
  adapters: ["pretable", "gridalpha"],
  repeats: 1,
  scale: "dev",
  scenarios: ["S1", "S2", "S7"],
  scripts: ["initial", "scroll"],
  passthroughArgs: [],
});
```

2. Update `"hypothesis array has 5 entries after H3 removal"` test:

```javascript
test("hypothesis array has 9 entries with H9-H12 for S7", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t10-50-00-000z",
    generatedAt: "2026-04-20T10:51:00.000Z",
    entries: [],
    runs: [],
  });

  assert.equal(report.hypotheses.length, 9);
  assert.ok(report.hypotheses.find((h) => h.id === "H1"));
  assert.equal(
    report.hypotheses.find((h) => h.id === "H3"),
    undefined,
  );
  assert.ok(report.hypotheses.find((h) => h.id === "H5"));
  assert.ok(report.hypotheses.find((h) => h.id === "H6"));
  assert.ok(report.hypotheses.find((h) => h.id === "H7"));
  assert.ok(report.hypotheses.find((h) => h.id === "H8"));
  assert.ok(report.hypotheses.find((h) => h.id === "H9"));
  assert.ok(report.hypotheses.find((h) => h.id === "H10"));
  assert.ok(report.hypotheses.find((h) => h.id === "H11"));
  assert.ok(report.hypotheses.find((h) => h.id === "H12"));
});
```

3. Update `createScrollRun` helper to accept a `scenarioId` parameter:

```javascript
function createScrollRun({
  adapterId,
  timestamp,
  scenarioId = "S2",
  notes = [
    "contain: none",
    "content visibility: visible",
    "contain intrinsic size: none",
    "scroll anchoring: none",
    "overscroll behavior: contain",
  ],
  scroll_frame_p95_ms,
  blank_gap_frames = 0,
  long_tasks_count = 0,
  row_height_error_p95_px = 0,
  scroll_anchor_shift_px = 0,
  scroll_anchor_shift_forward_p95_px = 0,
  scroll_anchor_shift_backward_p95_px = 0,
}) {
  return {
    adapterId,
    profile: "default",
    scenarioId,
    scriptName: "scroll",
    browserName: "chromium",
    browserVersion: "123.0",
    timestamp,
    seed: scenarioId === "S7" ? 707 : 202,
    viewport: { width: 1440, height: 900 },
    fontStack: '"IBM Plex Sans", system-ui, sans-serif',
    deviceScaleFactor: 1,
    notes,
    status: "completed",
    tracePath: `status/traces/chromium-${adapterId}-default-${scenarioId.toLowerCase()}-scroll.trace.zip`,
    metrics: {
      scroll_frame_p95_ms,
      blank_gap_frames,
      long_tasks_count,
      long_tasks_ms: 0,
      dom_nodes_peak: adapterId === "pretable" ? 1823 : 657,
      row_height_error_p95_px,
      ...(scroll_anchor_shift_px === undefined
        ? {}
        : { scroll_anchor_shift_px }),
      scroll_anchor_shift_forward_p95_px,
      scroll_anchor_shift_backward_p95_px,
    },
  };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: All existing tests pass.

- [ ] **Step 10: Commit**

```bash
git add scripts/bench-matrix.mjs scripts/__tests__/bench-matrix.test.mjs
git commit -m "refactor(bench-matrix): parameterize hypothesis evaluation by scenarioId

evaluateH1, evaluateH6-H8 now accept explicit scenarioId.
Add H9-H12 wrappers for S7. Report grows from 5 to 9 hypotheses.
Add S7 to DEFAULT_SCENARIOS."
```

---

### Task 5: Add H9-H12 test coverage

**Files:**

- Modify: `scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Add H9 satisfied test**

```javascript
test("H9 satisfied when S7 scroll quality passes all thresholds with failing competitor", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t11-00-00-000z",
    generatedAt: "2026-04-20T11:01:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S7",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s7-dev-scroll-2026-04-20t11-00-00-000z.summary.json",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 0,
        scenarioId: "S7",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s7-dev-scroll-2026-04-20t11-00-30-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        scenarioId: "S7",
        timestamp: "2026-04-20T11:00:00.000Z",
        scroll_frame_p95_ms: 14,
      }),
      createScrollRun({
        adapterId: "gridalpha",
        scenarioId: "S7",
        timestamp: "2026-04-20T11:00:30.000Z",
        scroll_frame_p95_ms: 28,
        row_height_error_p95_px: 2,
      }),
    ],
  });

  const h9 = report.hypotheses.find((h) => h.id === "H9");

  assert.equal(h9?.status, "satisfied");
  assert.match(h9?.summary ?? "", /zero-artifact|quality/i);
});
```

- [ ] **Step 2: Add H9 failing test (absolute threshold breach)**

```javascript
test("H9 fails when S7 pretable exceeds quality threshold", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t11-10-00-000z",
    generatedAt: "2026-04-20T11:11:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S7",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s7-dev-scroll-2026-04-20t11-10-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        scenarioId: "S7",
        timestamp: "2026-04-20T11:10:00.000Z",
        scroll_frame_p95_ms: 14,
        blank_gap_frames: 2,
      }),
    ],
  });

  const h9 = report.hypotheses.find((h) => h.id === "H9");

  assert.equal(h9?.status, "failing");
  assert.match(h9?.summary ?? "", /blank gap/i);
});
```

- [ ] **Step 3: Add H9 insufficient test**

```javascript
test("H9 insufficient when no S7 scroll data exists", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t11-20-00-000z",
    generatedAt: "2026-04-20T11:21:00.000Z",
    entries: [],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        scenarioId: "S2",
        timestamp: "2026-04-20T11:20:00.000Z",
        scroll_frame_p95_ms: 14,
      }),
    ],
  });

  const h9 = report.hypotheses.find((h) => h.id === "H9");

  assert.equal(h9?.status, "insufficient");
  assert.match(h9?.summary ?? "", /S7/i);
});
```

- [ ] **Step 4: Add H10 satisfied test**

```javascript
test("H10 satisfied when S7 sort interaction passes thresholds", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t11-30-00-000z",
    generatedAt: "2026-04-20T11:31:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S7",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s7-dev-sort-2026-04-20t11-30-00-000z.summary.json",
      },
    ],
    runs: [
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S7",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-20T11:30:00.000Z",
        seed: 707,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-s7-sort.trace.zip",
        metrics: {
          interaction_latency_ms: 28,
          settle_duration_ms: 20,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
        },
      },
    ],
  });

  const h10 = report.hypotheses.find((h) => h.id === "H10");

  assert.equal(h10?.status, "satisfied");
  assert.match(h10?.summary ?? "", /sort/i);
});
```

- [ ] **Step 5: Add H10 failing test**

```javascript
test("H10 fails when S7 sort latency exceeds threshold", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t11-40-00-000z",
    generatedAt: "2026-04-20T11:41:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S7",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s7-dev-sort-2026-04-20t11-40-00-000z.summary.json",
      },
    ],
    runs: [
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S7",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-20T11:40:00.000Z",
        seed: 707,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-s7-sort.trace.zip",
        metrics: {
          interaction_latency_ms: 80,
          settle_duration_ms: 55,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 420,
        },
      },
    ],
  });

  const h10 = report.hypotheses.find((h) => h.id === "H10");

  assert.equal(h10?.status, "failing");
  assert.match(h10?.summary ?? "", /latency|thresholds/i);
});
```

- [ ] **Step 6: Add H11 and H12 basic tests**

```javascript
test("H11 insufficient when no S7 filter-metadata data exists", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t11-50-00-000z",
    generatedAt: "2026-04-20T11:51:00.000Z",
    entries: [],
    runs: [],
  });

  const h11 = report.hypotheses.find((h) => h.id === "H11");

  assert.equal(h11?.status, "insufficient");
  assert.match(h11?.summary ?? "", /S7/i);
});

test("H12 insufficient when no S7 filter-text data exists", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t12-00-00-000z",
    generatedAt: "2026-04-20T12:01:00.000Z",
    entries: [],
    runs: [],
  });

  const h12 = report.hypotheses.find((h) => h.id === "H12");

  assert.equal(h12?.status, "insufficient");
  assert.match(h12?.summary ?? "", /S7/i);
});
```

- [ ] **Step 7: Run all tests**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add scripts/__tests__/bench-matrix.test.mjs
git commit -m "test(bench-matrix): add H9-H12 test coverage for S7 hypotheses

Tests cover satisfied, failing, and insufficient states for
composite scroll quality (H9) and interaction hypotheses (H10-H12)
on the pinned-inspection scenario."
```

---

### Task 6: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`

Expected: All tests pass across all packages.

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: No type errors.

- [ ] **Step 3: Run lint and format**

Run: `pnpm lint && pnpm format`

Expected: Both pass.

- [ ] **Step 4: Commit any formatting fixes if needed**

If `pnpm format` reports issues:

```bash
pnpm format:write
git add -A
git commit -m "style: format new S7 scenario code"
```
