# Pretable Wrapped-Text Filter Perf Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Identify what consumes pretable's 17 ms p95 budget on `filter-text` (Chromium S2/hypothesis n=20). Memo output; conditional fix if a single-cause low-risk candidate falls out of the trace.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-05-13-pretable-wrapped-text-filter-perf-diag-design.md`. Single PR.

**Working directory:** `/Users/blove/repos/pretable/.worktrees/wrapped-text-filter-perf-diag`.

**Spec:** [`docs/superpowers/specs/2026-05-13-pretable-wrapped-text-filter-perf-diag-design.md`](../specs/2026-05-13-pretable-wrapped-text-filter-perf-diag-design.md)

---

## File Structure

```
status/traces/
└── 2026-05-13-pretable-filter-text-perf.trace.zip      (NEW Phase A)

docs/research/
└── 2026-05-13-pretable-wrapped-text-filter-perf-diagnostic.md   (NEW Phase C)

# CONDITIONAL on Phase D firing:
status/milestones/
└── 2026-05-13-pretable-filter-text-postfix.json        (NEW only if fix shipped)

packages/<area>/src/<file>.ts                            (NEW only if fix shipped)
```

---

## Pre-flight

- [ ] **0.1** Free port 4173 (prior matrix runs may leak the preview server):
  ```
  lsof -ti tcp:4173 | xargs -r kill -9
  ```
- [ ] **0.2** Build the harness:
  ```
  pnpm --filter @pretable/app-bench build
  ```

---

## Phase A — Trace capture

### Task 1 — Run filter-text with tracing on

- [ ] **1.1** Run via Playwright spec directly (matrix-runner-bypassed for reliability):

  ```
  PRETABLE_BENCH_ADAPTER=pretable \
    PRETABLE_BENCH_SCENARIO=S2 \
    PRETABLE_BENCH_SCALE=hypothesis \
    PRETABLE_BENCH_SCRIPT=filter-text \
    pnpm --filter @pretable/app-bench exec playwright test --workers=1
  ```

  Note: the existing `bench.spec.ts` already calls `page.context().tracing.start({ screenshots: true, snapshots: true })` and stops it at the end with `tracingstop({ path: tracePath })`. Trace gets written to `status/traces/<auto-filename>.trace.zip` via `createRunArtifactFileStem`.

- [ ] **1.2** Locate the most recent trace:

  ```
  ls -lt status/traces/chromium-pretable-default-s2-hypothesis-filter-text-2026-05-13*.trace.zip | head -1
  ```

- [ ] **1.3** Copy + rename to the spec's canonical path:

  ```
  cp <latest-trace> status/traces/2026-05-13-pretable-filter-text-perf.trace.zip
  ls -lh status/traces/2026-05-13-pretable-filter-text-perf.trace.zip
  ```

  Size budget: 5–25 MB. If >25 MB, see Step 1.4.

- [ ] **1.4 (oversized fallback)** If >25 MB:
  - Open with `pnpm exec playwright show-trace <path>`.
  - Screenshot the Performance panel during steady-state.
  - Save screenshots under `docs/research/2026-05-13-perf-diag-traces/`.
  - Don't commit the trace zip.

- [ ] **1.5** Verify trace opens:

  ```
  pnpm exec playwright show-trace status/traces/2026-05-13-pretable-filter-text-perf.trace.zip
  ```

  A browser window should open. Quit with `q`. If trace fails to open, STOP and report BLOCKED.

- [ ] **1.6** Commit the trace:
  ```
  git add status/traces/2026-05-13-pretable-filter-text-perf.trace.zip
  git commit -m "chore(bench): Playwright trace for pretable filter-text perf diagnostic"
  ```

---

## Phase B — Trace analysis

### Task 2 — Inspect the trace

- [ ] **2.1** Open the trace:

  ```
  pnpm exec playwright show-trace status/traces/2026-05-13-pretable-filter-text-perf.trace.zip
  ```

- [ ] **2.2** Find the steady-state interaction window in the trace timeline. The bench's filter-text script:
  1. Mounts the adapter.
  2. Lets ~500 ms of warmup pass.
  3. Programmatically applies the filter via `setInteractionPlanOverride` → React state update.
  4. Polls frame-by-frame for the visible-row signature to change.
  5. Marks the first changed frame as `interaction_latency_ms`.

  Skip the mount + warmup. The interesting window is the ~17 ms between the trigger dispatch and the first changed frame.

- [ ] **2.3** Identify the longest scripting tasks in that window. For each:
  - Duration (ms).
  - Top of call stack (function name).
  - File path (if visible).
  - Classify the phase: `derivation` (`deriveVisibleRows` and friends), `reconciliation` (React render work), `virtualization` (visible-window math), `dom-update` (cell mounts / unmounts / property writes).

- [ ] **2.4** Save findings to `/tmp/filter-text-trace-findings.md`:

  ```
  ## Trace breakdown — pretable filter-text n=1 sample

  | Task | Duration (ms) | Phase | File |
  | --- | --- | --- | --- |
  | <top-stack name> | <X.X> | derivation | packages/grid-core/... |
  | ...
  ```

  Don't commit this scratch file; it's input for Phase C.

- [ ] **2.5** If the trace cannot be opened or interpreted, STOP and report BLOCKED. The memo can ship with verdict "real-but-undiagnosed; needs human-driven profiling."

---

## Phase C — Memo

### Task 3 — Draft the memo

- [ ] **3.1** Create `docs/research/2026-05-13-pretable-wrapped-text-filter-perf-diagnostic.md`:

  ```markdown
  # Pretable wrapped-text filter perf diagnostic — 2026-05-13

  ## Summary

  <1–2 sentences: what consumes the budget; leading hypothesis>

  ## Context

  PR #134 verdict (n=20, Chromium S2/hypothesis):

  - sort: 17.10 ± 1.83 ms
  - filter-metadata: 17.51 ± 2.44 ms
  - filter-text: 16.79 ± 0.31 ms

  All three reliably over the 16 ms single-frame budget. PR #141 reframed the homepage prose to acknowledge over-budget honestly while emphasizing the 2-3.5× comparator wedge. This memo identifies what the budget is actually spent on.

  ## Method

  - Trace: `status/traces/2026-05-13-pretable-filter-text-perf.trace.zip`.
  - Single sample at hypothesis scale (3,000 wrapped-text rows).
  - Filter-text picked for tracing because it has the tightest σ at n=20 (0.31 ms) — cleanest signal.

  ## Trace breakdown

  | Task | Duration (ms) | Phase | File |
  | ---- | ------------- | ----- | ---- |

  | <from /tmp/filter-text-trace-findings.md>

  ## Hypothesis for the gap

  <1–3 paragraphs identifying the dominant cause. Likely candidates:

  - deriveVisibleRows running synchronously on every render
  - React reconciliation across many cells when the visible row list changes shape
  - Virtualization recompute when the result-row-count shrinks/grows
  - DOM updates for newly-mounted vs unmounted cells>

  ## Why sort + filter-metadata likely share this cause

  <One paragraph extending the analysis to the other two scripts that also miss budget.>

  ## Proposed fixes (no code in this PR yet — see Verdict)

  | Option | Description                                                           | Expected delta | Risk to quality wedge | Complexity   |
  | ------ | --------------------------------------------------------------------- | -------------- | --------------------- | ------------ |
  | 1      | <e.g., "Memoize deriveVisibleRows by (rows, filters, sort) identity"> | <delta>        | <risk>                | <complexity> |

  ## Verdict

  <one of:

  - "Fix shipped in this PR — <X>. See Phase D below."
  - "No single-cause hotspot. Memo-only output. Follow-up PR scoped to <Y> per the proposed-fixes table.">

  ## Phase D (only if fix shipped)

  <code change description + before/after matrix numbers + verification that quality metrics unchanged>
  ```

- [ ] **3.2** Replace `<placeholder>` strings with actual content from Phase B.

- [ ] **3.3** Commit:
  ```
  git add docs/research/2026-05-13-pretable-wrapped-text-filter-perf-diagnostic.md
  git commit -m "docs(research): pretable wrapped-text filter perf diagnostic memo"
  ```

---

## Phase D (conditional) — Ship a fix

**Skip this entire phase unless ALL gates in the spec's Phase D section hold:**

1. One obvious code change in one file.
2. Doesn't touch the quality wedge (zero blank gaps, anchor stability, ≤1 px row-height).
3. Re-running the matrix confirms latency delta ≥ 2 ms.
4. No public-API change.

### Task 4 — Implement the fix (only if all gates hold)

- [ ] **4.1** Implement the fix. Likely candidates per the spec's hypotheses:
  - Memoization of `deriveVisibleRows` keyed on row+filter+sort identity (avoids re-derivation when only an unrelated prop changes).
  - `useDeferredValue` on the filtered-row list (lets React yield between filter application and full reconciliation).
  - Lazy cell-value reads in `matchesFilters` (cache `readCellValue(row, column)` per row across columns).

- [ ] **4.2** Repo-wide gates:

  ```
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```

  All pass.

- [ ] **4.3** Re-run matrix for verification:

  ```
  PRETABLE_BENCH_ADAPTER=pretable \
    PRETABLE_BENCH_SCENARIO=S2 \
    PRETABLE_BENCH_SCALE=hypothesis \
    PRETABLE_BENCH_SCRIPT=filter-text \
    pnpm --filter @pretable/app-bench exec playwright test --workers=1
  ```

  Repeat × 20 (run a loop, or kick the matrix runner with `--adapters=pretable --scripts=filter-text --repeats=20`).

- [ ] **4.4** Aggregate the post-fix latency:

  ```bash
  node --input-type=module <<'EOF'
  import { readdir, readFile } from "node:fs/promises";
  import { join } from "node:path";

  const files = (await readdir("status")).filter(
    (f) =>
      f.startsWith(
        "chromium-pretable-default-s2-hypothesis-filter-text-2026-05-13",
      ) && f.endsWith(".summary.json"),
  );
  const samples = [];
  for (const f of files) {
    const data = JSON.parse(await readFile(join("status", f), "utf8"));
    const v = data.metrics?.interaction_latency_ms;
    if (typeof v === "number") samples.push(v);
  }
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  console.log(JSON.stringify({ n, mean: +mean.toFixed(3), sd: +sd.toFixed(3) }));
  EOF
  ```

- [ ] **4.5** Compare to PR #134 baseline (16.79 ± 0.31 ms). If mean drops by ≥ 2 ms AND quality metrics (blank_gap_frames, scroll_anchor_shift_backward_p95_px, row_height_error_p95_px) unchanged, proceed. Otherwise revert the fix and update the memo's Verdict to "fix didn't deliver expected delta; deferred to follow-up."

- [ ] **4.6** Document the post-fix numbers + quality verification in the memo's Phase D section.

- [ ] **4.7** Save a post-fix milestone:

  ```
  cp status/runsets/<id>/hypotheses.json status/milestones/2026-05-13-pretable-filter-text-postfix.json
  ```

- [ ] **4.8** Commit the fix + verification:

  ```
  git add packages/<area>/src/<file>.ts status/milestones/2026-05-13-pretable-filter-text-postfix.json docs/research/2026-05-13-pretable-wrapped-text-filter-perf-diagnostic.md
  git commit -m "perf(<area>): <description of fix> for wrapped-text filter pipeline

  <one paragraph on the change>

  Before: filter-text 16.79 ± 0.31 ms (n=20)
  After:  filter-text <X.X> ± <X.X> ms (n=20)
  Delta:  -<X.X> ms

  Quality wedge unchanged (blank gaps 0, anchor shift 0, row-height ≤ 1 px).
  No public-API surface change."
  ```

---

## Task 5 — Gates + PR

- [ ] **5.1** Repo-wide gates:

  ```
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```

  All pass.

- [ ] **5.2** Push + open PR:

  ```
  git push -u origin wrapped-text-filter-perf-diag
  gh pr create --title "<title>" --body "<body>"
  ```

  PR title:
  - If Phase D fired: `perf(<area>): <fix description> for wrapped-text filter pipeline`.
  - If memo-only: `docs(research): pretable wrapped-text filter perf diagnostic`.

  PR body covers: summary, trace findings, leading hypothesis, what's in the PR (memo + optional fix), what's NOT.

- [ ] **5.3** Auto-merge decision:
  - **Memo-only (Phase D skipped):** set auto-merge (`gh pr merge --auto --squash`). Negative-result memo is uncontroversial.
  - **Phase D fired:** HOLD for user review. Code change in grid-core / react packages deserves a code review.

  Surface the decision in your end-of-task report.

---

## Self-review

- Spec coverage: Phase A (trace capture) → Task 1; Phase B (analysis) → Task 2; Phase C (memo) → Task 3; Phase D (conditional fix) → Task 4. Auto-merge gate → Task 5.3. ✓
- No placeholders outside the memo template (those are intentional).
- Scope: single PR, three required phases + conditional fix. Auto-mergeable for memo-only; held for review on a fix.

---

## Notes for the implementer

- Filter-text is the cleanest signal (σ = 0.31 ms at n=20). If the memo's findings should generalize to sort + filter-metadata, the verdict's "Why sort + filter-metadata likely share this cause" section captures the cross-script narrative.
- Phase D's gate is strict because pretable's quality wedge is the project's North Star. A fix that gains 3 ms but adds 1 blank gap is not a fix.
- Don't try `--repeats=50` or other off-plan adjustments. n=20 is the established protocol from PR #124 / PR #134.
- If the trace can't be opened (Playwright trace viewer crashes, file is corrupted), report BLOCKED. The memo can ship with verdict "real-but-undiagnosed."
