# Scroll-Extent Instrument Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure the estimator's *bias*, not just its per-row error, and use that number to settle whether the learned floor should be a max or a mean.

**Architecture:** No new data capture. Mean absolute error — what the existing instrument reports — is blind to systematic bias by construction. The scroll-extent question is the **signed** aggregate over the same 48 rows: `Σestimate − Σmeasured`. Adding that aggregation answers the open question with data we already hold.

**Tech Stack:** TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-estimator-real-inputs-design.md`, "Open question, deliberately not settled here".

**Branch:** `blove/scroll-extent-instrument`, off `main` at `7c55272b`.

---

## Context

After #342, a visible row's estimate is a **one-frame placeholder** — the DOM measures it within a frame of appearing. What persists is the **scroll extent**: the sum of estimates across thousands of rows that have never rendered, which sets the scrollbar and every row offset.

Per-row accuracy and aggregate accuracy can prefer opposite answers. A floor that is a running **max** is biased high by construction: it over-estimates rows whose true height sits below the maximum. That is nearly harmless per-row — a pixel or two on a row about to be measured anyway — and it compounds across 100k rows into a scroll extent that is meaningfully too tall.

Phase A measured the per-row objective and found the max floor better: **3.500px mean error vs 3.708px** for a mean floor. That is real, but it says nothing about bias, because a mean of *absolute* errors cannot distinguish "wrong in both directions" from "wrong in one".

**This is a measurement task, not a fix.** It ends with a number and a recommendation. Changing the floor is a separate decision that this number informs.

**Existing instrument:** `packages/renderer-dom/src/__tests__/row-height-accuracy.test.ts` over `row-height-accuracy.fixture.ts` — 48 rows captured from the homepage hero in Chromium, each carrying real `text`, `widthPx`, `heightPx` and a directly-measured `lineCount`. It currently reports mean `|estimate − measured|` and per-row line-count accuracy. Current state: **47/48 line counts, 3.5px mean error**.

**Commands:**

```bash
pnpm --filter @pretable-internal/renderer-dom test
```

Package scripts build dependencies first; a bare `vitest run` reads a stale `dist/`.

Never run `git stash` — the stash stack is shared across worktrees.

---

## Task 1: Add the bias aggregation

**Files:**
- Create: `packages/renderer-dom/src/__tests__/row-height-bias.test.ts`

- [ ] **Step 1: Write the test**

A new file rather than more assertions in the accuracy test, because it answers a different question and should be readable on its own.

It must report, over the whole fixture, for both floor policies:

- **Signed aggregate error**: `Σestimate − Σmeasured`, in px.
- **Relative extent error**: that sum divided by `Σmeasured`, as a percentage. This is the number that matters — it is what a scrollbar is wrong by.
- **Directional split**: how many rows are over-estimated, how many under, how many exact. A mean absolute error of 3.5px built from 48 over-estimates is a different animal from one built from 24 in each direction.

Compute each twice: once with the floor as it ships today (a running **max** over ≤1-line rows), once with a running **mean**. Reuse `createRowHeightCalibration` for the max, and compute the mean floor directly in the test rather than modifying the module — this task changes no production code.

`console.log` every figure. The numbers are the deliverable; the assertions only stop the file rotting.

Assert only what must not silently change:
- the fixture still has at least 48 samples,
- the shipped configuration's relative extent error is finite and its sign is reported.

Do **not** assert that one policy beats the other. That is the question, not a known answer — writing an assertion for it would pin whichever answer happened to be true on the day.

- [ ] **Step 2: Run it**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run src/__tests__/row-height-bias.test.ts
```

Record every printed figure.

- [ ] **Step 3: Interpret, and recommend**

| Observation | Reading |
| --- | --- |
| Max floor's relative extent error materially positive, mean floor's nearer zero | The two objectives conflict as predicted. Recommend the mean **if** the per-row cost is small relative to the extent gain, and say what each costs. |
| Both near zero | Bias is not a live problem at this scale; keep the max, which wins per-row. |
| Max floor's error negative, or mean's worse on both | The prediction was wrong. Report it plainly — that is more valuable than the expected result. |

State the trade in pixels and percent, not adjectives: "the max floor costs X% of scroll extent to buy Y px of per-row accuracy" is the sentence this task exists to produce.

- [ ] **Step 4: Note the sample's limits honestly**

48 rows from one grid, all of which *were* rendered. Real scroll extent is dominated by rows that never render. The **bias direction** generalises — it is a property of the estimator function, not of the sample — but the **magnitude** does not, because a different grid has a different mix of wrapped and unwrapped rows.

Write that into the test file's header comment, so nobody later quotes the percentage as though it were a universal constant.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer-dom/src/__tests__/row-height-bias.test.ts
git commit -m "test(renderer-dom): measure estimator bias, not just per-row error"
```

---

## Task 2: Verify and PR

- [ ] **Step 1: Full suites**

```bash
pnpm --filter @pretable-internal/renderer-dom test && pnpm --filter @pretable/react test
```

Expected: green. This task adds a test file and touches no production code, so anything else failing is unrelated — investigate before assuming.

- [ ] **Step 2: Repo checks**

```bash
pnpm typecheck && pnpm lint && pnpm format
```

No changeset: this is test-only and ships nothing to consumers. Say so in the PR body rather than adding an empty one.

- [ ] **Step 3: Check `main` for drift**

```bash
git fetch origin && git log --oneline -3 origin/main
```

Parallel sessions land PRs here frequently. Rebase and re-run if it moved.

- [ ] **Step 4: Open the PR**

Lead the body with the measured figures and the recommendation. Make clear this changes no behaviour — it exists so the max-vs-mean decision is made on evidence.

- [ ] **Step 5: Do not merge.** Report the URL and the numbers.

---

## Out of scope

Changing the floor policy. This task produces the number; the decision is separate and belongs to whoever reads it.
