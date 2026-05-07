# Tier 1 Bench Slab 1 (Combined: B Phase 7 + D3)

## Goal

Validate the perf wedge survives sub-project B (selection / keyboard nav) and sub-project D (cell renderers) by adding six pretable-internal absolute-threshold hypotheses (H16–H21) to the bench matrix, with new bench scripts that exercise each new feature surface, captured via repeated Chromium S2/hypothesis runs and committed as evidence under `status/runsets/`.

## Position in the Tier 1 Roadmap

This sub-project closes the two deferred bench phases tracked in memory:

- `project_phase7_bench_slab1_deferred.md` — sub-project B Phase 7 (selection/nav latency).
- `project_phase_d3_bench_deferred.md` — sub-project D Phase 3 (cell-renderer perf).

Both are bundled here per user direction (2026-05-07): "do phase 7 next and then D3 — combine them." The combined session shares bench infra changes, one matrix invocation, one wall-clock window.

After this sub-project completes, the remaining Tier 1 items are:

- A — public API stabilization (paused 2026-05-07, picks up after this sub-project).
- B2 — comparative bench (Slab 2) for selection/nav vs AG Grid / TanStack / MUI X. Future.
- D-bench-2 — comparative bench (Slab 2) for cell renderers. Future.

## Non-Goals

- **Comparative bench (Slab 2).** All new scripts mark comparator adapters (AG Grid / TanStack / MUI X) as `unsupported`. Comparative claims for selection/nav and cell renderers ship as their own future sub-projects.
- **New `BenchMetricId` values.** All six scripts report into existing metrics (`interaction_latency_ms` for B Phase 7's per-event latency, `scroll_frame_p95_ms` for D3's scroll-driven scripts). Hypothesis evaluators differentiate by `(scriptName, adapterId, scenarioId)`.
- **CI bench gating.** Bench remains local. Evidence is committed under `status/runsets/` for verifiability.
- **Threshold relaxation.** If any hypothesis fails first-run, fix the cause in shared code, don't relax. May extend the wall-clock cost of this sub-project.

## Bench scripts

Six new `BenchScriptName` values added to `packages/bench-runner/src/index.ts`. New script handlers wired in `apps/bench/src/bench-runtime.ts`. Pretable adapter implements them; comparator adapters return `unsupported`.

### Selection / keyboard nav (B Phase 7)

- **`select-range-extend`** — focus the top-left cell, then fire 30× `shift+ArrowDown` keystrokes spaced one frame apart. Per-event latency captured from event dispatch to next paint via `requestAnimationFrame` + `performance.now()`. Reported as `interaction_latency_ms` = p95 across the 30 events.
- **`select-all`** — focus the top-left cell, fire 1× `Cmd+A`. Single-event latency from dispatch to first changed frame, reported as `interaction_latency_ms`.
- **`keyboard-nav-row`** — focus the top-left cell, fire 60× `ArrowDown` keystrokes. Per-event latency captured analogously to `select-range-extend`. Reported as `interaction_latency_ms` p95.

Per-event capture pattern (shared helper in `apps/bench/src/bench-runtime.ts`):

```ts
async function measureKeySequenceLatency(
  root: HTMLElement,
  key: KeyboardEventInit,
  count: number,
): Promise<number> {
  const latencies: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const start = performance.now();
    dispatchKey(root, key);
    await waitForNextPaint(); // requestAnimationFrame double-tick
    latencies.push(performance.now() - start);
  }
  return percentile(latencies, 0.95);
}
```

### Cell renderers (D3)

- **`scroll-with-format`** — pretable adapter mounts the grid with a cheap `format: ({ value }) => String(value)` set on every column. Runs the existing scroll dance (programmatic scroll across the full row range). Reports `scroll_frame_p95_ms` (the existing scroll metric).
- **`scroll-with-render`** — pretable adapter mounts with cheap `render: ({ formattedValue }) => <span>{formattedValue}</span>` on every column. Reports `scroll_frame_p95_ms`.
- **`scroll-with-heavy-render`** — pretable adapter mounts with a 3-element badge JSX tree per cell:

```tsx
render: ({ formattedValue, value }) => (
  <span data-bench-badge={String(value)} className="bench-status-badge">
    <span className="bench-badge-dot" aria-hidden />
    <span>{formattedValue}</span>
  </span>
);
```

Reports `scroll_frame_p95_ms`.

The cell-renderer scripts reuse the existing `scroll` script's interaction sequence (programmatic scroll over the full virtualization range). The only difference is the column configuration injected at mount time.

## Hypotheses

Added to `scripts/bench-matrix.mjs`. Numbering: H1–H15 used (H1=scroll wedge, H5=update durability, H6/H7/H8=interaction at S2, H9–H12=S7 mirrors, H13–H15=S5 streaming). Selection/nav gets H16–H18; cell renderers get H19–H21.

| # | Slice | Threshold | Rationale |
|---|---|---|---|
| H16 | `S2/hypothesis/pretable/select-range-extend` | `interaction_latency_ms` p95 across 30 extends < 16ms | Single-frame budget at 60Hz |
| H17 | `S2/hypothesis/pretable/keyboard-nav-row` | `interaction_latency_ms` p95 across 60 navs < 16ms | Single-frame budget |
| H18 | `S2/hypothesis/pretable/select-all` | `interaction_latency_ms` < 33ms | Two-frame budget — one-time event |
| H19 | `S2/hypothesis/pretable/scroll-with-format` | `scroll_frame_p95_ms` ≤ baseline (`S2/scroll/pretable`) + 2ms | Format overhead bound |
| H20 | `S2/hypothesis/pretable/scroll-with-render` | `scroll_frame_p95_ms` ≤ 16ms | Cell-level memo holds with cheap render |
| H21 | `S2/hypothesis/pretable/scroll-with-heavy-render` | `scroll_frame_p95_ms` ≤ 20ms | Heavier render degrades gracefully (≤ 25% above frame budget) |

H19's baseline is computed inline from the sibling `S2/scroll/pretable` slice in the same runset. No external state, no historical comparison — same matrix invocation. The evaluator pulls both slices and computes the diff.

Each hypothesis is satisfied iff:

1. Pretable evidence exists for the slice at `S2/hypothesis` scale.
2. The threshold holds across `--repeats=3` repeated runs (median across repeats).
3. The matrix is evaluated on the same runset (no cross-run baseline assumptions).

## Run plan

Single matrix invocation closes both phases:

```bash
pnpm bench:matrix \
  --project=chromium \
  --adapters=pretable \
  --scenarios=S2 \
  --scripts=initial,scroll,select-range-extend,keyboard-nav-row,select-all,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
  --scale=hypothesis \
  --repeats=3
```

`initial` and `scroll` are included to capture the S2/scroll/pretable baseline H19 needs and to verify no regression in H1.

Approximate wall-clock cost: ~3 minutes per (script × repeat × adapter) × 8 scripts × 3 repeats ≈ 70 minutes locally. Captured runset committed to `status/runsets/<runset-id>/...`.

## Phase structure

Single sub-project, single PR. Internal commits-of-record for review clarity:

1. **`feat(bench-runner): BenchScriptName entries for selection-nav + cell-renderer scripts`** — enum additions in `packages/bench-runner/src/index.ts`.
2. **`feat(bench): selection-nav script handlers (select-range-extend, keyboard-nav-row, select-all)`** — bench-runtime handlers + per-event measurement helper.
3. **`feat(bench): cell-renderer script handlers (scroll-with-format, scroll-with-render, scroll-with-heavy-render)`** — column-config injection at mount time + reuse of the existing scroll dance.
4. **`feat(bench): comparator adapters return unsupported for new scripts`** — AG Grid / TanStack / MUI X stubs.
5. **`feat(bench-matrix): evaluateH16–H21 hypothesis evaluators`** — `scripts/bench-matrix.mjs` additions.
6. **`test(bench): unit tests for new script handlers`** — vitest tests for the per-event measurement helper, column-config injection logic, comparator-unsupported plumbing.
7. **`chore(bench): run S2/hypothesis matrix; commit runset evidence`** — actual matrix output under `status/runsets/`. This commit is the "did the work happen" proof; no source changes.
8. **`docs: update repo-memory + remove deferred-memory entries`** — `docs/research/repo-memory.md` gets the new milestone entry. The two deferred-bench memory files (`project_phase7_bench_slab1_deferred.md`, `project_phase_d3_bench_deferred.md`) get removed (in `~/.claude/projects/.../memory/` — not in this repo) once their work is done. Also update `MEMORY.md` index.

## Test layering

- **Bench-runtime unit tests** (`apps/bench/src/__tests__/bench-runtime.test.ts`): the new per-event latency helper (`measureKeySequenceLatency` or similar) is covered by a deterministic test using fake timers.
- **Bench-matrix evaluator unit tests** (`scripts/__tests__/bench-matrix.test.mjs`): each new `evaluateHnn` function is covered with a synthetic runset fixture that exercises pass / fail / insufficient paths.
- **Adapter integration**: the existing pretable-adapter test pattern verifies the bench mount flow with the new column configs (cell-renderer scripts).
- **Hypothesis runset evidence**: the run plan's actual matrix invocation produces the proof that hypotheses are satisfied. Committed under `status/runsets/` per existing precedent.

## Exit criteria

- Six new hypotheses evaluated by `bench-matrix.mjs`. All `satisfied` per their thresholds across repeated `S2/hypothesis` runs.
- Runset evidence committed under `status/runsets/<runset-id>/`. Independently verifiable.
- No regression in existing hypotheses (H1, H5, H6, H7, H8, H9–H12, H13–H15) on the same runset. The H1 (scroll wedge) result on the `S2/scroll/pretable` slice in this runset must still be satisfied.
- `docs/research/repo-memory.md` updated with the new milestone entry.
- `pnpm -w typecheck` / `test` / `lint` / `format` clean.
- One PR opened, CI green, user merges.

## Open items deferred elsewhere

- Comparative bench Slab 2 for selection/nav (vs AG Grid / TanStack / MUI X) — future B2 sub-project.
- Comparative bench Slab 2 for cell renderers — future sub-project, parallel to B2.
- Public API stabilization (sub-project A) — paused 2026-05-07 to do this bench work; picks up after this PR merges.
- Cell editing — separate D-edit sub-project; separate brainstorm.
- Right-pinning, column groups, column visibility — separate sub-projects.
