# Composite H1 Scroll Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evolve H1 from a single-metric frame-time comparison into a composite scroll quality hypothesis with five sub-criteria and a uniqueness gate, absorbing H3 into it.

**Architecture:** Replace `evaluateH1` in `scripts/bench-matrix.mjs` with a staged composite evaluation (absolute quality gate → frame parity → uniqueness gate → policy drift). Remove `evaluateH3` and `hasMedianStableButWorstCaseExceeded`. Update tests to remove H3 assertions and add composite H1 coverage.

**Tech Stack:** Node.js built-in test runner (`node:test`, `node:assert/strict`), no new dependencies.

---

## File Structure

- Modify: `scripts/bench-matrix.mjs` — replace `evaluateH1`, remove `evaluateH3`, remove `hasMedianStableButWorstCaseExceeded`, add `evaluateCompetitorSubCriteria`, update `createHypothesisReport`
- Modify: `scripts/__tests__/bench-matrix.test.mjs` — update/remove H3-referencing tests, add composite H1 tests

---

### Task 1: Remove H3 from hypothesis array and delete evaluateH3

**Files:**
- Modify: `scripts/bench-matrix.mjs:117-124` (hypothesis array)
- Modify: `scripts/bench-matrix.mjs:465-529` (evaluateH3 function)
- Modify: `scripts/bench-matrix.mjs:901-918` (hasMedianStableButWorstCaseExceeded function)

- [ ] **Step 1: Remove H3 tests that will break**

Remove these four tests from `scripts/__tests__/bench-matrix.test.mjs`:

1. "createHypothesisReport exposes worst-case H3 threshold metrics" (the test starting at line 768)
2. "createHypothesisReport marks single-sample H3 claims" (the test starting at line 905)
3. "createHypothesisReport downgrades H3 when policy notes vary" (the test starting at line 1156)
4. "createHypothesisReport treats backward anchor instability as an H3 failure" (the test starting at line 1221)

Also remove the H3 assertion from "createHypothesisReport aggregates repeated runs by median" (line 686):

```javascript
// DELETE this line:
assert.equal(h3?.status, "satisfied");
// DELETE this line:
assert.match(h3?.summary ?? "", /median|repeat/i);
```

And remove the `const h3` declaration on line 665:

```javascript
// DELETE this line:
const h3 = report.hypotheses.find((item) => item.id === "H3");
```

Also remove the H3 assertion from "createHypothesisReport distinguishes directional evidence from missing proof" (lines 341-344):

```javascript
// DELETE these lines:
assert.equal(
  report.hypotheses.find((item) => item.id === "H3")?.status,
  "insufficient",
);
```

- [ ] **Step 2: Remove evaluateH3 call from createHypothesisReport**

In `scripts/bench-matrix.mjs`, change lines 117-124 from:

```javascript
    hypotheses: [
      evaluateH1(input.runs),
      evaluateH3(input.runs),
      evaluateH6(input.runs),
      evaluateH7(input.runs),
      evaluateH8(input.runs),
      evaluateH5(input.entries, input.runs),
    ],
```

to:

```javascript
    hypotheses: [
      evaluateH1(input.runs),
      evaluateH6(input.runs),
      evaluateH7(input.runs),
      evaluateH8(input.runs),
      evaluateH5(input.entries, input.runs),
    ],
```

- [ ] **Step 3: Delete evaluateH3 function**

Delete the entire `evaluateH3` function in `scripts/bench-matrix.mjs` (lines 465-529).

- [ ] **Step 4: Delete hasMedianStableButWorstCaseExceeded function**

Delete the entire `hasMedianStableButWorstCaseExceeded` function in `scripts/bench-matrix.mjs` (lines 901-918, though line numbers will have shifted after step 3).

- [ ] **Step 5: Run tests to verify nothing else breaks**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: All remaining tests pass. Some H1 tests may fail because the old `evaluateH1` logic still references the 25% threshold — that's expected and will be fixed in Task 2.

- [ ] **Step 6: Commit**

```bash
git add scripts/bench-matrix.mjs scripts/__tests__/bench-matrix.test.mjs
git commit -m "refactor: remove H3 hypothesis and hasMedianStableButWorstCaseExceeded

H3's stability checks will be absorbed into composite H1 in the next task."
```

---

### Task 2: Replace evaluateH1 with composite implementation

**Files:**
- Modify: `scripts/bench-matrix.mjs:344-463` (evaluateH1 function)

- [ ] **Step 1: Replace evaluateH1 with composite implementation**

Replace the entire `evaluateH1` function (lines 344-463, though line numbers may have shifted from Task 1 deletions) with:

```javascript
function evaluateH1(runs) {
  const wrappedScrollSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scriptName: "scroll",
  });

  if (wrappedScrollSeries.length === 0) {
    return {
      id: "H1",
      status: "insufficient",
      summary:
        "Missing a completed S2 scroll run, so composite scroll quality cannot be evaluated yet.",
      evidence: [],
    };
  }

  const pretableEvidence = summarizeRunSeriesEvidence(wrappedScrollSeries);
  const blankGapFrames = maxMetric(wrappedScrollSeries, "blank_gap_frames");
  const longTasksCount = maxMetric(wrappedScrollSeries, "long_tasks_count");
  const rowHeightError =
    pretableEvidence.metrics.row_height_error_p95_px;
  const anchorShift =
    pretableEvidence.metrics.scroll_anchor_shift_backward_p95_px ??
    pretableEvidence.metrics.scroll_anchor_shift_px;

  const failingSubCriteria = [];

  if (rowHeightError === undefined || rowHeightError > 1) {
    failingSubCriteria.push(
      `row height error p95 is ${rowHeightError ?? "missing"}px (threshold: ≤ 1px)`,
    );
  }

  if (anchorShift === undefined || anchorShift > 16) {
    failingSubCriteria.push(
      `anchor shift is ${anchorShift ?? "missing"}px (threshold: ≤ 16px)`,
    );
  }

  if (blankGapFrames === undefined || blankGapFrames > 0) {
    failingSubCriteria.push(
      `blank gap frames is ${blankGapFrames ?? "missing"} (threshold: 0)`,
    );
  }

  if (longTasksCount === undefined || longTasksCount > 0) {
    failingSubCriteria.push(
      `long tasks count is ${longTasksCount ?? "missing"} (threshold: 0)`,
    );
  }

  if (failingSubCriteria.length > 0) {
    return {
      id: "H1",
      status: "failing",
      summary: `Wrapped-text scrolling is measured, but ${failingSubCriteria.length} quality sub-criteria are not yet met: ${failingSubCriteria.join("; ")}.`,
      evidence: [pretableEvidence],
    };
  }

  const competitorSeries = groupRunSeries(runs, {
    scenarioId: "S2",
    scriptName: "scroll",
  }).filter(
    (series) =>
      series[0]?.adapterId !== "pretable" &&
      medianMetric(series, "scroll_frame_p95_ms") !== undefined,
  );
  const fullGridCompetitorSeries = competitorSeries.filter(
    (series) => getAdapterFamily(series[0]?.adapterId) === "full-grid",
  );
  const primitiveCompetitorSeries = competitorSeries.filter(
    (series) =>
      getAdapterFamily(series[0]?.adapterId) === "virtualization-primitive",
  );

  if (fullGridCompetitorSeries.length === 0) {
    return {
      id: "H1",
      status: "directional",
      summary: hasPolicyDrift(pretableEvidence)
        ? "Wrapped-text scrolling meets all absolute quality thresholds on current medians, but policy drift across repeats keeps the result directional rather than reproducible."
        : "Wrapped-text scrolling meets all absolute quality thresholds, but the comparative uniqueness claim is unmeasured — no full-grid competitor data is available.",
      evidence: [
        pretableEvidence,
        ...(primitiveCompetitorSeries.length > 0
          ? [
              summarizeRunSeriesEvidence(
                primitiveCompetitorSeries.reduce((best, current) =>
                  medianMetric(current, "scroll_frame_p95_ms") <
                  medianMetric(best, "scroll_frame_p95_ms")
                    ? current
                    : best,
                ),
              ),
            ]
          : []),
      ],
    };
  }

  const bestFullGridSeries = fullGridCompetitorSeries.reduce(
    (best, current) =>
      medianMetric(current, "scroll_frame_p95_ms") <
      medianMetric(best, "scroll_frame_p95_ms")
        ? current
        : best,
  );
  const bestFullGridEvidence = summarizeRunSeriesEvidence(bestFullGridSeries);
  const bestPrimitiveEvidence =
    primitiveCompetitorSeries.length > 0
      ? summarizeRunSeriesEvidence(
          primitiveCompetitorSeries.reduce((best, current) =>
            medianMetric(current, "scroll_frame_p95_ms") <
            medianMetric(best, "scroll_frame_p95_ms")
              ? current
              : best,
          ),
        )
      : null;
  const evidenceArray = [
    pretableEvidence,
    bestFullGridEvidence,
    ...(bestPrimitiveEvidence ? [bestPrimitiveEvidence] : []),
  ];

  const frameParityRatio =
    pretableEvidence.metrics.scroll_frame_p95_ms /
    bestFullGridEvidence.metrics.scroll_frame_p95_ms;

  if (frameParityRatio > 1.1) {
    const percentAbove = Math.round((frameParityRatio - 1) * 100);

    return {
      id: "H1",
      status: "failing",
      summary: `Wrapped-text scrolling meets all quality thresholds, but frame p95 is ${percentAbove}% above the best full-grid comparator (${bestFullGridEvidence.adapterId}: ${bestFullGridEvidence.metrics.scroll_frame_p95_ms}ms vs pretable: ${pretableEvidence.metrics.scroll_frame_p95_ms}ms). The 10% parity threshold is not met.`,
      evidence: evidenceArray,
    };
  }

  const allFullGridCompetitorsPassQuality =
    fullGridCompetitorSeries.every((series) => {
      const evidence = summarizeRunSeriesEvidence(series);
      const subCriteria = evaluateCompetitorSubCriteria(evidence);

      return Object.values(subCriteria).every(Boolean);
    });

  if (allFullGridCompetitorsPassQuality) {
    return {
      id: "H1",
      status: "directional",
      summary:
        "Wrapped-text scrolling meets all quality thresholds, but so does every measured full-grid competitor — the uniqueness claim is not yet supported.",
      evidence: evidenceArray,
    };
  }

  const hasRelevantPolicyDrift =
    hasPolicyDrift(pretableEvidence) || hasPolicyDrift(bestFullGridEvidence);

  if (hasRelevantPolicyDrift) {
    return {
      id: "H1",
      status: "directional",
      summary:
        "Wrapped-text scrolling meets all quality and uniqueness thresholds on current medians, but policy drift across repeats keeps the result directional rather than reproducible.",
      evidence: evidenceArray,
    };
  }

  const hasRepeatedEvidence =
    pretableEvidence.sampleCount > 1 && bestFullGridEvidence.sampleCount > 1;

  return {
    id: "H1",
    status: "satisfied",
    summary: hasRepeatedEvidence
      ? "Wrapped-text scrolling delivers zero-artifact quality (row height error ≤ 1px, anchor shift ≤ 16px, no blank gaps, no long tasks) with frame times within 10% of the best measured full-grid comparator. No measured full-grid competitor achieves the same combined quality. Evidence is based on current repeated-run medians."
      : "Wrapped-text scrolling delivers zero-artifact quality (row height error ≤ 1px, anchor shift ≤ 16px, no blank gaps, no long tasks) with frame times within 10% of the best measured full-grid comparator. No measured full-grid competitor achieves the same combined quality. Evidence is based on the current sample.",
    evidence: evidenceArray,
  };
}

function evaluateCompetitorSubCriteria(evidence) {
  return {
    rowHeightAccuracy: evidence.metrics.row_height_error_p95_px <= 1,
    anchorStability:
      (evidence.metrics.scroll_anchor_shift_backward_p95_px ??
        evidence.metrics.scroll_anchor_shift_px) <= 16,
    blankGapControl: evidence.metrics.blank_gap_frames === 0,
    longTaskControl: evidence.metrics.long_tasks_count === 0,
  };
}
```

- [ ] **Step 2: Run tests**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: Some existing H1 tests may fail because their assertions reference the old 25% wording. Note which tests fail — they will be fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add scripts/bench-matrix.mjs
git commit -m "feat: replace evaluateH1 with composite scroll quality evaluation

Five sub-criteria (frame parity, row height accuracy, anchor stability,
blank gap control, long task control) plus a uniqueness gate requiring
at least one full-grid competitor to fail at least one quality threshold."
```

---

### Task 3: Update existing H1 test assertions

**Files:**
- Modify: `scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Update "distinguishes directional evidence from missing proof" test**

This test (starts at line 238 before Task 1 edits) has a pretable run at line 310-329 that is missing quality metrics (`row_height_error_p95_px`, `scroll_anchor_shift_backward_p95_px`). The composite H1 needs these. Also, the ag-grid run already has `row_height_error_p95_px: 0.2` and `scroll_anchor_shift_px: 8` — under composite H1, ag-grid passes all quality sub-criteria, so uniqueness fails. We need ag-grid to fail at least one.

Update the pretable run's metrics object (around line 323-328) to include quality metrics:

```javascript
        metrics: {
          scroll_frame_p95_ms: 12.4,
          blank_gap_frames: 0,
          long_tasks_count: 0,
          long_tasks_ms: 0,
          dom_nodes_peak: 512,
          row_height_error_p95_px: 0,
          scroll_anchor_shift_px: 0,
          scroll_anchor_shift_backward_p95_px: 0,
          scroll_anchor_shift_forward_p95_px: 0,
        },
```

Update the ag-grid run's `row_height_error_p95_px` from `0.2` to `2` so it fails the 1px quality threshold (uniqueness gate holds):

```javascript
          row_height_error_p95_px: 2,
```

Update the H1 assertions (around lines 333-340) from:

```javascript
  assert.equal(
    report.hypotheses.find((item) => item.id === "H1")?.status,
    "satisfied",
  );
  assert.match(
    report.hypotheses.find((item) => item.id === "H1")?.summary ?? "",
    /25%|relative/i,
  );
```

to:

```javascript
  assert.equal(
    report.hypotheses.find((item) => item.id === "H1")?.status,
    "satisfied",
  );
  assert.match(
    report.hypotheses.find((item) => item.id === "H1")?.summary ?? "",
    /zero-artifact|composite|quality/i,
  );
```

- [ ] **Step 2: Update "aggregates repeated runs by median" test**

The ag-grid runs in this test (around lines 641-660) have `row_height_error_p95_px` values of 42-45 — these fail the 1px threshold, so uniqueness holds. The pretable runs use `createScrollRun` which defaults quality metrics to 0. H1 should still be `satisfied`.

Update the H1 summary assertion (around line 668) from:

```javascript
  assert.match(h1?.summary ?? "", /median|repeat/i);
```

to:

```javascript
  assert.match(h1?.summary ?? "", /repeated-run medians|current sample/i);
```

- [ ] **Step 3: Update "exposes worst-case H1 threshold metrics" test**

This test has pretable with `blank_gap_frames: 1` on the worst-case run. Under composite H1, `maxMetric` for blank gaps is 1 > 0, so H1 is `failing`. The test already asserts `failing` — just update the summary match.

Update the summary assertions (around lines 757-759) from:

```javascript
  assert.equal(h1?.status, "failing");
  assert.match(h1?.summary ?? "", /medians/i);
  assert.match(h1?.summary ?? "", /worst-case|repeat/i);
```

to:

```javascript
  assert.equal(h1?.status, "failing");
  assert.match(h1?.summary ?? "", /quality sub-criteria/i);
  assert.match(h1?.summary ?? "", /blank gap frames/i);
```

- [ ] **Step 4: Update "prefers the best full-grid comparator for H1" test**

This test has pretable at 12.4ms, ag-grid at 26.2ms, tanstack at 20.1ms. Under composite H1, pretable passes all quality thresholds (defaults to 0). AG Grid has `row_height_error_p95_px: 0.2` — this passes the 1px threshold. But `scroll_anchor_shift_px: 8` — this also passes the 16px threshold. AG Grid passes all quality sub-criteria, so uniqueness fails. We need ag-grid to fail at least one.

Update the ag-grid run (around line 880) to have `row_height_error_p95_px: 2`:

```javascript
        row_height_error_p95_px: 2,
```

Update the summary assertion (around line 896) from:

```javascript
  assert.match(h1?.summary ?? "", /full-grid/i);
```

to:

```javascript
  assert.match(h1?.summary ?? "", /zero-artifact|quality/i);
```

- [ ] **Step 5: Update "records policy-note drift across repeated runs" test**

This test (starting around line 1085) has pretable-only runs with policy drift. Under composite H1, with no competitor data, H1 is `directional` due to "no full-grid competitor data" or policy drift. The test already asserts `directional` and matches `/policy|drift|reproduc/i`. This should still work because the directional summary for policy drift matches the pattern. No code change needed — verify it passes.

- [ ] **Step 6: Run tests**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add scripts/__tests__/bench-matrix.test.mjs
git commit -m "test: update existing H1 test assertions for composite evaluation

Adjust fixture data and assertion patterns to match the new composite H1
which uses quality sub-criteria instead of 25% frame-time threshold."
```

---

### Task 4: Add new composite H1 test cases

**Files:**
- Modify: `scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Add test — composite H1 fails when pretable exceeds absolute quality threshold**

Add after the last test in the file (before `createScrollRun`):

```javascript
test("composite H1 fails when pretable exceeds absolute quality threshold", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t10-00-00-000z",
    generatedAt: "2026-04-20T10:01:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-20t10-00-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-20t10-00-30-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-20T10:00:00.000Z",
        scroll_frame_p95_ms: 24,
        row_height_error_p95_px: 2,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-20T10:00:30.000Z",
        scroll_frame_p95_ms: 28,
        row_height_error_p95_px: 150,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "failing");
  assert.match(h1?.summary ?? "", /quality sub-criteria/i);
  assert.match(h1?.summary ?? "", /row height error/i);
});
```

- [ ] **Step 2: Add test — composite H1 fails when frame parity exceeds 110%**

```javascript
test("composite H1 fails when pretable frame parity exceeds 110%", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t10-10-00-000z",
    generatedAt: "2026-04-20T10:11:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-20t10-10-00-000z.summary.json",
      },
      {
        adapterId: "mui",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-mui-default-s2-dev-scroll-2026-04-20t10-10-30-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-20T10:10:00.000Z",
        scroll_frame_p95_ms: 30,
      }),
      createScrollRun({
        adapterId: "mui",
        timestamp: "2026-04-20T10:10:30.000Z",
        scroll_frame_p95_ms: 25,
        row_height_error_p95_px: 1.1,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "failing");
  assert.match(h1?.summary ?? "", /frame p95/i);
  assert.match(h1?.summary ?? "", /parity/i);
});
```

- [ ] **Step 3: Add test — composite H1 directional when all competitors pass quality**

```javascript
test("composite H1 directional when all full-grid competitors also pass quality thresholds", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t10-20-00-000z",
    generatedAt: "2026-04-20T10:21:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-20t10-20-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-20t10-20-30-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-20T10:20:00.000Z",
        scroll_frame_p95_ms: 24,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-20T10:20:30.000Z",
        scroll_frame_p95_ms: 26,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "directional");
  assert.match(h1?.summary ?? "", /uniqueness/i);
});
```

- [ ] **Step 4: Add test — composite H1 satisfied with MUI-like competitor**

```javascript
test("composite H1 satisfied with MUI-like competitor failing row height accuracy", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t10-30-00-000z",
    generatedAt: "2026-04-20T10:31:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-20t10-30-00-000z.summary.json",
      },
      {
        adapterId: "mui",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-mui-default-s2-dev-scroll-2026-04-20t10-30-30-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-20T10:30:00.000Z",
        scroll_frame_p95_ms: 24,
      }),
      createScrollRun({
        adapterId: "mui",
        timestamp: "2026-04-20T10:30:30.000Z",
        scroll_frame_p95_ms: 25,
        row_height_error_p95_px: 1.1,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "satisfied");
  assert.match(h1?.summary ?? "", /zero-artifact|quality/i);
});
```

- [ ] **Step 5: Add test — composite H1 checks backward anchor shift**

```javascript
test("composite H1 fails when pretable backward anchor shift exceeds threshold", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t10-40-00-000z",
    generatedAt: "2026-04-20T10:41:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-20t10-40-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-20T10:40:00.000Z",
        scroll_frame_p95_ms: 24,
        scroll_anchor_shift_px: undefined,
        scroll_anchor_shift_backward_p95_px: 20,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "failing");
  assert.match(h1?.summary ?? "", /anchor shift/i);
});
```

- [ ] **Step 6: Add test — hypothesis array has 5 entries**

```javascript
test("hypothesis array has 5 entries after H3 removal", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-20t10-50-00-000z",
    generatedAt: "2026-04-20T10:51:00.000Z",
    entries: [],
    runs: [],
  });

  assert.equal(report.hypotheses.length, 5);
  assert.ok(report.hypotheses.find((h) => h.id === "H1"));
  assert.equal(
    report.hypotheses.find((h) => h.id === "H3"),
    undefined,
  );
  assert.ok(report.hypotheses.find((h) => h.id === "H5"));
  assert.ok(report.hypotheses.find((h) => h.id === "H6"));
  assert.ok(report.hypotheses.find((h) => h.id === "H7"));
  assert.ok(report.hypotheses.find((h) => h.id === "H8"));
});
```

- [ ] **Step 7: Run all tests**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: All tests pass (existing updated tests + 6 new tests).

- [ ] **Step 8: Commit**

```bash
git add scripts/__tests__/bench-matrix.test.mjs
git commit -m "test: add composite H1 test cases

Cover absolute quality threshold failure, frame parity breach,
uniqueness gate, MUI-like competitor, anchor shift check, and
hypothesis array shape after H3 removal."
```

---

### Task 5: End-to-end verification

**Files:** None modified — verification only.

- [ ] **Step 1: Run full unit test suite**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs`

Expected: All tests pass, 0 failures.

- [ ] **Step 2: Run bench matrix at dev scale to verify report shape**

Run: `pnpm bench:matrix -- --project=chromium --adapters=pretable,mui --scenarios=S2 --scripts=scroll --scale=dev`

Expected: Produces a `*.hypotheses.json` with 5 hypotheses, H1 present, H3 absent.

- [ ] **Step 3: Inspect the hypothesis report**

Read the generated `*.hypotheses.json` in `status/runsets/`. Verify:
- H1 has `status: "satisfied"` (pretable quality all zeros, MUI has 1.1px height error)
- No H3 entry
- 5 total hypotheses

- [ ] **Step 4: Commit verification notes (optional)**

If the dev-scale run confirms the composite H1 works, no additional commit needed. If any issues surfaced and were fixed, commit those fixes.
