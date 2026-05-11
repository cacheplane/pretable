# Interaction Borderline Perf Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the n=3 verdicts on pretable `filter-text` 17.7 ms (1.7 ms over budget) and tanstack vs pretable `filter-metadata` 15.7 vs 16.0 ms (the only comparator tie). Pattern: PR #124 / PR #133. No code changes.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-05-11-interaction-borderline-perf-diag-design.md`. Single PR; auto-merge if all verdicts are noise/within-budget; hold for review if any verdict is real-over-budget or real-tanstack-faster.

**Tech Stack:** Existing matrix runner. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-11-interaction-borderline-perf-diag-design.md`](../specs/2026-05-11-interaction-borderline-perf-diag-design.md)

**Working directory:** `/Users/blove/repos/pretable/.worktrees/interaction-borderline-perf-diag`.

---

## File Structure

```
status/milestones/
└── 2026-05-11-interaction-borderline-high-repeat.json   (NEW Phase A)

docs/research/
└── 2026-05-11-interaction-borderline-perf-diagnostic.md (NEW Phase C — the memo)
```

No source code, package, or test files modified.

---

## Pre-flight

- [ ] **0.1** Build the harness:
  ```
  pnpm --filter @pretable/app-bench build
  ```
- [ ] **0.2** Confirm machine idle.

---

## Phase A — High-repeat re-run

### Task 1 — Run the matrix

- [ ] **1.1** Run:

  ```
  pnpm bench:matrix \
    --project=chromium \
    --adapters=pretable,tanstack \
    --scenarios=S2 \
    --scripts=filter-metadata,filter-text \
    --scale=hypothesis \
    --repeats=20
  ```

  Use `Bash` with `run_in_background: true` if the foreground would block too long; poll sparingly. Expected wall-clock 12–18 min.

- [ ] **1.2** Locate the per-run summary files:

  ```
  ls status/chromium-{pretable,tanstack}-default-s2-hypothesis-{filter-metadata,filter-text}-2026-05-11*.summary.json | wc -l
  ```

  Expected: up to 80 files. If matrix exited early, document the actual count in the memo.

### Task 2 — Aggregate + verdicts

- [ ] **2.1** Compute the stats + verdicts inline via Node script:

  ```bash
  node --input-type=module <<'EOF'
  import { readdir, readFile, writeFile } from "node:fs/promises";
  import { join } from "node:path";

  const FRAME_BUDGET_MS = 16;
  const ADAPTERS = ["pretable", "tanstack"];
  const SCRIPTS = ["filter-metadata", "filter-text"];
  const STATUS_DIR = "status";
  const OUT_PATH = "status/milestones/2026-05-11-interaction-borderline-high-repeat.json";

  function stats(xs) {
    const n = xs.length;
    if (n === 0) return { n: 0 };
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);
    const sorted = [...xs].sort((a, b) => a - b);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return {
      n,
      mean: +mean.toFixed(3),
      sd: +sd.toFixed(3),
      min: Math.min(...xs),
      median,
      max: Math.max(...xs),
    };
  }

  const files = await readdir(STATUS_DIR);
  const grid = {};
  for (const a of ADAPTERS) {
    grid[a] = {};
    for (const s of SCRIPTS) {
      const matching = files.filter(
        (f) =>
          f.startsWith(`chromium-${a}-default-s2-hypothesis-${s}-2026-05-11`) &&
          f.endsWith(".summary.json"),
      );
      const samples = [];
      for (const f of matching) {
        const data = JSON.parse(await readFile(join(STATUS_DIR, f), "utf8"));
        const v = data.metrics?.interaction_latency_ms;
        if (typeof v === "number" && Number.isFinite(v)) samples.push(v);
      }
      grid[a][s] = stats(samples);
    }
  }

  // Per-slice verdicts.
  const pretableFilterText = grid.pretable["filter-text"];
  const meanPlus2 = pretableFilterText.mean + 2 * pretableFilterText.sd;
  const meanMinus2 = pretableFilterText.mean - 2 * pretableFilterText.sd;
  const filterTextVerdict =
    meanPlus2 <= FRAME_BUDGET_MS
      ? "noise-within-budget"
      : meanMinus2 > FRAME_BUDGET_MS
        ? "real-over-budget"
        : "borderline-confirmed";

  const tanstackFM = grid.tanstack["filter-metadata"];
  const pretableFM = grid.pretable["filter-metadata"];
  const meanDiff = +(tanstackFM.mean - pretableFM.mean).toFixed(3);
  const noiseFloor = +(2 * Math.max(tanstackFM.sd, pretableFM.sd)).toFixed(3);
  const real = Math.abs(meanDiff) > noiseFloor;
  const filterMetadataVerdict = real
    ? meanDiff < 0
      ? "real-tanstack-faster"
      : "real-tanstack-slower"
    : "noise-tied";

  const out = {
    generatedAt: new Date().toISOString(),
    scenarioId: "S2",
    scale: "hypothesis",
    browserName: "chromium",
    plannedRepeats: 20,
    grid,
    slices: {
      pretableFilterTextOverBudget: {
        rule: `noise-within-budget if mean+2σ ≤ ${FRAME_BUDGET_MS}; real-over-budget if mean−2σ > ${FRAME_BUDGET_MS}; else borderline-confirmed`,
        mean: pretableFilterText.mean,
        sd: pretableFilterText.sd,
        meanPlus2: +meanPlus2.toFixed(3),
        meanMinus2: +meanMinus2.toFixed(3),
        budget: FRAME_BUDGET_MS,
        verdict: filterTextVerdict,
      },
      tanstackVsPretableFilterMetadata: {
        rule: "real if |mean_tanstack − mean_pretable| > 2 × max(σ_tanstack, σ_pretable)",
        meanDiff,
        noiseFloor,
        tanstackFasterIfReal: meanDiff < 0,
        verdict: filterMetadataVerdict,
      },
    },
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  EOF
  ```

- [ ] **2.2** Verify the output. Both verdicts populated; mean/σ finite per (adapter, script).

- [ ] **2.3** Commit:
  ```
  git add status/milestones/2026-05-11-interaction-borderline-high-repeat.json
  git commit -m "chore(bench): high-repeat milestone for interaction-borderline perf diag"
  ```

### Task 3 — Read verdicts; decide auto-merge

- [ ] **3.1** Read the two slice verdicts:

  ```
  jq '.slices | {ft: .pretableFilterTextOverBudget.verdict, fm: .tanstackVsPretableFilterMetadata.verdict}' status/milestones/2026-05-11-interaction-borderline-high-repeat.json
  ```

- [ ] **3.2** Decide auto-merge gate:
  - Auto-merge if BOTH verdicts are `noise-*` (filter-text noise-within-budget; filter-metadata noise-tied).
  - Auto-merge if filter-text is `noise-within-budget` AND filter-metadata is `real-tanstack-slower` (negative finding for tanstack; no homepage update needed).
  - **HOLD for user review** if filter-text is `real-over-budget` OR `borderline-confirmed`, OR if filter-metadata is `real-tanstack-faster`. Both imply potential homepage prose changes.

  Note the decision for Task 5's PR-open step.

---

## Phase C — Memo

### Task 4 — Write the memo

- [ ] **4.1** Draft the memo at `docs/research/2026-05-11-interaction-borderline-perf-diagnostic.md`:

  ```markdown
  # Interaction borderline perf diagnostic — 2026-05-11

  ## Summary

  - **pretable filter-text:** <verdict>. <one-line>.
  - **tanstack vs pretable filter-metadata:** <verdict>. <one-line>.

  ## Context

  PR #131's n=3 interaction matrix produced two borderline numbers:

  - pretable `filter-text` at 17.7 ms (1.7 ms over the 16 ms single-frame budget).
  - tanstack `filter-metadata` at 15.7 ms vs pretable 16.0 ms — the only place a comparator edged pretable.

  Both within ±2 ms of budget at n=3; p95 of 3 samples is essentially max-of-3. PR #124 and PR #133 set the precedent that small p95 gaps in this harness are almost always noise. This memo tightens the signal.

  ## Method

  - Matrix: `pnpm bench:matrix --project=chromium --adapters=pretable,tanstack --scenarios=S2 --scripts=filter-metadata,filter-text --scale=hypothesis --repeats=20`.
  - Hardware: <local laptop>.
  - Background load: <any unavoidable processes>.
  - Two tests:
    1. **pretable filter-text over-budget check.** `noise-within-budget` if `mean + 2σ ≤ 16 ms`; `real-over-budget` if `mean − 2σ > 16 ms`; `borderline-confirmed` if neither.
    2. **tanstack vs pretable filter-metadata parity check.** Standard 2σ test on mean difference.

  ## High-repeat data

  | (adapter, script)         | n   | mean (ms) | σ (ms) | min   | median | max   |
  | ------------------------- | --- | --------- | ------ | ----- | ------ | ----- |
  | pretable, filter-text     | <n> | <X.X>     | <X.X>  | <X.X> | <X.X>  | <X.X> |
  | pretable, filter-metadata | <n> | <X.X>     | <X.X>  | <X.X> | <X.X>  | <X.X> |
  | tanstack, filter-text     | <n> | <X.X>     | <X.X>  | <X.X> | <X.X>  | <X.X> |
  | tanstack, filter-metadata | <n> | <X.X>     | <X.X>  | <X.X> | <X.X>  | <X.X> |

  Source: `status/milestones/2026-05-11-interaction-borderline-high-repeat.json`.

  ## Per-slice verdicts

  ### pretable filter-text over-budget

  - mean = <X.X> ms, σ = <X.X> ms, mean+2σ = <X.X>, mean−2σ = <X.X>, budget = 16 ms.
  - Verdict: **<noise-within-budget | real-over-budget | borderline-confirmed>**.
  - <Interpretation: was the 17.7 ms n=3 reading a bad-frame artifact? / is pretable's filter-text path reliably over budget?>

  ### tanstack vs pretable filter-metadata parity

  - tanstack mean = <X.X> ± <X.X> ms; pretable mean = <X.X> ± <X.X> ms.
  - mean diff (tanstack − pretable) = <X.X> ms; 2σ noise floor = <X.X> ms.
  - Verdict: **<noise-tied | real-tanstack-faster | real-tanstack-slower>**.
  - <Interpretation: the n=3 0.3 ms diff was noise / tanstack is genuinely faster on latency by N ms / etc.>
  - Settle-time confound note: PR #131 measured tanstack settle at 26.5 ms vs pretable 16.7 ms (1.6× slower). Even if tanstack edges pretable on latency alone, total time-to-stable is longer.

  ## Interpretation

  <One paragraph per slice on what the verdict implies for the project narrative + homepage prose. If both are noise, the memo concludes that PR #131's borderlines are now confidently within their bands.>

  ## Recommendations

  - **If filter-text is `noise-within-budget`:** update the `/bench` page Interactions section prose from "fractionally over on filter-text" to a more honest "within the frame budget at n=20."
  - **If filter-text is `real-over-budget`:** scope a perf-fix PR investigating pretable's `filter-text` path; likely candidates are the wrapped-text filter row-model recomputation or post-filter scroll-anchor work.
  - **If filter-text is `borderline-confirmed`:** schedule a profiling pass; the number is right at the edge.
  - **If filter-metadata is `noise-tied`:** no narrative change needed; PR #131's "filter-metadata ties pretable" framing is accurate.
  - **If filter-metadata is `real-tanstack-faster`:** consider updating the homepage trail-marker label for tanstack to mention the filter-metadata lead explicitly; also note tanstack's slower settle as the offsetting cost.
  - **If filter-metadata is `real-tanstack-slower`:** drop the "filter-metadata ties pretable" note from the homepage; pretable is unambiguously faster.

  ## Verdict

  <one of:

  - "Both borderlines are noise; PR #131's n=3 readings were sampling artifacts."
  - "Pretable filter-text is real-over-budget; recommend a perf-fix PR." (etc.)>
  ```

- [ ] **4.2** Replace all `<placeholder>` strings with real numbers from the milestone JSON.

- [ ] **4.3** Commit:
  ```
  git add docs/research/2026-05-11-interaction-borderline-perf-diagnostic.md
  git commit -m "docs(research): interaction borderline perf diagnostic memo"
  ```

---

## Task 5 — Gates + PR

- [ ] **5.1** Repo-wide gates:

  ```
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```

  Expected: all pass (no source changes).

- [ ] **5.2** Push + open PR:

  ```
  git push -u origin interaction-borderline-perf-diag
  gh pr create --title "docs(research): interaction borderline perf diagnostic" --body "..."
  ```

- [ ] **5.3** Auto-merge per Task 3.2's decision:
  - Both verdicts noise/tanstack-slower → `gh pr merge --auto --squash`.
  - Anything else → HOLD; surface the verdict to the user in the end-of-task report.

---

## Self-review

| Spec section       | Plan task           |
| ------------------ | ------------------- |
| Phase A matrix     | Task 1              |
| Per-slice verdicts | Task 2.1 + Task 3   |
| Memo               | Task 4              |
| Auto-merge gate    | Task 3.2 + Task 5.3 |

No placeholders outside the memo template (those are intentional). Type/value consistency: paths consistent; verdict enum values consistent between Task 2.1 compute + Task 3.2 branch + Task 4 memo + Task 5.3 gate.
