# S2 Interaction Proof Design

Date: 2026-04-14

## Summary

Pretable now has a credible wrapped-text scroll win on `S2/scroll`. The next proof phase should broaden that evidence along the product-relevant axis: interaction-driven row-model mutation under wrapped, variable-height content. This slice adds explicit local interaction scenarios for sort and filter inside the existing `S2` workload family and evaluates them with named hypotheses from the start.

The new scenarios should stay in-memory first, share the same Pretable renderer and core path used by the current `S2` proof, and measure both immediate interaction cost and post-settle stability. The three scenarios are:

- `S2/sort`
- `S2/filter-metadata`
- `S2/filter-text`

Each scenario should emit named hypothesis output and repeated-run evidence, not exploratory-only measurements.

## Problem

Current proof is strong but narrow.

What is proven now:

- Pretable can win `S2/scroll` against the best measured full-grid comparator while preserving blank-gap and anchor stability.
- The renderer/core stack is now credible enough to build on.

What is not yet proven:

- whether Pretable stays fast and stable when the row model changes instead of merely scrolling
- whether row identity, focus, and selection remain coherent through sort/filter transitions
- whether wrapped-text variable-height planning stays stable after reorder and row-set shrink operations

That gap matters because the first serious product path is an inspection-style table, not a passive scroller.

## Goals

- Broaden proof inside the existing `S2` workload family with interaction-driven scenarios.
- Add named hypotheses for local sort and filter behavior from the start.
- Measure both immediate interaction latency and post-settle stability.
- Preserve comparator parity by driving semantically equivalent local interactions for Pretable and comparators.
- Keep the benchmark path aligned with the actual shared Pretable renderer path.

## Non-Goals

- Introducing remote or streaming interaction scenarios in this slice.
- Expanding browser or environment coverage before the interaction scenarios are credible.
- Inventing a new workload family outside `S2`.
- Reworking the benchmark matrix framework beyond what is needed for the new interaction hypotheses.

## Recommended Approach

Extend the current `S2` scenario family with three explicit interaction scripts and evaluate them with three new named hypotheses:

- `H6`: local wrapped-text sort latency and post-sort stability
- `H7`: local metadata filter latency, row-set reduction, and post-filter stability
- `H8`: local wrapped-text primary-column filter latency and post-filter stability

Why this approach:

- It stays close to the product wedge and current benchmark surface.
- It keeps the workload family constant and varies only the interaction.
- It lets the current benchmark harness, telemetry discipline, and repeated-run evidence model do more useful work instead of inventing a new lab.

Rejected alternatives:

- More browsers first: weaker than scenario breadth at this stage.
- A new denser pinned-column workload first: useful later, but it still leaves interaction proof unaddressed.
- Exploratory-only interaction metrics: too weak now that the repo already supports named honest hypotheses.

## Scenario Design

### `S2/sort`

This scenario starts from the existing wrapped-text `S2` inspection dataset and applies a deterministic local sort on a meaningful column. It should measure:

- the interaction latency from sort action to first stable post-sort state
- the settle duration after the action
- post-sort blank gaps
- post-sort anchor shift
- post-sort row-height error
- whether focused and selected row ids are preserved correctly across reorder

The chosen sort column should produce a meaningful reorder, not a near-no-op.

### `S2/filter-metadata`

This scenario applies a deterministic metadata/status-style filter that materially reduces the visible row set while minimizing text-matching noise. It should measure:

- interaction latency
- settle duration
- post-filter blank gaps
- post-filter anchor shift
- post-filter row-height error
- resulting row count
- whether focused and selected row ids are preserved when still present

The predicate should be documented and should materially change the result set at every supported dataset scale.

### `S2/filter-text`

This scenario applies a deterministic wrapped-text primary-column filter. It is intentionally heavier than the metadata filter because it combines text matching with row-set mutation under wrapped content. It should measure the same core metrics as `filter-metadata`, but should use a stricter narrative in reporting because text filtering is likely the most volatile of the new scenarios.

## Hypotheses

Add three new named hypotheses.

### `H6`

Claim: wrapped-text local sorting remains within an explicit interaction latency threshold while preserving post-sort blank-gap, anchor, and row-height stability.

Evidence requirements:

- repeated-run median interaction latency
- repeated-run median settle duration
- post-sort `blank_gap_frames`
- post-sort `scroll_anchor_shift_px`
- post-sort `row_height_error_p95_px`
- `selected_row_preserved`
- `focused_row_preserved`

### `H7`

Claim: metadata filtering materially reduces the row set while preserving post-filter stability and keeping interaction latency within a bounded threshold.

Evidence requirements:

- repeated-run median interaction latency
- repeated-run median settle duration
- post-filter `blank_gap_frames`
- post-filter `scroll_anchor_shift_px`
- post-filter `row_height_error_p95_px`
- `result_row_count`
- `selected_row_preserved`
- `focused_row_preserved`

### `H8`

Claim: wrapped-text primary-column filtering remains within an explicit latency threshold while preserving post-filter stability under heavier text work.

Evidence requirements:

- repeated-run median interaction latency
- repeated-run median settle duration
- post-filter `blank_gap_frames`
- post-filter `scroll_anchor_shift_px`
- post-filter `row_height_error_p95_px`
- `result_row_count`
- `selected_row_preserved`
- `focused_row_preserved`

## Metrics

The interaction scenarios should keep the existing stability metrics and add interaction-specific metrics:

- `interaction_latency_ms`
- `settle_duration_ms`
- `post_interaction_blank_gap_frames`
- `post_interaction_anchor_shift_px`
- `post_interaction_row_height_error_p95_px`
- `result_row_count`
- `selected_row_preserved`
- `focused_row_preserved`

These should appear in the same honest evidence structure as the current hypotheses:

- `sampleCount`
- `metricSummary` with `min`, `median`, and `max`
- `policyNotes`
- repeated-run vs current-sample wording
- volatility-aware summary text when spread weakens confidence

## Comparator Requirements

Comparator paths must execute semantically equivalent local actions:

- the same sort column and direction
- the same metadata filter predicate
- the same wrapped-text filter token or phrase

Comparator instrumentation must capture the same immediate and post-settle metrics. If a comparator cannot support one of the required actions equivalently, that gap should be explicit in the report and the hypothesis should degrade honestly rather than silently claiming parity.

## Execution Order

Recommended sequence:

1. Add `S2/sort` and `H6`
2. Add `S2/filter-metadata` and `H7`
3. Add `S2/filter-text` and `H8`
4. Run repeated `dev`-scale matrix for the new scenarios
5. Promote the strongest interaction scenarios to `hypothesis` scale
6. Update README and repo memory with the new checkpoint

## Risks

- Measuring only the interaction trigger and missing post-settle instability.
- Using predicates that do not materially change the row set.
- Benchmarking a path that diverges from the shared Pretable renderer path.
- Comparator actions becoming only approximately equivalent.
- Promoting weak exploratory data into overclaimed named hypotheses.

## Success Criteria

This slice is successful if:

- Pretable has named, repeated-run interaction evidence beyond passive scroll.
- `S2/sort`, `S2/filter-metadata`, and `S2/filter-text` all produce stable, reproducible artifacts.
- `H6`, `H7`, and `H8` honestly report confidence, volatility, and comparator context.
- The benchmark evidence broadens the product thesis rather than just repeating the same scroll story.
