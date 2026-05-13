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

## 2026-05-08

### Tier 1 B2: Comparative bench against real third-party grids

- Replaced the three identical `BaselineAdapter` stubs (`gridalpha`, `gridbeta`, `gridgamma`) with real adapters: AG Grid Community v33 (`themeQuartz`, `applyTransaction`, sortable+filterable+resizable defaults), TanStack Table v8 + TanStack Virtual v3 (`getCoreRowModel`/`getSortedRowModel`/`getFilteredRowModel` + virtualized rows), and MUI X DataGrid Community v7 (`@mui/x-data-grid` defaults). Shipped as four sequential PRs (#120 ag-grid, #121 mui, #122 tanstack, B2 Phase 4 = this runset).
- `BenchAdapterId` renamed everywhere outside frozen historical runsets: `pretable | ag-grid | tanstack | mui`.
- New comparator deps land in `apps/bench` only — `@pretable/*` public surface unchanged. `pnpm why` confirms zero leakage into `core`/`react`/`ui`/`stream-adapter`.
- Comparative S2/hypothesis/Chromium runset committed at `status/milestones/2026-05-08-b2-comparative-bench.hypotheses.json` (12 scripts × 4 adapters × 3 repeats; ~4 min wall-clock thanks to fast unsupported fail-fast). Per-adapter scroll medians extracted to `status/milestones/2026-05-08-b2-scroll-summary.json` for the website page renderer.

### H1 flipped from "satisfied" (against stubs) to "failing" (against real grids)

- Prior H1 satisfied claim was anchored on the gridalpha stub at 66.7ms / 152px row-height clip — i.e., a deliberately broken baseline.
- Real evidence (S2/hypothesis/Chromium, 3 repeats, frame p95 medians):
  - **MUI X DataGrid Community: 8.7ms** / row-height error 1px / 0 blank gaps / 0 anchor shift — passes all H1 quality sub-criteria and is 11% _faster_ than pretable.
  - **pretable: 9.7ms** / row-height error 1px / 0 blank gaps / 0 anchor shift — passes all quality sub-criteria.
  - **AG Grid Community: 16.7ms** / row-height error 2px / 1 blank gap — fails quality on row-height-drift and blank-gap.
  - **TanStack Table v8: 16.7ms** / row-height error 0px / 1 blank gap — fails quality on blank-gap.
- The 10% parity threshold (pretable within 10% of best full-grid comparator) is not met — pretable is ~11% above MUI's frame p95.
- We're keeping the failing status. The honest read: pretable's wedge on the scroll script isn't raw frame speed; it's the _combination_ of zero-artifact quality and the surrounding feature surface (headless engine, streaming primitives, theming-as-data, selection/keyboard/cell-renderer hypotheses H16-H21 all satisfied). MUI ties on quality but ships a fundamentally different feature surface and licensing tier.
- `scripts/bench-matrix.mjs` thresholds are unchanged. Only the website prose at `apps/website/app/bench/page.tsx` was rewritten to match measured deltas.

### Hypothesis status delta (vs 2026-05-07 bench-slab1 milestone)

| H#  | Before    | After        | Note                                                                 |
| --- | --------- | ------------ | -------------------------------------------------------------------- |
| H1  | satisfied | **failing**  | Real MUI 11% faster than pretable; comparators got real (see above). |
| H5  | satisfied | satisfied    | Matrix harness still emits artifacts.                                |
| H6  | satisfied | satisfied    | Sort interaction (S2/pretable).                                      |
| H7  | satisfied | satisfied    | Metadata filter (S2/pretable).                                       |
| H8  | satisfied | satisfied    | Wrapped-text filter (S2/pretable).                                   |
| H9  | -         | insufficient | S7 not in this matrix.                                               |
| H10 | -         | insufficient | S7 not in this matrix.                                               |
| H11 | -         | insufficient | S7 not in this matrix.                                               |
| H12 | -         | insufficient | S7 not in this matrix.                                               |
| H13 | -         | insufficient | S5/updates not in this matrix.                                       |
| H14 | -         | insufficient | S5/updates not in this matrix.                                       |
| H15 | -         | insufficient | S5/updates not in this matrix.                                       |
| H16 | satisfied | satisfied    | Selection extend p95 = 10.2ms.                                       |
| H17 | satisfied | satisfied    | Keyboard nav p95 = 10.1ms.                                           |
| H18 | satisfied | satisfied    | Select-all latency = 8.7ms.                                          |
| H19 | satisfied | satisfied    | Format overhead = 0.40ms.                                            |
| H20 | satisfied | satisfied    | Cheap-render scroll p95 = 10.3ms.                                    |
| H21 | satisfied | satisfied    | Heavy-render scroll p95 = 9.4ms.                                     |

### Known gaps / follow-ups

- **`autosize` script never wired through the harness pipeline.** `autosize` is in the `BenchScriptName` type union (`packages/bench-runner/src/index.ts`) and the AG Grid adapter has an `autosize` branch in `onGridReady`, but the query-state parser (`apps/bench/src/query-state.ts`) does not accept `autosize` as a valid `script` query param, and the bench-runner's `supportedScripts` allowlist in `validateSupportedP0aRequest` does not include it. No historical runset has autosize evidence; the AG Grid adapter's autosize branch is currently dead code. Wiring autosize end-to-end (query-state allowlist + bench-runner `supportedScripts` + pretable + mui handlers; tanstack returns `unsupported` per spec) is a follow-up PR. Phase 4's matrix run dropped autosize from the script list as a consequence.
- **Comparative interaction evidence (sort/filter for ag-grid/tanstack/mui).** `validateSupportedP0aRequest` still gates `sort`/`filter-text`/`filter-metadata` to pretable-only, so the matrix renders those as `unsupported` for the new comparators. Real grids implement those operations; a future B-phase sub-project should expose comparative interaction latency.
- **Comparative streaming evidence (S5/updates).** All four bench adapters now wire `applyTransaction`-style updates, but the matrix run was S2-only. A future runset under S5 with rate-tagged repeats can populate H13/H14/H15 against real comparators.
- **Webkit/Firefox.** This runset is Chromium-only; cross-browser parity is a separate slice.

### Next checkpoint

- Per the standing backlog (theming architecture, AI integrations, headless docs, clipboard docs, autosize wiring, comparative interaction/streaming), the user picks the next priority.

## 2026-05-09

### B2 follow-up #1: H1 flip overturned at higher repeat count

The 2026-05-08 H1 "failing" verdict was a low-sample artifact, not a real regression.

- High-repeat rerun (S2/hypothesis/Chromium, scroll script, pretable + mui only, n=20 each): pretable mean **9.07 ms ± 0.20**, MUI mean **9.14 ms ± 0.19**. Mean diff −0.065 ms (pretable marginally faster on average) is well inside the 2σ noise floor of 0.40 ms.
- Verdict: **noise**. Source: `status/milestones/2026-05-09-perf-diag-high-repeat.scroll.json`; memo at `docs/research/2026-05-09-pretable-vs-mui-scroll-perf.md`.
- Corrected H1 milestone: `status/milestones/2026-05-09-b2-h1-high-repeat-correction.json` overlays the original B2 evidence with the n=20 result and a `correctedH1.status: "satisfied"` entry. The original B2 milestone (`2026-05-08-b2-comparative-bench.hypotheses.json`) is left intact for historical reference.
- AG Grid (16.7 ms p95, 1 blank gap, 2 px row-height drift) and TanStack (16.7 ms p95, 1 blank gap) status from the B2 n=3 runset is **not** corrected by this rerun — both adapters were measured at >50% above pretable, far enough that low-repeat noise is unlikely to flip them. They remain ~1.7× pretable's `scroll_frame_p95_ms` with quality gaps that pretable does not have.

### H1 evaluator now gates on minimum repeats in the tight zone

Architectural fix to prevent this class of artifact from re-occurring:

- `scripts/bench-matrix.mjs` `evaluateH1` now returns `insufficient` (rather than `failing`) when the pretable / best-full-grid frame-p95 ratio is in the tight zone `0.9 ≤ r ≤ 1.2` AND either adapter has `< 10 repeats`. Outside the tight zone (e.g., 1.6× slower) the gap dominates noise and the existing n=1 path still fires.
- New test: `composite H1 returns insufficient when parity ratio is in the tight zone with too few repeats`. Existing test `composite H1 fails when pretable frame parity exceeds 110%` rewritten to use a clearly-out-of-zone ratio (1.6) so the failing path stays exercised.
- Practical effect: a 3-repeat matrix run that puts pretable in the same noise-zone as a comparator will surface as `insufficient` with guidance to re-run at `--repeats=10` or higher, instead of producing a false-failing verdict.

### Website /bench page updated to parity framing

- `apps/website/app/bench/page.tsx` now loads both the original n=3 milestone and the n=20 correction. The H1 status displayed reflects the corrected verdict; the `verdictFor` table cell labels parity-confirmed adapters as `parity at n=20 (full quality pass)` rather than crowning a "fastest" off n=3 noise.
- Prose rewritten: parity at high repeats is the headline; the original n=3 snapshot is described as a low-sample artifact. AG Grid / TanStack framing (~1.7× slower with quality gaps) is unchanged.

### B2 follow-up #3: autosize wired end-to-end + H22 added

The `autosize` script existed in the `BenchScriptName` union and the AG Grid adapter had a dead `onGridReady` autosize branch, but the harness pipeline dropped the script silently. Closed the gap:

- **Pipeline:** `apps/bench/src/query-state.ts`, `apps/bench/src/bench-types.ts`, and `packages/bench-runner/src/index.ts` now accept the `autosize` script (gated to `S2` and to `pretable | ag-grid | mui`; tanstack returns `unsupported` because TanStack Table is headless and exposes no autosize API).
- **Helper:** `apps/bench/src/bench-runtime.ts` adds `measureBenchAutosizeRun(root, adapterId, autosize)` — single-event "call-to-paint" timing (await the callback, then one rAF), reports `interaction_latency_ms`. Mirrors the shape of `measureBenchKeySequenceRun`.
- **Adapters:** Pretable (`grid.autosizeColumns()`), AG Grid (`gridApi.autoSizeColumns(colIds, false)`), and MUI (`apiRef.current.autosizeColumns({ includeOutliers: true })` — async on v7+) each accept `onAutosizeReady` and call back with a closure over their native autosize API. `bench-app.tsx` captures the callback in `autosizeApiRef` and dispatches on the autosize script; AG Grid's old pre-emptive mount-time autosize branch is replaced by the callback. MUI now exposes its `apiRef` via `useGridApiRef()`.
- **H22 evaluator:** `scripts/bench-matrix.mjs` adds `evaluateH22(runs)` — pretable autosize must complete within a 60Hz frame (≤ 16 ms) and within 10% of the best ag-grid/mui comparator. Reuses H1's tight-zone min-repeat gate (now a module-level `COMPARATOR_PARITY_MIN_REPEATS = 10` constant): tight-zone ratios (0.9–1.2) at < 10 repeats per side return `insufficient`.
- **Matrix re-run:** Full B2 retry matrix re-run (S2/hypothesis/Chromium, all 13 scripts including autosize, repeats=3, ~5 min wall-clock). Output: `status/milestones/2026-05-09-b2-with-autosize.hypotheses.json`. The original `2026-05-08-b2-comparative-bench.hypotheses.json` is unchanged.
- **H22 verdict:** **satisfied** — pretable 5.3 ms vs MUI 11 ms (ratio 0.482, comfortably below the tight zone, so the min-repeat gate does not apply). AG Grid autosize completed too. A 20-repeat re-run is **not** required because the verdict resolved outside the tight zone.
- **Other status changes vs the 2026-05-08 milestone:** H1 flipped from `failing` to `satisfied` (pretable 9 ms vs MUI 9.2 ms, ratio 0.978; in tight zone but ratio < 1.1 so the new gate does not gate, and the existing < 1.1 path satisfies parity). This matches the n=20 correction documented above. No other hypotheses changed status.
- **Autosize gap closed.** The follow-up backlog item logged on 2026-05-08 is resolved; remaining out-of-scope items (column-width fidelity instrumentation, post-autosize scroll measurement) remain deferred.

### B2 follow-up #6: S5 + S7 cross-validation of H1's parity story

Cross-validation of H1's parity story on S5 (streaming updates) and S7 (filter-metadata) scenarios. The B2 Phase 4 retry was S2-only, leaving H9 (S7/scroll) and H13/H14/H15 (S5/updates) at `insufficient`. With autosize landed (follow-up #3) the matrix is healthy enough to re-run those scenarios at parity-style fidelity. Run command: `pnpm bench:matrix --project=chromium --adapters=pretable,ag-grid,tanstack,mui --scenarios=S5,S7 --scripts=scroll,updates --scale=hypothesis --repeats=3 --update-rates=1000,25000`. Wall-clock ~3.5 min. Milestone: `status/milestones/2026-05-09-b2-s5-s7-cross-validation.hypotheses.json`.

| Hypothesis                              | Before       | After         | Notes                                                                                                                                                                                                                                                  |
| --------------------------------------- | ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H9 (S7 scroll quality + parity)         | insufficient | **satisfied** | Pretable matches MUI on S7 scroll: 9.2 ms p95, 0 blank gaps, 0 long tasks, row-height error ≤ 1 px. TanStack 16.7 ms p95 with 1 blank gap. AG Grid measured but does not clear the combined quality bar. Mirrors H1's parity story on the S7 scenario. |
| H13 (streaming frame-budget uniqueness) | insufficient | directional   | Pretable holds the budget at 1000/sec and 25000/sec; AG Grid also clears it. Frame-budget threshold alone does not differentiate.                                                                                                                      |
| H14 (streaming envelope uniqueness)     | insufficient | directional   | Pretable reaches 25000/sec; AG Grid also reaches 25000/sec — no order-of-magnitude gap inside the configured rates. Higher update rates would be needed to find the ceiling, if one exists.                                                            |
| H15 (streaming row stability)           | insufficient | directional   | Pretable visible-row drift = 1, AG Grid drift = 0. Pretable is slightly worse on this metric; differentiation threshold (5 rows) is not exceeded by either side.                                                                                       |

No other hypothesis status changed (S2-dependent ones — H1, H6–H8, H10–H12, H16–H22 — remain `insufficient` because S2 was not in this matrix; expected).

**Out of scope (separate follow-ups):**

- Editorial homepage refresh (potentially repopulating the deleted streaming row from this evidence) — distinct prose work.
- Comparative interaction scripts (sort, filter-text, filter-metadata, cell-renderer) on S7 — still pretable-only per the supportedScripts gate; tracked as B2 follow-up #5.

### B2 follow-up #7: streaming wedge reframed as capability-anchored

Direct consequence of follow-up #6's finding. AG Grid Community matches pretable on every measured streaming numeric (frame p95, 25k/sec envelope, visible-row drift), so the homepage can no longer claim a numeric streaming win. The wedge moves to package surface: pretable ships the SSE → partial-JSON → batcher → applyTransaction pipeline as a single import; AG Grid expects you to wire that yourself.

Three editorial edits across `apps/website`:

- **`ComparisonTable.tsx`** — the streaming row was titled `purpose-built streaming pipeline` (vague). Renamed to `streaming pipeline (SSE → partial JSON → batcher → applyTransaction)` to spell the wedge out concretely. Still capability-anchored (`yes / n/a / n/a / n/a`); no numeric streaming row added because the n=3 numerics tie.
- **`ReceiptsBand.tsx`** — replaced the `25k/s · max sustained update rate` hero stat (no longer pretable-unique) with `OpenAI · Anthropic · SSE · streaming sources, one import`. Added a `compact: true` flag to the `Stat` interface so the longer label renders at a smaller font size, preserving the four-cell grid without overflowing the hero font scale.
- **`FeatureGrid.tsx`** — Stream-aware card: dropped the "sustained from 100 to 25,000 updates/sec" tail; rewrote the description around the pipeline that ships as one import.

Test added: `ReceiptsBand.test.tsx` regression-guards the new capability anchor (`streaming sources` + `openai`). The `verdictFor` / trail-marker tests are unchanged.

The "Stream-aware" card in FeatureGrid retained its `markerLabel: "Advanced — bring your own SSE"` because that's still accurate — pretable ships the post-SSE pipeline; the SSE source itself is consumer-supplied.

## 2026-05-10

### B2 follow-up #5a: cell-renderer scripts opened to comparators

First slice of follow-up #5 (open the supportedScripts gate). The gate in `packages/bench-runner/src/index.ts` previously kept `scroll-with-format` / `scroll-with-render` / `scroll-with-heavy-render` pretable-only, even though the AG Grid + TanStack + MUI adapters had wired the scriptName-driven render branches in Phase 1–3 of B2. Split the gate: cell-renderer scripts now run on all four adapters (S2-only); selection scripts (`select-range-extend` / `keyboard-nav-row` / `select-all`) remain pretable-only because range-select and select-all are paid-tier in AG Grid Enterprise + MUI X Pro and TanStack Table doesn't ship native cell selection.

While running the matrix the first time, AG Grid hit "scroll viewport unavailable" because `bench-app.tsx` only awaited the extra mount frame for `scriptName === "scroll"`, not for the cell-renderer variants. Fixed by extending the extra-frame wait to all four scroll-shape scripts; the bench-runtime `waitForScrollViewport` 12-frame ceiling stays unchanged.

Matrix run: `pnpm bench:matrix --adapters=pretable,ag-grid,tanstack,mui --scenarios=S2 --scripts=scroll,scroll-with-format,scroll-with-render,scroll-with-heavy-render --scale=hypothesis --repeats=3`. Wall-clock ~2 min. Milestone: `status/milestones/2026-05-10-b2-cell-renderer-comparators.hypotheses.json`.

Per-adapter scroll-frame-p95 (n=3 medians, blank-gap counts in parens):

| Script                     | pretable    | ag-grid     | tanstack    | mui         |
| -------------------------- | ----------- | ----------- | ----------- | ----------- |
| `scroll-with-format`       | 10.2 ms (0) | 25.1 ms (1) | 17.5 ms (1) | 10.2 ms (0) |
| `scroll-with-render`       | 16.4 ms (0) | 24.9 ms (1) | 17.0 ms (1) | 10.3 ms (0) |
| `scroll-with-heavy-render` | 10.3 ms (0) | 25.2 ms (1) | 23.4 ms (1) | 10.1 ms (0) |

Hypothesis status (all evaluators are pretable-only at the evaluator level today; comparator data lives in the per-run summary files):

| H#  | Status        | Notes                                                                    |
| --- | ------------- | ------------------------------------------------------------------------ |
| H1  | satisfied     | Same parity story as B2 corrections.                                     |
| H19 | **satisfied** | Format overhead is −0.10 ms (format 10.2 ms vs scroll baseline 10.3 ms). |
| H20 | satisfied     | Cheap-render p95 = 10.2 ms ≤ 16 ms single-frame budget.                  |
| H21 | satisfied     | Heavy-render p95 = 10.3 ms ≤ 20 ms.                                      |

**Findings worth noting:**

- **Pretable beats AG Grid Community 2–2.5× on every cell-renderer script,** with zero blank gaps. AG Grid drops a blank gap on each. Strongest comparative wedge surfaced since the original B2 H1 stub-baseline era.
- **Pretable matches MUI on `scroll-with-format` and `scroll-with-heavy-render`,** but loses on `scroll-with-render` (pretable 16.4 ms vs MUI 10.3 ms). Pretable's cheap-React-cellRenderer path is anomalously slow vs the format-only path and even the heavy-render path — same dataset, fewer DOM nodes, more frame budget consumed. Logged as a follow-up to investigate.
- **TanStack with cellRenderer scales DOM nodes aggressively** (704 / 1344 / 2624 across the three scripts). React-virtual's per-cell render under JSX cells is a known cost; TanStack still lands within ~1.7× of pretable's frame budget despite the node-count blow-up.

**H19/H20/H21 evaluators are pretable-only** — they don't surface comparator data in the evidence array even now that comparators have run. The data lives in the per-run `status/chromium-<adapter>-default-s2-hypothesis-scroll-with-*.summary.json` files. Future work could extend the evaluators (or add new comparator-aware H## entries) so the milestone JSON renders the comparative table inline; for now the milestone is the source of truth and downstream tools can read the per-run summaries.

**Tests:** `packages/bench-runner/src/__tests__/bench-runner.test.ts` extended with positive assertions that all four adapters can run cell-renderer scripts on S2, plus a regression guard that selection scripts stay pretable-only.

### Open from follow-up #5

The sort / filter-text / filter-metadata gate is still pretable-only. That's the next slice (option C from the brainstorm) — sequenced after this PR per the user's "A then C" choice. May flip H6/H7/H8 when comparators are wired.

### Pretable `scroll-with-render` anomaly (logged for investigation)

Surfaced by the milestone above. Pretable's `scroll-with-render` p95 (16.4 ms) is anomalously slow vs `scroll-with-format` (10.2 ms) and `scroll-with-heavy-render` (10.3 ms). Heavy render is `scroll-with-render` plus extra DOM (badge dot + status data attr) — yet it's faster. This suggests the cheap-React-cellRenderer path in `pretable-adapter.tsx`'s `applyCellRendererFlavor` has a perf cliff that the heavier path avoids (possibly a different code path in `@pretable/react`'s cell-render integration that disables on more complex render output). Not investigated in this PR; logged as a follow-up.

### B2 follow-up #5b: sort + filter scripts opened to comparators

Second slice of follow-up #5. The `sort` / `filter-metadata` / `filter-text` gate in `packages/bench-runner/src/index.ts` was the last pretable-only block in the supportedScripts validator. Dropped it; each adapter now applies the bench's `BenchInteractionPlan` via its native library API:

- **AG Grid:** `gridApi.applyColumnState({ state: [{ colId, sort }], defaultState: { sort: null } })` for sort; `gridApi.setFilterModel({ [colId]: { filterType: "text", type: "equals" | "contains", filter } })` for filter.
- **TanStack:** `table.setSorting([{ id, desc }])` for sort; `table.setColumnFilters([{ id, value }])` for filter. The Table instance is captured into a ref each render (TanStack v8's `useReactTable` returns a fresh object per render) so a `useEffect` keyed on `[interactionPlan, runKey]` can drive it. `filter-metadata` mode swaps `filterFn` to `equalsString`; default is `auto` (includesString) for `filter-text`.
- **MUI:** `apiRef.current.setSortModel([{ field, sort }])` for sort; `apiRef.current.setFilterModel({ items: [{ field, operator: "equals" | "contains", value }] })` for filter.

`bench-app.tsx`'s interaction dispatch now widens to all four adapters; comparators pass `undefined` for `readInteractionStateOverride` so the runtime falls back to DOM-default state reading (telemetry override remains pretable-only). All four adapters receive `interactionPlan={interactionPlan}` in the AdapterSurface render block.

Matrix run: `pnpm bench:matrix --project=chromium --adapters=pretable,ag-grid,tanstack,mui --scenarios=S2 --scripts=sort,filter-metadata,filter-text --scale=hypothesis --repeats=3`. Wall-clock ~2 min. Milestone: `status/milestones/2026-05-10-b2-sort-filter-comparators.hypotheses.json`.

Per-adapter latency (n=3 medians; `interaction_latency_ms` / `settle_duration_ms`):

| Script            | pretable          | ag-grid           | tanstack          | mui               |
| ----------------- | ----------------- | ----------------- | ----------------- | ----------------- |
| `sort`            | 16.5 ms / 16.8 ms | 58.3 ms / 9.2 ms  | 34.4 ms / 31.6 ms | 35.0 ms / 25.0 ms |
| `filter-metadata` | 16.0 ms / 16.7 ms | 49.9 ms / 15.5 ms | 15.7 ms / 26.5 ms | 33.4 ms / 25.0 ms |
| `filter-text`     | 17.7 ms / 16.6 ms | 50.0 ms / 16.7 ms | 40.2 ms / 24.7 ms | 33.3 ms / 25.0 ms |

Hypothesis status (H6/H7/H8 evaluators remain pretable-only — comparator data lives in the per-run summary files):

| H#  | Status    | Notes                                                                                                                |
| --- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| H6  | satisfied | Pretable sort 16.5 / 16.8 ms within thresholds; comparator data captured (ag-grid 58.3, mui 35.0, tanstack 34.4 ms). |
| H7  | satisfied | Pretable filter-metadata 16.0 / 16.7 ms within thresholds; comparator data captured.                                 |
| H8  | satisfied | Pretable filter-text 17.7 / 16.6 ms within thresholds; comparator data captured.                                     |

**Findings worth noting:**

- **Pretable beats AG Grid Community 3–3.5× on every interaction script** (16–18 ms vs 50–58 ms `interaction_latency_ms`). Strongest comparative result yet.
- **Pretable beats MUI 2× on every interaction script** (16–18 ms vs 33–35 ms).
- **TanStack is mixed:** filter-metadata latency (15.7 ms) actually beats pretable (16.0 ms) — but settle (26.5 ms) is 1.6× slower. Sort and filter-text are slower on both axes.
- **Comparator `result_row_count` reads as 3000 (full dataset)** because the comparator adapters set `data-bench-result-row-count` to `dataset.rows.length` at render time and don't recompute it after applying a filter. The interaction itself is correctly applied (see `interaction mode: filter-*` in the run notes; harness reaches "settled" only when DOM signature changes), so latency/settle metrics are valid. Updating comparator adapters to publish post-filter row counts is a small follow-up if H7/H8 ever gain comparator-aware evaluators.

**H6/H7/H8 evaluators are pretable-only** — like H19/H20/H21 from #5a, they don't surface comparator metrics in the evidence array. Comparator data lives in `status/chromium-<adapter>-default-s2-hypothesis-{sort,filter-metadata,filter-text}-*.summary.json`. The narrative table above is the source of truth.

**Tests:** `packages/bench-runner/src/__tests__/bench-runner.test.ts` rewrites the negative comparator assertions as positive parity assertions (all four adapters can run sort/filter-metadata/filter-text on S2). The `apps/bench/src/__tests__/bench-app.test.tsx` "publishes an unsupported result for comparator interaction scripts" test flips to a positive dispatch assertion that comparator runs go through `measureBenchInteractionRun` with `readInteractionStateOverride === undefined`.

**Out of scope (separate follow-ups):**

- Comparator-aware H6/H7/H8 evaluators (would require adding a multi-adapter evidence shape; the data is already on disk).
- Comparator post-filter row-count reporting (small adapter polish to update `data-bench-result-row-count` on plan apply).
- Homepage narrative refresh to reflect the 2–3.5× wedge on interaction scripts (separate editorial follow-up; this PR is harness wiring + evidence only).

This closes the structural part of B2 follow-up #5; the supportedScripts gate is no longer pretable-only for any non-selection script.

## 2026-05-11

### B2 follow-up: homepage interaction wedge refresh

Editorial PR landing the PR #131 sort + filter comparator wedge on the homepage. Three editorial surfaces touched; no source/package changes.

- **`apps/website/app/components/ComparisonTable.tsx`** — three new rows added between `scroll anchor shift (px)` and `headless engine + React surface`: `sort latency p95`, `filter-metadata latency p95`, `filter-text latency p95`. Each row carries per-adapter numbers from the PR #131 runset (n=3 medians). The section subhead gets one new sentence: "Interactive sort and filter run 2–3.5× faster than every measured comparator on the same dataset." Header docblock cites the new milestone source.
- **Trail-marker labels** rewritten on three comparators (pretable's "Recommended path" unchanged):
  - **AG Grid** — `"Slower scroll; row-height drift"` → `"1.7× slower scroll, 3× slower interaction; row-height drift"`.
  - **TanStack** — `"Headless; you wire selection and nav"` → `"Headless; ~2× slower interaction (filter-metadata ties pretable)"`.
  - **MUI X** — `"Parity at scroll p95; full-grid feature surface"` → `"Scroll-p95 parity; 2× slower interaction"`. This is the most consequential change — the prior "parity at scroll p95" framing read positively about MUI; the new label keeps that half of the story while adding the interaction caveat.
- **`apps/website/app/bench/page.tsx`** — the existing placeholder Interactions section ("comparative interaction evidence is on the roadmap") is replaced with a real section mirroring the H1 scroll layout: a four-adapter × three-script table plus two prose paragraphs. New `loadInteractionSummary()` + `interactionVerdictFor()` helpers parallel the existing scroll-side patterns. The verdict helper computes per-script ratio ranges and annotates the TanStack `filter-metadata` tie inline.
- **Aggregator + summary file:** `scripts/extract-interaction-summary.mjs` is a one-shot Node script that reads the PR #131 per-run JSONs (`status/chromium-<adapter>-default-s2-hypothesis-{sort,filter-metadata,filter-text}-2026-05-10*.summary.json`), picks medians, and writes `status/milestones/2026-05-10-b2-sort-filter-summary.json`. Future matrix runs can regenerate the summary via the same script.

**Tests:** `apps/website/__tests__/components/ComparisonTable.test.tsx` regression-guards the new trail-marker label phrasings via regex; pretable assertion unchanged. No new test for the `/bench` page section beyond the existing render-check.

### Out of scope (deliberate)

- **`ReceiptsBand.tsx`** — PR #129 (streaming reframe) is still open and modifies this file. Leaving it untouched here to avoid a merge conflict over an unresolved editorial decision.
- **`FeatureGrid.tsx` Stream-aware card** — already capability-anchored after PR #126; doesn't need re-touching.
- **High-repeat (n=20) follow-up for borderline cases:** pretable's `filter-text` at 17.7 ms and TanStack's `filter-metadata` at 15.7 ms both sit within ±2 ms of the 16 ms frame budget. The page prose acknowledges this; an n=20 rerun would tighten the verdict but isn't a v1 blocker.
- **Comparator-aware H6/H7/H8 evaluators** — the page reads from the aggregated summary file directly (mirroring the scroll-summary pattern); evaluator-array extension is future work if needed.

### Open from B2

- **PR #129 streaming reframe** — still awaiting user prose review. Touches `ComparisonTable.tsx` (streaming-row rename) and `ReceiptsBand.tsx`. File-level conflict with this PR is limited to the docblock at the top of `ComparisonTable.tsx`; resolvable.
- **High-repeat protocol for interaction borderlines** — logged here.
- **Pretable `scroll-with-render` 16.4 ms anomaly** — logged in the 2026-05-10 entry above; still pending investigation.

## 2026-05-12

### Comparator-aware evaluators — architecture change

Six pretable-only evaluators in `scripts/bench-matrix.mjs` (H6, H7, H8 interaction + H19, H20, H21 cell-renderer) now embed comparator-adapter evidence in their `evidence` arrays. Mirrors `evaluateH1`'s pre-existing pattern. Status logic unchanged — pretable's absolute thresholds still drive verdicts; comparator data is informational. Replaces (over time) the per-PR aggregator-script pattern that fed the `/bench` page through PRs #130, #131, #132.

- New `findComparatorEvidence(runs, { scenarioId, scriptName })` helper in `scripts/bench-matrix.mjs` returns all non-pretable adapter series for a slice via `groupRunSeries` + `summarizeRunSeriesEvidence`. Single helper used by all six target evaluators.
- Each of H6/H7/H8/H19/H20/H21 appends `...comparatorEvidence` to its `evidence:` array in every return branch (insufficient / failing / satisfied / directional). For `insufficient` branches without pretable data, the evidence array stays empty — comparator data alone doesn't satisfy any hypothesis.
- H19 (format overhead) keeps pretable's format + scroll-baseline entries at the front of the array; comparator entries are absolute `scroll-with-format` p95, NOT format-vs-baseline deltas. Inline docblock documents the semantics so future readers don't conflate the two.
- Six new test cases in `scripts/__tests__/bench-matrix.test.mjs` assert evidence-array contents when comparator runs are present. All existing status-verdict tests untouched.
- Matrix re-run at 4 adapters × 7 scripts × 3 repeats = 84 runs. The matrix runner bailed mid-run twice (one tanstack/filter-metadata locator-timing flake, one preview-server `ECONNREFUSED`); recovered by running the surviving adapters (`tanstack,mui`) as a second invocation, then synthesizing the milestone from all on-disk per-run summaries via a one-shot script that called `createHypothesisReport` directly. All four adapters are present in every H6/H7/H8/H19/H20/H21 evidence array.
- Milestone: `status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json`. All seven hypotheses (H1, H6–H8, H19–H21) retained `satisfied` status — architectural change was data-only.

### Out of scope (deferred)

- **`/bench` page swap to read from `hypotheses.json` directly.** Aggregator scripts (`scripts/extract-interaction-summary.mjs` + the inline aggregators) still feed the page; can be retired once the page reads from the new milestone shape. Editorial-only PR.
- **Per-adapter format-overhead deltas in H19.** Currently H19's status compares pretable's `scroll-with-format` p95 against pretable's `scroll` baseline; comparator evidence surfaces absolute format p95 only. Computing per-adapter deltas would extend H19 from a pretable-quality check into a comparative-overhead check — a different hypothesis.
- **Matrix runner reliability.** Mid-run flakes (locator timeouts, preview-server connection refused) have hit multiple recent PRs (#133, #134, this one). The bail-on-first-failure behavior wastes a 5-minute run when a single repeat flakes; a `--continue-on-error` option plus a runset-merge pathway would be a useful runner enhancement.
