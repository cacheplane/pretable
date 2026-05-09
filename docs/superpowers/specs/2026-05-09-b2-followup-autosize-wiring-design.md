# B2 Follow-up #3 — Autosize End-to-End Wiring Design

**Date:** 2026-05-09
**Status:** Draft (awaiting user review before plan)
**Predecessor:** [B2 comparative bench](./2026-05-08-tier1-b2-comparative-bench-design.md), [B2 corrections](./2026-05-09-b2-followup-perf-diagnostic-design.md)

---

## Goal

Wire the `autosize` script end-to-end through the bench harness pipeline (currently dead code in the AG Grid adapter), measure end-to-end autosize latency on `pretable | ag-grid | mui` (TanStack returns `unsupported`), add a comparator-parity hypothesis evaluator (`H22`) using the same min-repeat gate the corrections PR introduced for `H1`, and re-run the full B2 matrix with autosize included to populate evidence.

## Why

`autosize` is in the `BenchScriptName` type union and the AG Grid adapter has an `onGridReady` autosize branch, but the harness pipeline drops the script silently — query-state's allowlist doesn't accept it, `validateSupportedP0aRequest`'s `supportedScripts` doesn't include it, and no `measureBenchAutosizeRun` helper exists. The B2 Phase 4 retry caught this and dropped autosize from that run; the gap has been documented as follow-up #3 in `project_b2_followups.md`.

## Non-goals

- Other browsers (Chromium-only, mirrors B2).
- Per-column autosize (only "autosize all columns" — single event).
- Column-width fidelity instrumentation (whether autosize actually fits the widest cell). Latency only for v1; fidelity is a future follow-up if anyone requests it.
- Post-autosize scroll measurement. The script measures the autosize event in isolation; combined scripts are deferred.
- Updating the website `/bench` page. H22 is a new hypothesis that will surface in the milestone JSON; the page renders only `H1` today, so no UI change is needed.

## Architecture

### Metric

`autosize` reports `interaction_latency_ms`: time from the adapter's autosize callback dispatch to the next paint, captured via `requestAnimationFrame` after the call returns. Single-event measurement, same shape as `select-all` (`measureBenchKeySequenceRun` with `count: 1`).

A new `measureBenchAutosizeRun(root, adapterId, autosize)` helper in `apps/bench/src/bench-runtime.ts` accepts an `autosize: () => Promise<void> | void` callback (the adapter's autosize entry point, captured via a ref similar to `updateApiRef`). It awaits the callback, then `requestAnimationFrame`, then reports the elapsed ms as `interaction_latency_ms`.

### Per-adapter wiring

| Adapter | Autosize entry | Notes |
|---|---|---|
| `pretable` | `pretableGridRef.current?.autosizeColumns()` | Already exposed via the existing `onGridReady` ref in `bench-app.tsx`. |
| `ag-grid` | `gridApi.autoSizeAllColumns(false)` | Already wired in `ag-grid-adapter.tsx`'s `onGridReady` (currently dead code). Needs to call back through a new `onAutosizeReady` prop. |
| `tanstack` | n/a | Returns `unsupported` (`reason: "TanStack Table is headless; no autosize API"`). |
| `mui` | `apiRef.current.autosizeColumns({ includeOutliers: true })` | New: the MUI adapter currently doesn't expose its `apiRef`; this PR adds the export. |

The pattern: each adapter accepts an optional `onAutosizeReady?: (autosize: () => Promise<void>) => void` prop. When the adapter has a usable autosize API, it calls back with a closure over the API. The `bench-app.tsx` family map captures the callback in an `autosizeApiRef` mirroring `updateApiRef`. The dispatch block calls `measureBenchAutosizeRun(viewport, adapterId, autosizeApiRef.current)` when `scriptName === "autosize"`.

### Type-level changes

- `apps/bench/src/query-state.ts` — add `"autosize"` to the `script` allowlist parser.
- `packages/bench-runner/src/index.ts` — add `"autosize"` to the `supportedScripts` list inside `validateSupportedP0aRequest` (gated to `pretable | ag-grid | mui`; tanstack returns `unsupported`).

The B2 spec already locked this matrix; no design change.

### Hypothesis evaluator: H22

`evaluateH22(runs)` in `scripts/bench-matrix.mjs`. Pattern follows `evaluateH1` (the comparator-parity check), reusing the same min-repeat gate landed in PR #125:

- Find the `pretable / S2 / autosize / hypothesis` series and the best comparator series among `ag-grid / mui` (filter by `supportedScripts` rather than family).
- If pretable has no completed series → `insufficient`.
- Sub-criteria (absolute floor): `interaction_latency_ms ≤ 16` ms (single-frame budget). Failing if pretable exceeds.
- If pretable passes the floor:
  - If no comparator data → `directional`.
  - Compute `parityRatio = pretable.latency / bestComparator.latency`.
  - If ratio in tight zone (0.9 ≤ r ≤ 1.2) AND either side has < 10 repeats → `insufficient` with re-run guidance.
  - If ratio > 1.1 outside tight zone → `failing`.
  - Otherwise → `satisfied`.

H22 thresholds match H1's: 10% parity band, 16 ms single-frame floor. The min-repeat gate matches the H1 implementation byte-for-byte (refactored into a helper if reusable).

### Matrix re-run

After wiring, run:

```
pnpm bench:matrix \
  --project=chromium \
  --adapters=pretable,ag-grid,tanstack,mui \
  --scenarios=S2 \
  --scripts=initial,scroll,sort,filter-text,filter-metadata,updates,autosize,select-range-extend,keyboard-nav-row,select-all,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
  --scale=hypothesis \
  --repeats=3
```

This is the full B2 retry matrix with autosize re-included. ~5 min wall-clock based on PR #123's timing (most comparator entries fast-fail unsupported). Commit the new milestone JSON under `status/milestones/2026-05-09-b2-with-autosize.hypotheses.json` (the original `2026-05-08-b2-comparative-bench.hypotheses.json` stays intact for historical reference).

### Out-of-scope follow-ups

- A dedicated 20-repeat autosize re-run for tight statistical confidence on H22's parity verdict. Defer; if H22 lands `insufficient` due to the min-repeat gate, that's the signal to schedule it.
- Column-width fidelity instrumentation.

## Risks

- **MUI `autosizeColumns` is async.** The `apiRef.current.autosizeColumns()` call returns a promise on some MUI versions. The runtime helper awaits it before timing the post-call paint — this is correct, but means the metric is "call-to-paint" not "function-call duration." Document this in the helper's docblock.
- **AG Grid `autoSizeAllColumns(false)` is synchronous in v33** but the layout work is deferred to the next layout pass. Same await-then-paint pattern handles it.
- **Pretable's `autosizeColumns()` is synchronous.** The await is a no-op for it; the paint timing is what matters.
- **tanstack returns `unsupported`** at the bench-runner level, so the adapter never dispatches. No code path needed.
- **H22 parity threshold sensitivity.** With autosize being a one-shot cheap operation (likely < 5 ms across all three adapters), the absolute differences may be small enough that the tight-zone gate fires routinely at 3 repeats. That's the correct outcome — re-run at 10+ if you want a non-`insufficient` verdict.
