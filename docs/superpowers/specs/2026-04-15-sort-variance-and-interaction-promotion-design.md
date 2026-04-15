# Sort Variance And Interaction Promotion Design

Date: 2026-04-15

## Summary

Pretable now has a credible local interaction proof surface on Chromium `S2/dev`, but it is not yet uniformly trustworthy. The latest repeated runset at [status/runsets/2026-04-15t06-03-15-343z.hypotheses.json](/Users/blove/repos/pretable/status/runsets/2026-04-15t06-03-15-343z.hypotheses.json) satisfies `H7` and `H8`, while `H6` remains failing because one sort repeat spikes to `74.6ms` interaction latency even though current medians stay within threshold.

The next phase should treat that outlier as a real product/runtime problem to eliminate, not a threshold problem to redefine away. The work should begin with direct profiling of the shared Pretable sort path, fix the dominant source of repeat spread in shared code, rerun repeated Chromium `S2/dev` interaction proof, and only then promote the full interaction family (`sort`, `filter-metadata`, `filter-text`) to `hypothesis` scale together.

This phase is explicitly Chromium-only first. Broader browser coverage comes after Chromium interaction proof is both honest and stable.

## Problem

The benchmark lab is now honest enough to expose the next real weakness.

What is already true:

- `H1` and `H3` remain satisfied on the current wrapped-text scroll slice.
- `H7` and `H8` are satisfied on repeated Chromium `S2/dev` interaction runs.
- The benchmark and playground now share a materially tighter React/renderer path.

What is still unresolved:

- `H6` is failing on worst-case repeat latency, not on median behavior.
- The current interaction family is therefore stronger than before, but still not clean enough to promote as broad interaction proof.
- Until sort variance is understood and reduced, a larger `hypothesis`-scale interaction pass will be noisy and easy to misread.

The important constraint is conceptual, not just mechanical: we should fix the real cause in shared code if the variance is real renderer/state behavior. It is not acceptable to “fix” this by only narrowing the benchmark harness or relaxing thresholds.

## Goals

- Eliminate the dominant source of repeated-run sort variance on the shared Pretable path.
- Keep the benchmarked path and the prototype path aligned while doing so.
- Preserve the current honest interaction metrics and repeated-run evidence model.
- Re-establish `H6` as satisfied on repeated Chromium `S2/dev` runs without weakening the claim.
- Promote all three current interaction scenarios together to Chromium `S2/hypothesis` only after `H6`/`H7`/`H8` are all green on repeated `dev`.

## Non-Goals

- Adding another browser before Chromium interaction proof is stable.
- Relaxing `H6` thresholds simply to make the current runset pass.
- Reworking the hypothesis framework beyond changes needed to support honest variance analysis or promotion.
- Adding new interaction scenario classes before the current three are stable enough to promote.
- Treating benchmark-only optimizations as acceptable if they do not land in shared code when the variance source is shared.

## Recommended Approach

Use the benchmark harness as the reproduction surface, but profile the shared Pretable sort path end to end.

The sequence should be:

1. Reproduce repeated `S2/dev/sort` variance on Chromium.
2. Profile the shared Pretable path directly:
   - grid state mutation
   - render snapshot recomputation
   - row-height measurement churn
   - React surface rerender behavior
3. Fix the dominant shared-path spike source.
4. Rerun repeated `S2/dev` interaction proof for:
   - `sort`
   - `filter-metadata`
   - `filter-text`
5. If `H6`, `H7`, and `H8` are all satisfied, run the larger Chromium-only `S2/hypothesis` interaction promotion pass for all three together.
6. Update README and repo memory to the new honest checkpoint.

Why this approach:

- It addresses the actual failure mode instead of papering over it.
- It keeps the benchmark and product stories aligned.
- It prevents a promotion pass from being wasted on a known-unstable slice.

Rejected alternatives:

- Instrumentation-first without profiling: useful later, but slower to the real cause when the outlier is already concrete.
- Threshold-first relaxation: fastest path to green, but directly contradicts the goal of eliminating the outlier.
- Browser-expansion-first: wrong order while Chromium interaction proof is still unstable.

## Working Assumption

The `74.6ms` sort outlier is more likely to come from repeat-spread in shared state/render work than from a purely harness-local issue.

That assumption is justified by the current architecture:

- the Pretable benchmark path now runs on the same internal surface and telemetry chain used by the prototype path
- recent interaction fixes already surfaced real shared-path issues such as input recreation and post-mutation anchor accounting
- sort does not fail on semantics; it fails on one bad repeat

This assumption should still be tested rather than trusted. If profiling shows the outlier is dominated by benchmark-only behavior, the fix may remain benchmark-local. But that should be proven, not assumed.

## Profiling Scope

The first pass should profile the shared sort path directly, not only the harness wrapper.

Priority areas:

### Grid State Mutation

Inspect whether the sort action causes avoidable repeated state transitions, duplicate sort application, or redundant row-model rebuilds.

Questions to answer:

- Does one sort trigger more than one meaningful state mutation?
- Are focus and selection updates causing extra churn after the row reorder?
- Is any state being cleared and then restored within one interaction sequence?

### Render Snapshot Recalculation

Inspect whether sort causes more render-planning work than necessary.

Questions to answer:

- Is the DOM render snapshot being recomputed more times than expected?
- Are sorted but unchanged row heights forcing a full expensive recomputation path?
- Are cached estimates or snapshot inputs being invalidated too broadly?

### Measurement And Row-Height Churn

Inspect whether sorting is causing avoidable measured-height or correction churn.

Questions to answer:

- Does sort force rows to be remeasured even when their content and width are unchanged?
- Are measured heights being thrown away and rebuilt unnecessarily?
- Does measurement feed back into visible-row churn across repeated runs?

### React Surface Rerender Behavior

Inspect whether React rerender spread is widening repeat latency.

Questions to answer:

- Are internal callback props or derived collections changing identity unnecessarily?
- Are internal telemetry, selection, or sorting callbacks causing repeated expensive rerenders?
- Does the shared surface stabilize consistently after one reorder, or does it briefly oscillate?

## Fix Criteria

A sort-variance fix is acceptable only if it satisfies all of the following:

- it reduces repeat spread on repeated Chromium `S2/dev/sort`
- it does not introduce a benchmark-only divergence when the source is in shared code
- it preserves the current DOM contract and interaction metrics
- it does not regress `filter-metadata` or `filter-text`
- it does not silently weaken the claim by redefining the measured event

If the first fix improves medians but leaves the worst-case repeat above threshold, the work is not done.

## Verification Plan

Verification should be staged and honest.

### After Profiling Fixes

Run focused proof first:

- targeted unit tests for the identified cause
- targeted app-level tests for the affected benchmark or React surface seam
- a one-script repeated run for `S2/dev/sort`

### After Sort Stabilizes

Run the repeated local interaction proof family:

- `pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --repeats=3`

Only if all three are satisfied should the promotion pass happen.

### Promotion Pass

Run Chromium-only larger-scale proof for all three together:

- `S2/hypothesis/sort`
- `S2/hypothesis/filter-metadata`
- `S2/hypothesis/filter-text`

The promotion pass should stay bundled because the interaction family now represents one coherent product-relevant proof surface.

## Risks

- Overfitting to one observed sort outlier and missing the broader variance source.
- Fixing a benchmark symptom instead of the shared product/runtime cause.
- Reducing variance on `sort` while regressing `filter-metadata` or `filter-text`.
- Treating median-only improvement as success when worst-case repeats still violate the claim.
- Running the larger promotion pass before the `dev` slice is clean and thereby muddying the next checkpoint.

## Success Criteria

This phase is successful if:

- repeated Chromium `S2/dev/sort` no longer violates `H6` on worst-case repeat latency
- `H6`, `H7`, and `H8` are all satisfied together on repeated Chromium `S2/dev`
- the sort variance fix lands in shared code when the cause is shared
- the subsequent Chromium `S2/hypothesis` interaction promotion pass produces a cleaner, more defensible checkpoint than the current one
- repo memory and README reflect the result honestly, including any remaining gaps

## Future Work Suggestions

If this phase succeeds, the next high-value follow-ons are:

- add a small timing-breakdown artifact only if sort variance remains hard to attribute after the first profiling pass
- rerun a fresh `S2/scroll` smoke after sort stabilization to ensure no shared-path optimization regresses the original wedge
- extend the same interaction-proof discipline to a denser pinned-column inspection scenario once the current `S2` interaction family is stable at `hypothesis` scale
- only after Chromium proof is stable, consider a second browser as a validation step rather than as an active debugging surface
