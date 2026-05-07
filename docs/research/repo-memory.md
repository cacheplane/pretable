# Repo Memory

## 2026-04-12

### Prototype direction

- The immediate goal is two-track:
  - prove the technical wedge in benchmarks
  - start building the initial demo in the playground
- The intended path after the first prototype is to iterate toward engine feature completeness for an MVP.

### Product priorities

- Performance and stability are the primary constraints.
- Visible product behavior such as pinned columns, selection, and keyboarding should be built on top of those principles rather than pursued ahead of them.

### Recommendation adopted for the first prototype cut

- Defer off-screen autosize as a primary proving target for the first prototype cut.
- Focus first on:
  - wrapped text
  - variable-height scrolling stability
- Reason:
  - this is the clearest wedge
  - it is the best foundation for later product behavior
  - it reduces the risk of proving too many hypotheses at once before the core engine exists

### First demo shape

- Start with a read-heavy log / inspection table first.
- Long term, expand that into a more generic grid sandbox after the wedge is proven.

### First serious interaction cut

- Include these behaviors in the first serious cut:
  - scrolling
  - pinned columns
  - row selection
  - keyboard navigation
  - local sorting
  - local filtering

### Core architecture direction

- Design the core from day one so remote / server-driven sorting, filtering, and streaming can slot in cleanly.
- The first serious cut may still implement local in-memory behavior first, but the core boundaries should not assume local-only data flow.

### Interaction-state boundary

- Selection and keyboard focus should live inside the core state machine from the start.
- The React adapter should not own the canonical interaction model.

### Renderer strategy

- Start DOM-first.
- Keep an explicit hybrid-renderer escape hatch in the architecture, but do not make hybrid rendering the first implementation target.

### Text-engine strategy

- Start with an estimate-first text engine plus a strict DOM-truth harness.
- Do not require exact DOM-parity measurement in the hot path up front.

### Filtering scope

- Start with limited filtering in the first serious cut.
- Prefer column-level text / value filters before introducing a more expressive query model in the core.

### Streaming updates

- Defer streaming updates as an implemented feature in the first serious cut.
- Still design the architecture so streaming can slot in cleanly later.
- Product positioning should preserve the long-term direction toward AI-capable streaming data rendering, but early prototype claims should stay qualified and honest.

### Data model

- Keep the first prototype schema-agnostic.
- Use a log / inspection-table shape as the first demo dataset and benchmark-facing use case, but do not bake a canonical log schema into the core model.

## 2026-04-13

### Shared inspection prototype path

- The playground now runs on shared deterministic inspection datasets with `tiny`, `dev`, and `stress` scales.
- The playground defaults to `dev` so local manual inspection happens on a materially sized dataset instead of a smoke-only sample.
- Inspection-grid-specific renderer composition now lives under `@pretable/react/internal` instead of inside the playground surface.

### Internal telemetry direction

- Shared React telemetry is now computed once in `usePretableModel` and relayed through the internal surface chain.
- Current telemetry fields are:
  - `selectedRowId`
  - `renderedRowCount`
  - `visibleRowCount`
  - `totalHeight`
  - `visibleRowRange`
- The playground diagnostics block should consume this telemetry directly instead of scraping the grid DOM.

### Benchmark alignment

- The Pretable benchmark path now records the same internal telemetry as summary notes without changing the existing benchmark DOM contract.
- The benchmark guardrail remains:
  - keep telemetry off-DOM
  - preserve `data-pretable-scroll-viewport`
  - preserve `data-pretable-scroll-content`
  - preserve row/cell markers and viewport policy

### Current honest status

- A focused Chromium Pretable `S2/dev/scroll` run on 2026-04-14 wrote telemetry-bearing notes into [status/chromium-pretable-default-s2-dev-scroll-2026-04-14t04-13-15-339z.summary.json](../../status/chromium-pretable-default-s2-dev-scroll-2026-04-14t04-13-15-339z.summary.json).
- That artifact is useful because it proves the tighter benchmark/playground telemetry link is real.
- A repeated Chromium matrix run on 2026-04-14 wrote [status/runsets/2026-04-14t04-14-56-534z.hypotheses.json](../../status/runsets/2026-04-14t04-14-56-534z.hypotheses.json).
- That runset is the more important checkpoint and it is also not flattering:
  - `H1`: failing
  - `H3`: failing
  - Pretable median `scroll_frame_p95_ms: 41.7`
  - Pretable median `blank_gap_frames: 1`
  - Grid Alpha median `scroll_frame_p95_ms: 33.1`
  - GridBeta median `scroll_frame_p95_ms: 24.6`
- Conclusion: the prototype path is more honest and more inspectable, but the current Pretable scroll result is measurably behind the current comparators on the repeated `S2/dev/scroll` slice.

## 2026-04-14

### Scroll proof recovery

- The benchmarked Pretable scroll path recovered after flattening benchmark-only chrome, scoping row-height reads to wrapped cells, caching row-height estimates in the renderer, and tightening benchmark overscan.
- Repeated Chromium `S2/dev/scroll` evidence in [status/runsets/2026-04-14t20-16-32-016z.hypotheses.json](../../status/runsets/2026-04-14t20-16-32-016z.hypotheses.json) satisfies both `H1` and `H3`.
- Repeated Chromium `S2/hypothesis/scroll` evidence in [status/runsets/2026-04-14t20-20-01-263z.hypotheses.json](../../status/runsets/2026-04-14t20-20-01-263z.hypotheses.json) also satisfies both `H1` and `H3`.

### Interaction proof expansion

- The benchmark lab now has explicit local interaction scenarios for:
  - `S2/sort`
  - `S2/filter-metadata`
  - `S2/filter-text`
- The matrix now evaluates:
  - `H6` for sort
  - `H7` for metadata filtering
  - `H8` for wrapped-text primary-column filtering
- Repeated Chromium `S2/dev` interaction evidence in [status/runsets/2026-04-15t04-18-07-253z.hypotheses.json](../../status/runsets/2026-04-15t04-18-07-253z.hypotheses.json) is mixed but useful:
  - `H6`: satisfied
  - `H7`: satisfied
  - `H8`: failing
  - `H8` is failing because text filtering still produces large post-filter anchor shifts even when latency and blank-gap metrics stay controlled
- Repeated Chromium `S2/hypothesis` interaction evidence in [status/runsets/2026-04-15t04-19-10-257z.hypotheses.json](../../status/runsets/2026-04-15t04-19-10-257z.hypotheses.json) is stricter and currently not flattering:
  - `H6`: failing
  - `H7`: failing
  - `H8`: not run in that promotion pass
- Current conclusion:
  - Pretable now has broader proof than passive scroll alone
  - the next highest-value technical gap is interaction stability and threshold discipline at larger scale, especially wrapped-text filter anchor behavior

## 2026-04-15

### Interaction proof recovery

- The local interaction path is materially stronger after two real fixes:
  - the Pretable bench adapter no longer recreates `rows` and `columns` on telemetry-driven rerenders, which had been resetting the grid during `filter-text`
  - post-interaction anchor metrics now reset their baseline on the first changed frame, so they measure instability after the mutation instead of counting the mutation itself as drift
- Repeated Chromium `S2/dev` interaction evidence in [status/runsets/2026-04-15t06-03-15-343z.hypotheses.json](../../status/runsets/2026-04-15t06-03-15-343z.hypotheses.json) is stronger than the earlier failing checkpoint, but still mixed:
  - `H6`: failing on worst-case repeat latency even though medians are within threshold
  - `H7`: satisfied
  - `H8`: satisfied
- Current conclusion:
  - Pretable now has repeated-run `dev` proof for wrapped-text metadata filtering and wrapped-text primary-column filtering on top of the earlier `S2` scroll proof
  - local sort is instrumented and directionally favorable, but it still needs variance reduction before it is an honest repeated-run proof claim
  - the next honest gaps are sort variance analysis and then promotion: rerun the interaction slice at larger `hypothesis` scale before claiming broad interaction superiority

## 2026-04-16

### Sort variance reduction

- The dominant shared-path hotspot behind the earlier `H6` outlier was row-height measurement churn in the React surface during pure sort reorder.
- The fix stayed in shared code under `packages/react/src/internal/pretable-surface.tsx`.
- The final shape is:
  - skip remeasurement for a reordered row only when the cached measured height is already applied and the wrapped-content measurement key is unchanged
  - evict the cached measured height when the same row id later shrinks back to default-height content under a changed measurement key
- The shared seam now has focused regressions for:
  - no remeasurement on pure sort reorder of unchanged tall wrapped rows
  - remeasurement when the same row id grows
  - eviction of stale tall cache when the same row id shrinks

### Current interaction checkpoint

- Repeated Chromium `S2/dev` interaction evidence in [status/runsets/2026-04-16t00-16-36-271z.hypotheses.json](../../status/runsets/2026-04-16t00-16-36-271z.hypotheses.json) is now clean:
  - `H6`: satisfied
  - `H7`: satisfied
  - `H8`: satisfied
- Repeated Chromium `S2/hypothesis` interaction evidence in [status/runsets/2026-04-16t00-17-20-982z.hypotheses.json](../../status/runsets/2026-04-16t00-17-20-982z.hypotheses.json) is still mixed:
  - `H6`: failing
  - `H7`: failing
  - `H8`: satisfied
- The current larger-scale failures are latency failures, not stability failures:
  - `H6` median interaction latency is about `66.7ms`
  - `H7` median interaction latency is about `66.7ms`
  - blank gaps, anchor shift, and row-height error remain controlled

### Next honest gap

- The next highest-value work is not more hypothesis plumbing.
- It is reducing larger-scale interaction latency for:
  - local sort
  - metadata filtering
- `filter-text` is currently the only interaction scenario that survives the larger `hypothesis` promotion pass on the latest rerun.

## 2026-04-20

### Pinned-column inspection scenario (S7)

- Added S7 ("pinned-inspection"): 40 cols, 3 pinned left, 3 wrapped, variable-height, multilingual corpus, same row counts as S2.
- H9-H12 hypotheses mirror H1/H6-H8 for the S7 scenario.
- Existing evaluate functions refactored to accept explicit `scenarioId` parameter; H9-H12 are thin wrappers.
- All four adapters (pretable, Grid Alpha, GridBeta, GridGamma) already support S7 through the existing `column.pinned` dataset interface.
- Default bench matrix scenarios expanded from `["S1", "S2"]` to `["S1", "S2", "S7"]`.

### Interaction proof promotion to hypothesis scale

- The sort variance spike (~74.6ms on `H6`) that originally motivated the fix-then-expand roadmap is gone.
- Fresh repeated Chromium `S2/dev` interaction runset at `status/runsets/2026-04-20t23-47-00-725z.hypotheses.json` satisfies `H6`, `H7`, `H8` with max latency under 9ms.
- Fresh repeated Chromium `S2/hypothesis` interaction runset at `status/runsets/2026-04-20t23-47-43-474z.hypotheses.json` also satisfies `H6`, `H7`, `H8` with max latency under 9ms.
- The earlier ~66.7ms hypothesis-scale failures are resolved without targeted sort-path intervention — the accumulated shared-path fixes from the 2026-04-15/2026-04-16 work (input recreation fix, post-mutation anchor accounting, row-height measurement churn reduction) appear to have eliminated the variance source.
- Fresh repeated Chromium `S2/hypothesis/scroll` comparative runset at `status/runsets/2026-04-20t23-48-22-840z.hypotheses.json` satisfies `H1` — no scroll regression from the interaction work.

### Current honest checkpoint

- Scroll: `H1` satisfied at `S2/hypothesis` scale on Chromium.
- Interaction: `H6`, `H7`, `H8` all satisfied at `S2/hypothesis` scale on Chromium.
- The full `S2` proof surface (scroll + sort + filter-metadata + filter-text) is now clean at hypothesis scale.
- Roadmap projects 1-4 are complete. The next highest-value work is Project 5 (Public API Stabilization) or the S3-S6 engine feature brainstorm.

## 2026-05-07

### Tier 1 Bench Slab 1: selection/nav + cell-renderer hypotheses (H16-H21)

- Combined sub-project (B Phase 7 selection/nav + D3 cell-renderer bench validation) shipped as a single PR on `bench-slab1`.
- Spec: `docs/superpowers/specs/2026-05-07-tier1-bench-slab1-design.md`. Plan: `docs/superpowers/plans/2026-05-07-tier1-bench-slab1.md`.
- Six new BenchScriptName values: `select-range-extend`, `keyboard-nav-row`, `select-all`, `scroll-with-format`, `scroll-with-render`, `scroll-with-heavy-render`. All pretable+S2 only at Slab 1 — comparator adapters reject these scripts in `validateSupportedP0aRequest`.
- New `measureBenchKeySequenceRun` helper drives the keyboard-driven scripts via the ARIA-grid `tabindex="0"` cell, captures per-event latency, reports p95 as `interaction_latency_ms`.
- New `applyCellRendererFlavor` in `apps/bench/src/pretable-adapter.tsx` injects a shared `format`/`render` reference per flavor (NOT a per-column closure — see perf finding below).
- Hypotheses H16-H21 added to `scripts/bench-matrix.mjs`. H19 compares `scroll-with-format` to the same-runset `scroll` baseline.

### Two perf wins surfaced by the Slab 1 hypotheses

- **selectedCellKeys Set elimination (H18).** Cmd+A on 3000 rows × 9 cols was materializing a 27,000-entry Set on every selection-change frame, dominating select-all latency. Replaced the precomputed Set with an `isCellSelected(rowId, columnId)` callback that scans the typically ≤3 ranges per visible cell. `fullySelectedRowIds` / `indeterminateRowIds` now track row coverage with a 32-bit bitmask per row (Set fallback for >30 data columns). Select-all p95: **38.4ms → 9.7ms** (under single-frame budget).
- **Hoisted bench cell-render functions (H19).** `columns.map((column) => ({ ...column, format: ({value}) => ... }))` was allocating a fresh `format` closure per column. With 9 columns, the per-cell call site saw 9 different function references — megamorphic, no inlining. Hoisted `sharedFormat` / `sharedCheapRender` / `sharedHeavyRender` to module scope so V8's call-site IC goes monomorphic. Format overhead vs scroll baseline: **+7.30ms → +0.10ms**.

### Final hypothesis status (S2/hypothesis/Chromium, 3 repeats)

- H16 selection extend p95: 9.4ms ≤ 16ms ✓
- H17 keyboard nav p95: 9.3ms ≤ 16ms ✓
- H18 select-all latency: 9.7ms ≤ 33ms ✓
- H19 format overhead: 0.10ms ≤ 2ms ✓
- H20 cheap render scroll p95: 9.3ms ≤ 16ms ✓
- H21 heavy render scroll p95: 9.3ms ≤ 20ms ✓
- H1 (existing scroll wedge) directional, no regression on the same runset.
- Committed milestone artifact: `status/milestones/2026-05-07-bench-slab1-selection-nav-cell-renderers.hypotheses.json`.
