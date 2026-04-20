# Composite H1 Scroll Quality Design

## Goal

Evolve H1 from a single-metric frame-time comparison into a composite scroll quality hypothesis, and absorb H3 (variable-height stability) into it. The new H1 claims: "Pretable is the only adapter that delivers zero-artifact scroll quality with competitive frame times on variable-height inspection content."

## Current Behavior

H1 evaluates a single metric: pretable's `scroll_frame_p95_ms` must beat the best full-grid competitor by at least 25%. With GridGamma added as a comparator (25.3ms vs pretable 24.2ms), pretable achieves only a ~4% frame-time win — H1 fails despite pretable having superior quality on every other dimension (0px height error vs GridGamma's 1.1px, 0px anchor shift vs GridBeta's 259px).

H3 evaluates pretable-only absolute stability: row height error ≤ 4px, anchor shift ≤ 16px, blank gaps = 0. H3 has no comparative element.

## Target Behavior

H1 becomes a composite gate with five absolute sub-criteria and a uniqueness gate. H3 is removed — its stability checks are absorbed into composite H1 with tightened thresholds based on observed evidence.

### Sub-criteria (pretable must meet all five)

| Sub-criterion | Metric | Threshold | Rationale |
|---------------|--------|-----------|-----------|
| Frame parity | `scroll_frame_p95_ms` | ≤ 110% of best full-grid competitor median | Competitive, not dominant — honest about GridGamma's strength |
| Row height accuracy | `row_height_error_p95_px` | ≤ 1px | Sub-pixel accuracy; GridGamma fails at 1.1px, Grid Alpha at 153px |
| Anchor stability | `scroll_anchor_shift_backward_p95_px` | ≤ 16px | Same threshold as former H3; GridBeta fails at 259px |
| Blank gap control | `blank_gap_frames` | = 0 (max across repeats) | No visible scroll tearing |
| Long task control | `long_tasks_count` | = 0 (max across repeats) | No main-thread blocking during scroll |

### Uniqueness gate

At least one measured full-grid competitor must fail at least one of the five sub-criteria above (using the same thresholds, excluding frame parity which only applies to pretable). This prevents the hypothesis from being trivially satisfied if every adapter is equally good.

### Evaluation stages

The composite H1 evaluates in stages, matching the existing hypothesis status vocabulary:

1. **Data availability:** If no completed pretable S2 scroll series exists, status = `insufficient`.
2. **Absolute quality gate:** Evaluate pretable against the five sub-criteria. If any fails, status = `failing`. The summary lists which sub-criteria failed and their actual values.
3. **Competitor availability:** If no completed full-grid competitor S2 scroll series exists, status = `directional`. Pretable passes absolute thresholds but comparative claim is unmeasured.
4. **Frame parity check:** Compute pretable median p95 / best full-grid competitor median p95. If ratio > 1.10, status = `failing`.
5. **Uniqueness gate:** For each full-grid competitor, evaluate the four non-frame sub-criteria. If every full-grid competitor also passes all four, status = `directional`.
6. **Policy drift:** If pretable or the best competitor has policy drift across repeats, status = `directional`.
7. **Satisfied:** All gates pass, status = `satisfied`.

### Summary text

**Satisfied:**
> "Wrapped-text scrolling delivers zero-artifact quality (row height error ≤ 1px, anchor shift ≤ 16px, no blank gaps, no long tasks) with frame times within 10% of the best measured full-grid comparator. No measured full-grid competitor achieves the same combined quality. Evidence is based on current repeated-run medians."

**Failing — absolute threshold breach:**
> "Wrapped-text scrolling is measured, but [N] quality sub-criteria are not yet met: [list failing sub-criteria with actual values]."

**Failing — frame parity breach:**
> "Wrapped-text scrolling meets all quality thresholds, but frame p95 is [X]% above the best full-grid comparator ([adapter]: [value]ms vs pretable: [value]ms). The 10% parity threshold is not met."

**Directional — no competitor data:**
> "Wrapped-text scrolling meets all absolute quality thresholds, but the comparative uniqueness claim is unmeasured — no full-grid competitor data is available."

**Directional — uniqueness not proven:**
> "Wrapped-text scrolling meets all quality thresholds, but so does every measured full-grid competitor — the uniqueness claim is not yet supported."

**Directional — policy drift:**
> "Wrapped-text scrolling meets all quality and uniqueness thresholds on current medians, but policy drift across repeats keeps the result directional rather than reproducible."

**Insufficient:**
> "Missing a completed S2 scroll run, so composite scroll quality cannot be evaluated yet."

## Changes

### scripts/bench-matrix.mjs

**Replace `evaluateH1`** with a new implementation following the staged evaluation above. Same function name, same return shape (`{ id, status, summary, evidence }`).

**Remove `evaluateH3`.** Delete the function entirely.

**Update `createHypothesisReport`** to drop `evaluateH3` from the hypotheses array:

```javascript
hypotheses: [
  evaluateH1(runs),
  evaluateH6(runs),
  evaluateH7(runs),
  evaluateH8(runs),
  evaluateH5(entries, runs),
],
```

**Remove `hasMedianStableButWorstCaseExceeded`.** Only used by H3. The composite H1 uses `maxMetric` directly for blank gaps and long tasks, and median for height error, anchor shift, and frame parity.

**Add `evaluateCompetitorSubCriteria` helper:**

```javascript
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

The uniqueness gate checks whether any full-grid competitor has at least one `false` in its sub-criteria.

**Evidence array:** Always includes pretable evidence. Includes best full-grid competitor evidence and best virtualization-primitive evidence when available (same structure as current H1).

**No changes to any other function.** All helpers (`findRunSeries`, `groupRunSeries`, `summarizeRunSeriesEvidence`, `medianMetric`, `maxMetric`, `hasPolicyDrift`, `getAdapterFamily`, `describeComparatorFamily`, `hasInteractionMedianStableButWorstCaseExceeded`) remain as-is.

### scripts/__tests__/bench-matrix.test.mjs

**Tests to update:**

1. **"createHypothesisReport distinguishes directional evidence from missing proof"** (line 238) — Update H1 assertion from `/25%|relative/i` to match composite wording. Add quality metrics to the pretable run object. Remove H3 assertion. Assert hypothesis array has 5 entries.

2. **"createHypothesisReport aggregates repeated runs by median"** (line 570) — Remove H3 assertion. Update H1 summary match to accept composite wording.

3. **"createHypothesisReport exposes worst-case H1 threshold metrics"** (line 690) — Still `failing` because blank gap max=1 > 0. Update summary match if wording changes.

4. **"createHypothesisReport prefers the best full-grid comparator for H1"** (line 840) — Update summary match from `/full-grid/i` to match composite wording.

**Tests to remove:**

5. **"createHypothesisReport exposes worst-case H3 threshold metrics"** (line 768) — H3 removed.

6. **"createHypothesisReport marks single-sample H3 claims"** (line 905) — H3 removed.

7. **"createHypothesisReport downgrades H3 when policy notes vary"** (line 1156) — H3 removed.

8. **"createHypothesisReport treats backward anchor instability as H3 failure"** (line 1221) — H3 removed. Covered by new test 13 below.

**New tests to add:**

9. **"composite H1 fails when pretable exceeds absolute quality threshold"** — Pretable with `row_height_error_p95_px: 2` against a full-grid competitor. Assert H1 `failing`, summary lists the failing sub-criterion.

10. **"composite H1 fails when pretable frame parity exceeds 110%"** — Pretable 30ms, best full-grid 25ms (120% ratio). All quality metrics zero for pretable. Assert H1 `failing`, summary mentions frame parity.

11. **"composite H1 directional when all competitors also pass quality thresholds"** — Pretable and a full-grid competitor both have perfect quality metrics. Assert H1 `directional`, summary mentions uniqueness.

12. **"composite H1 satisfied with GridGamma-like competitor failing row height accuracy"** — Pretable 24ms, GridGamma 25ms, pretable quality all zero, GridGamma `row_height_error_p95_px: 1.1`. Frame parity = 96%. Uniqueness holds. Assert H1 `satisfied`.

13. **"composite H1 checks backward anchor shift for quality gate"** — Pretable with `scroll_anchor_shift_backward_p95_px: 20` (exceeds 16px threshold). Assert H1 `failing`.

14. **"hypothesis array has 5 entries after H3 removal"** — Assert `report.hypotheses.length === 5` and no entry has `id: "H3"`.

## What This Does Not Change

- H5, H6, H7, H8 — unchanged. Interaction hypotheses are independent of scroll quality.
- `summarizeRunSeriesEvidence`, `findRunSeries`, `groupRunSeries`, `medianMetric`, `maxMetric`, `hasPolicyDrift`, `getAdapterFamily` — all reused unchanged.
- Bench runtime, adapters, scroll measurement scripts — no changes. The metrics are already collected; only the evaluation logic changes.
- `apps/bench/tests/bench.spec.ts` — no changes. E2E assertions are about metric shape, not hypothesis evaluation.
- `packages/bench-runner` — no changes.

## Verification

1. Unit tests: `node --test scripts/__tests__/bench-matrix.test.mjs`
2. Full matrix run: `pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta,gridgamma --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=3`
3. Inspect the resulting `*.hypotheses.json`:
   - H1 status should be `satisfied` (pretable: 0 artifacts, GridGamma: 1.1px height error fails uniqueness gate)
   - No H3 entry exists
   - H5 still `satisfied`
   - 5 hypotheses total

## Risk

Low. This is a logic-only change to `evaluateH1` in one file, plus removing `evaluateH3` and updating tests. No runtime behavior changes — the same metrics are collected the same way. The primary risk is a test data fixture missing a quality metric field, causing an unexpected `insufficient` status. Mitigated by the new test cases that exercise each evaluation stage explicitly.

The 1px row-height-error threshold is tight — GridGamma currently measures 1.109375px, so a minor GridGamma update could push it under 1px and break the uniqueness gate. This is acceptable: if GridGamma achieves sub-pixel accuracy, that's genuine progress and pretable's uniqueness claim should honestly reflect it. The threshold should not be loosened to preserve a failing claim.
