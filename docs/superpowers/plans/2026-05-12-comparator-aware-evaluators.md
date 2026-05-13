# Comparator-Aware Evaluators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend six evaluators (H6, H7, H8, H19, H20, H21) in `scripts/bench-matrix.mjs` to include comparator evidence in their `evidence` arrays. Mirrors `evaluateH1`'s pattern. Status logic unchanged.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-05-12-comparator-aware-evaluators-design.md`. Single PR. Auto-merge if all six hypothesis statuses stay at their existing values; hold for review if any status flips.

**Tech Stack:** TypeScript, Node test runner, Playwright (Chromium). No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-12-comparator-aware-evaluators-design.md`](../specs/2026-05-12-comparator-aware-evaluators-design.md)

**Working directory:** `/Users/blove/repos/pretable/.worktrees/comparator-aware-evaluators`.

---

## File Structure

```
scripts/
├── bench-matrix.mjs                    (MODIFY: extend evaluateH6, H7, H8, H19, H20, H21)
└── __tests__/bench-matrix.test.mjs     (MODIFY: add comparator-evidence test per evaluator)

status/milestones/
└── 2026-05-12-comparator-aware-evaluators.hypotheses.json   (NEW: matrix re-run output)

docs/research/
└── repo-memory.md                       (MODIFY: 2026-05-12 entry — evaluator architecture)
```

---

## Task 1 — Read H1 as the reference shape

- [ ] **1.1** Open `scripts/bench-matrix.mjs` and locate `evaluateH1`. Note how it:
  - Uses `findRunSeries` to find pretable's series.
  - Uses `groupRunSeries(runs, { scenarioId, scriptName }).filter(s => s[0]?.adapterId !== "pretable")` to find competitor series.
  - Uses `summarizeRunSeriesEvidence(series)` to produce each evidence entry.
  - Picks a "best full-grid competitor" and a "best virtualization-primitive competitor" via `medianMetric` comparisons.
  - Returns `evidence: [pretableEvidence, bestFullGridEvidence, ...(bestPrimitiveEvidence ? [bestPrimitiveEvidence] : [])]`.

  This is the model. The six target evaluators will surface ALL comparator entries (not just the best per family) since the comparison story is different — for H6/H7/H8/H19/H20/H21 we want every comparator's number visible.

- [ ] **1.2** Read each of the six target evaluators (`evaluateH6`, `evaluateH7`, `evaluateH8`, `evaluateH19`, `evaluateH20`, `evaluateH21`) to understand the existing shape before editing.

## Task 2 — Helper for comparator-evidence lookup

- [ ] **2.1** Add a helper function near the top of the evaluator section of `scripts/bench-matrix.mjs` (above `evaluateH1`). Single helper, used by all six evaluators:

  ```js
  /**
   * Find comparator-adapter series for the given (scenarioId, scriptName)
   * slice and return their evidence summaries. Pretable is excluded —
   * callers are expected to construct pretable evidence separately. Each
   * returned entry is the same shape as summarizeRunSeriesEvidence's output,
   * matching the evidence-array contract used by all evaluators.
   *
   * Used by H6/H7/H8 (interaction) and H19/H20/H21 (cell-renderer) to
   * surface comparator metrics alongside pretable in their evidence arrays.
   * Status verdicts remain pretable-only; this data is informational.
   */
  function findComparatorEvidence(runs, { scenarioId, scriptName }) {
    const series = groupRunSeries(runs, { scenarioId, scriptName }).filter(
      (s) => s[0]?.adapterId && s[0].adapterId !== "pretable",
    );
    return series.map((s) => summarizeRunSeriesEvidence(s));
  }
  ```

- [ ] **2.2** Typecheck:
  ```
  pnpm --filter "@pretable-internal/bench-runner" typecheck
  ```
  Expected: passes. (bench-matrix.mjs is JS, not TS, so typecheck just covers the package; the .mjs is linted separately.)

## Task 3 — Extend H6 (sort)

- [ ] **3.1** In `evaluateH6` (around line 613), find the `return { id: "H6", ..., evidence: [...] }` shape.

- [ ] **3.2** Just before the return, compute comparator evidence:
  ```js
  const comparatorEvidence = findComparatorEvidence(runs, {
    scenarioId,
    scriptName: "sort",
  });
  ```

  Update each return statement in `evaluateH6` to spread `...comparatorEvidence` after the pretable evidence in the array. There may be multiple returns (insufficient / failing / satisfied branches); update them all.

  Skeleton (illustrative, adapt to actual evaluator code):
  ```js
  return {
    id: "H6",
    status: ...,
    summary: ...,
    evidence: [pretableEvidence, ...comparatorEvidence],
  };
  ```

  Note: for `insufficient` returns where `pretableEvidence` isn't built (no pretable series), keep the existing `evidence: []` — comparator data alone doesn't satisfy any version of H6.

- [ ] **3.3** Run the bench-matrix tests:
  ```
  node --test scripts/__tests__/bench-matrix.test.mjs
  ```
  Expected: all existing tests still pass. The evidence array now has more entries but existing tests check status + summary, not evidence-length.

- [ ] **3.4** Commit:
  ```
  git add scripts/bench-matrix.mjs
  git commit -m "feat(bench-matrix): H6 evaluator surfaces comparator evidence"
  ```

## Task 4 — Extend H7 (filter-metadata)

- [ ] **4.1** In `evaluateH7`, repeat the Task 3 pattern with `scriptName: "filter-metadata"`.

- [ ] **4.2** Run tests, commit:
  ```
  node --test scripts/__tests__/bench-matrix.test.mjs
  git add scripts/bench-matrix.mjs
  git commit -m "feat(bench-matrix): H7 evaluator surfaces comparator evidence"
  ```

## Task 5 — Extend H8 (filter-text)

- [ ] **5.1** Same pattern with `scriptName: "filter-text"`.

- [ ] **5.2** Run tests, commit `feat(bench-matrix): H8 evaluator surfaces comparator evidence`.

## Task 6 — Extend H19 (format overhead)

- [ ] **6.1** H19 is structured around comparing pretable's `scroll-with-format` p95 against pretable's `scroll` baseline. The comparator extension surfaces each comparator's `scroll-with-format` evidence (not deltas — see spec's non-goals; per-adapter format-vs-baseline deltas are a future enhancement).

  In `evaluateH19`, add the comparator lookup:
  ```js
  const comparatorEvidence = findComparatorEvidence(runs, {
    scenarioId: "S2",
    scriptName: "scroll-with-format",
  });
  ```

  Append `...comparatorEvidence` to each return's `evidence` array. Keep the existing pretable format + pretable scroll baseline entries at the front.

  Add a comment near the evidence array clarifying the semantics:
  ```js
  // evidence shape: [pretable format-overhead summary, pretable scroll
  // baseline summary, ...comparator scroll-with-format absolute summaries].
  // Pretable's first two entries form the format-overhead delta the H19
  // status verdict consumes; comparator entries are absolute format p95
  // for cross-adapter reference, NOT deltas vs their own scroll baselines.
  ```

- [ ] **6.2** Run tests, commit `feat(bench-matrix): H19 evaluator surfaces comparator format evidence`.

## Task 7 — Extend H20 (cheap-render scroll)

- [ ] **7.1** Same pattern with `scriptName: "scroll-with-render"`.

- [ ] **7.2** Run tests, commit `feat(bench-matrix): H20 evaluator surfaces comparator evidence`.

## Task 8 — Extend H21 (heavy-render scroll)

- [ ] **8.1** Same pattern with `scriptName: "scroll-with-heavy-render"`.

- [ ] **8.2** Run tests, commit `feat(bench-matrix): H21 evaluator surfaces comparator evidence`.

## Task 9 — Add test coverage

- [ ] **9.1** For each of the six evaluators, add ONE new test asserting the comparator-evidence behavior. Mirror an existing test (e.g., `evaluateH6 satisfied when pretable sort latency is under threshold`) but include comparator runs in the input, and assert:

  ```js
  test("evaluateH6 evidence array includes comparator entries when comparator runs are present", () => {
    const runs = [
      createInteractionRun({ adapterId: "pretable", scenarioId: "S2", scriptName: "sort", ... }),
      createInteractionRun({ adapterId: "ag-grid", scenarioId: "S2", scriptName: "sort", ... }),
      createInteractionRun({ adapterId: "tanstack", scenarioId: "S2", scriptName: "sort", ... }),
      createInteractionRun({ adapterId: "mui", scenarioId: "S2", scriptName: "sort", ... }),
    ];
    const result = evaluateH6(runs);
    expect(result.evidence.length).toBe(4); // pretable + 3 comparators
    expect(result.evidence.map((e) => e.adapterId).sort()).toEqual(
      ["ag-grid", "mui", "pretable", "tanstack"]
    );
  });
  ```

  Adapt the test helper invocation to whatever `createInteractionRun` / `createScrollRun` factory the test file already has. Read the file for the existing helper before writing the test.

- [ ] **9.2** Run all matrix-runner tests:
  ```
  node --test scripts/__tests__/bench-matrix.test.mjs
  ```
  Expected: 6 new tests pass; all existing tests still pass.

- [ ] **9.3** Commit:
  ```
  git add scripts/__tests__/bench-matrix.test.mjs
  git commit -m "test(bench-matrix): comparator-evidence assertions for H6/H7/H8/H19/H20/H21"
  ```

## Task 10 — Matrix re-run

- [ ] **10.1** Build the harness:
  ```
  pnpm --filter @pretable/app-bench build
  ```

- [ ] **10.2** Run the matrix:
  ```
  pnpm bench:matrix \
    --project=chromium \
    --adapters=pretable,ag-grid,tanstack,mui \
    --scenarios=S2 \
    --scripts=scroll,sort,filter-metadata,filter-text,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
    --scale=hypothesis \
    --repeats=3
  ```

  Use `Bash run_in_background: true` since this is ~5 min wall-clock. 7 scripts × 4 adapters × 3 repeats = 84 runs.

- [ ] **10.3** Wait for the matrix to complete (poll sparingly via `pgrep -f bench-matrix`). When done, locate the runset:
  ```
  ls -lt status/runsets/ | head -3
  ```

- [ ] **10.4** Read `status/runsets/<id>/hypotheses.json` and verify:
  - H1 status: matches existing milestone (satisfied at parity).
  - H6/H7/H8 status: each `satisfied` (pretable absolute thresholds unchanged).
  - H19/H20/H21 status: each `satisfied` (cell-renderer absolute thresholds unchanged).
  - Each of H6/H7/H8/H19/H20/H21 has 4 evidence entries (pretable + 3 comparators).
  - If any status flips unexpectedly, STOP and report DONE_WITH_CONCERNS — don't change thresholds.

- [ ] **10.5** Copy the runset to the milestone path:
  ```
  cp status/runsets/<id>/hypotheses.json status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json
  ```

- [ ] **10.6** Commit:
  ```
  git add status/milestones/2026-05-12-comparator-aware-evaluators.hypotheses.json
  git commit -m "chore(bench): matrix milestone for comparator-aware evaluators

  H6/H7/H8/H19/H20/H21 now embed comparator evidence in their evidence
  arrays. Pretable-only status verdicts unchanged."
  ```

## Task 11 — Repo-memory entry

- [ ] **11.1** Append a 2026-05-12 entry to `docs/research/repo-memory.md`:
  - Architecture summary: evaluators now embed comparator evidence; H1's pattern reused.
  - Status logic unchanged (pretable thresholds drive verdicts).
  - Test coverage extended for all six evaluators.
  - Matrix re-run committed at the new milestone path.
  - Note that the aggregator scripts from PRs #130/#131/#132 are now redundant for `hypotheses.json` consumers, but still feed the `/bench` page; a future PR can swap the page to read from `hypotheses.json` directly and retire the aggregators.

- [ ] **11.2** Commit:
  ```
  git add docs/research/repo-memory.md
  git commit -m "docs(research): repo-memory entry — comparator-aware evaluators"
  ```

## Task 12 — Gates + PR

- [ ] **12.1** Repo-wide gates:
  ```
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```
  Expected: all pass. The evaluator changes are JS in `scripts/`; typecheck doesn't cover them but lint does.

- [ ] **12.2** Push + open PR:
  ```
  git push -u origin comparator-aware-evaluators
  gh pr create --title "feat(bench-matrix): H6-H8 + H19-H21 evaluators embed comparator evidence" --body "..."
  ```

  PR body covers: summary, the evaluator shape change, the matrix re-run, what's NOT in this PR (no /bench page changes, no threshold changes, no aggregator-script retirement).

- [ ] **12.3** Auto-merge decision per the spec:
  - If all six hypotheses retained their existing `satisfied` status → `gh pr merge --auto --squash`.
  - If anything flipped → HOLD for user review (surface in the PR body and end-of-task report).

---

## Self-review

| Spec section | Plan task |
| --- | --- |
| Evaluator extension pattern | Tasks 2 (helper) + 3–8 (per-evaluator) |
| Per-evaluator slice definitions | Tasks 3–8 use the right (scenarioId, scriptName) tuple |
| Test updates | Task 9 |
| Matrix re-run | Task 10 |
| Sanity check on verdicts | Task 10.4 |
| H19 format-overhead semantics drift | Task 6.1 inline comment |

All sections covered.

No placeholders outside the PR-body template (those are intentional). Type/value consistency: `findComparatorEvidence` signature is consistent across all six callers; helper returns the same shape as `summarizeRunSeriesEvidence`.

Scope: single PR, 12 tasks, ~10 commits-of-record. Auto-mergeable unless verdicts flip.
