# Estimate-Stomping Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `@pretable-internal/renderer-dom` from applying an estimated row height on top of a row it has already measured, which is what makes the homepage hero grid jitter under streaming.

**Architecture:** The row-layout controller stages measurements during a model replacement and discards them when the row is updated, then falls back to `estimateDomRowHeight`. The fix retains the last measured height per row identity and uses it as the fallback, so an estimate is only ever used for a row that has never been measured. The scheduler, the sliced catch-up, and the staging discard are deliberately untouched.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces. The decisive test is a pure unit test in `packages/renderer-dom` — no browser required.

**Spec:** `docs/superpowers/specs/2026-08-12-row-height-estimate-stomping-design.md`

---

## Context an engineer needs before starting

**The defect, in one paragraph.** `packages/renderer-dom/src/row-layout-controller.ts` publishes a row's height from one of two sources: a real DOM measurement fed in via `controller.measure(ref, height)`, or `estimateDomRowHeight` (`create-renderer.ts`), a character-count heuristic used for rows that have never been on screen. While a model replacement is in flight, `measure` only *stages* the measurement; on an `update` operation for that row the staged entry is discarded (`applyOperation`, the `else` branch, `staged.capturedRevision < revision`). The row then reports `hasMeasurement === false`, and the estimate gate (search `!root.hasMeasurement(ref)`, ~line 487) fills in an estimate. Under 60Hz streaming this fires every tick, so a measured row is repeatedly re-published at the estimator's height and corrected one commit later.

**The numbers**, measured in Chrome against the hero grid over 8 seconds: the measurement path produced `63`/`89`/`68`; the DOM received `63`, `66`, `114`, `89`, `68`. `66` and `114` were published 71 times and measured zero times, and both reconcile exactly with the estimator's constants (`1×24+42` and `3×24+42`).

**What must NOT change.** `hasMeasurement(ref)` must still become `false` after an update. An existing test pins that (`indexed-renderer.test.ts`, "replays exact journals atomically, retains moves, and invalidates every update", the final assertion). This fix does not restore the measurement — it changes only what height is used as the fallback. If you find yourself editing that assertion, you have taken the wrong approach; stop and report.

**Commands (from the repo root):**

```bash
pnpm --filter @pretable-internal/renderer-dom test
```

```bash
pnpm --filter @pretable-internal/renderer-dom typecheck && pnpm --filter @pretable-internal/renderer-dom lint
```

A single test by name:

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run -t "<test name>"
```

Note the package scripts build `text-core`, `layout-core` and `grid-core` first. A bare `vitest run` can read a stale `dist/` and pass vacuously — use the package script for anything you intend to believe.

**Existing test harness.** `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts` already has everything needed: `createModel`, `createReadyController`, `ManualScheduler`, and a `data(rowId)` ref helper. Reuse them; do not build a second harness.

**Never run `git stash`** in this repo — the stash stack is shared across worktrees and a parallel session can steal the entry.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts` | Gains the reproduction test and its mutation counterweight. Existing tests unchanged. | 1, 3 |
| `packages/renderer-dom/src/row-layout-controller.ts` | Retains the last measured height per identity; consults it at the estimate gate; evicts on remove/dispose. | 2 |
| `apps/website/e2e/hero-row-height-probe.spec.ts` | Throwaway browser confirmation. Deleted in Task 4. | 4 |

---

## Task 1: Reproduce the defect in a unit test — GATE

Nothing else starts until this test fails for the right reason. If it passes, the design is wrong: **stop and report** rather than adjusting the test until it fails.

**Files:**
- Modify: `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts`

- [ ] **Step 1: Write the reproduction test**

Add this test inside the existing `describe("indexed DOM row layout controller", ...)` block, immediately after the test named `"replays exact journals atomically, retains moves, and invalidates every update"`:

```ts
  test("an updated row falls back to its last measurement, not to an estimate", () => {
    // The bug this pins: `measure` is staged during a replacement and discarded
    // when the row is updated, after which the estimate gate treats a row we
    // have measured dozens of times as one we have never seen. Under streaming
    // that fires every tick, so the row is republished at the estimator's
    // height and corrected one commit later — visible as jitter.
    //
    // The measurement is still correctly invalidated (`hasMeasurement` stays
    // false, pinned below). What must change is the FALLBACK: the last height
    // we measured is stale by one frame; the estimator's number is wrong by a
    // different metric model.
    const model = createModel([
      { id: 1, team: "A", score: 1, label: "one" },
      { id: 2, team: "A", score: 2, label: "two" },
      { id: 3, team: "B", score: 3, label: "three" },
    ]);
    const { controller, scheduler } = createReadyController(model);

    controller.measure(data(2), 91);
    scheduler.flushAll();
    expect(controller.getState().rowHeights.hasMeasurement(data(2))).toBe(true);

    model.applyTransaction({
      update: [{ id: 2, changes: { label: "changed" } }],
    });
    scheduler.flushAll();

    const rank = model.getState().snapshot.indexOf(data(2));

    // The measurement is invalidated — that contract is unchanged.
    expect(controller.getState().rowHeights.hasMeasurement(data(2))).toBe(
      false,
    );
    // But the height must not regress to arithmetic.
    expect(controller.getState().rowHeights.getHeight(rank)).toBe(91);
  });
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run -t "falls back to its last measurement"
```

Expected: FAIL on the final assertion, with a received value that is NOT 91.

- [ ] **Step 3: Confirm the failure is the estimator, not something else**

Temporarily add this line just before the final assertion and re-run:

```ts
    console.log(
      "received",
      controller.getState().rowHeights.getHeight(rank),
      "estimator says",
      estimateDomRowHeight(
        model.getState().snapshot.rowAt(model.getState().snapshot.indexOf(data(2)))!,
        renderColumns,
      ),
    );
```

If `rowAt` is not the right accessor on this snapshot type, find the correct one by reading the model's snapshot interface rather than guessing — and if you cannot obtain the row object cleanly, it is acceptable to log only the received height and compare it by hand against `estimateDomRowHeight`'s arithmetic (`lines × 24 + 42`, characters ÷ 7 ÷ column width, floor `DEFAULT_ROW_HEIGHT`).

**The gate:** the received height must match the estimator's output for that row. If it matches neither the estimator nor 91, **STOP and report** — something other than the estimate gate is publishing the height, and the spec's mechanism is wrong.

Remove the `console.log` before continuing.

- [ ] **Step 4: Do not commit yet.** The test is committed with the fix in Task 2.

---

## Task 2: Retain the last measured height and use it as the fallback

**Files:**
- Modify: `packages/renderer-dom/src/row-layout-controller.ts`

- [ ] **Step 1: Add the retention map**

Find the declaration of `stagedMeasurements` (~line 310):

```ts
  const stagedMeasurements = new Map<string, StagedMeasurement<TRowId>>();
```

Add immediately after it:

```ts
  // The last height the DOM reported for a row, by identity.
  //
  // A staged measurement is discarded when its row is updated, which is correct
  // — the row's content changed, so the measurement may be stale. What is not
  // correct is falling back to `estimateDomRowHeight` from there: an estimate is
  // for a row we have never seen, and this is a row we have measured. Under
  // streaming the discard fires every tick, so without this the grid republishes
  // measured rows at the estimator's height sixty times a second and corrects
  // each one a commit later.
  //
  // Retained rather than restored: `hasMeasurement` still goes false, because
  // the measurement genuinely is stale until the DOM re-measures. This only
  // supplies a better number for the interval in between.
  const lastMeasuredHeights = new Map<string, number>();
```

- [ ] **Step 2: Record every measurement**

In the `measure` entry point (search for `"Cannot measure a row that is not visible."`), after the height validation block and BEFORE the `if (notifying || projecting || synchronizing)` re-queue check, add:

```ts
      lastMeasuredHeights.set(identityOf(ref), height);
```

Placing it before the re-queue branch is deliberate: a measurement deferred by re-entrancy is still a measurement the DOM reported, and it is exactly the interval this map exists to cover.

- [ ] **Step 3: Use it at the estimate gate**

Find the estimate gate (search `!root.hasMeasurement(ref)`, ~line 487). Replace:

```ts
          estimates.push({
            kind: "update",
            ref,
            index,
            estimatedHeight: estimate(row.row),
          });
```

with:

```ts
          estimates.push({
            kind: "update",
            ref,
            index,
            // A row we have measured falls back to that measurement; only a row
            // we have never seen gets arithmetic.
            estimatedHeight:
              lastMeasuredHeights.get(identity) ?? estimate(row.row),
          });
```

`identity` is already in scope on the line above (`const identity = identityOf(ref);`).

- [ ] **Step 4: Evict on remove**

In `applyOperation` (~line 583), in the `else if (operation.kind === "remove")` branch, add the delete alongside the existing height operation:

```ts
    } else if (operation.kind === "remove") {
      lastMeasuredHeights.delete(identityOf(operation.ref));
      heightOperation = {
        kind: "remove",
        ref: operation.ref,
        previousIndex: operation.previousIndex,
      };
```

- [ ] **Step 5: Evict on dispose**

Find where `stagedMeasurements.clear()` is called on teardown (~line 424) and add beside it:

```ts
    lastMeasuredHeights.clear();
```

If that call site turns out to be a replacement reset rather than dispose, clearing there would defeat the fix — in that case put the `clear()` in the controller's `dispose` path instead and say so in your report.

- [ ] **Step 6: Run the reproduction test**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run -t "falls back to its last measurement"
```

Expected: PASS.

- [ ] **Step 7: Run the whole renderer-dom suite**

```bash
pnpm --filter @pretable-internal/renderer-dom test
```

Expected: PASS, including "replays exact journals atomically, retains moves, and invalidates every update". If that test now fails, you have restored `hasMeasurement` rather than only the fallback height — revert and reconsider; do not edit that test.

- [ ] **Step 8: Typecheck and lint**

```bash
pnpm --filter @pretable-internal/renderer-dom typecheck && pnpm --filter @pretable-internal/renderer-dom lint
```

Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add packages/renderer-dom/src/row-layout-controller.ts packages/renderer-dom/src/__tests__/indexed-renderer.test.ts
git commit -m "fix(renderer-dom): never estimate a row height we have already measured"
```

---

## Task 3: Mutation check and downstream suites

**Files:**
- Modify (temporarily, then revert): `packages/renderer-dom/src/row-layout-controller.ts`

- [ ] **Step 1: Prove the test bites**

Bypass the retention by changing the estimate gate line back to `estimatedHeight: estimate(row.row)`.

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run -t "falls back to its last measurement"
```

Expected: FAIL. If it still passes, the test is not constraining the fix — fix the test before continuing.

- [ ] **Step 2: Revert the mutation and re-run**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run -t "falls back to its last measurement"
```

Expected: PASS.

- [ ] **Step 3: Run the downstream package suites**

```bash
pnpm --filter @pretable/core test && pnpm --filter @pretable/react test
```

Expected: PASS. The react suite is known to time out on one or two random tests under machine load — re-run any failure by name before believing it.

---

## Task 4: Browser confirmation

**Files:**
- Modify then delete: `apps/website/e2e/hero-row-height-probe.spec.ts`

- [ ] **Step 1: Rebuild the website against the fixed library**

```bash
pnpm --filter @pretable/app-website build
```

- [ ] **Step 2: Start the server**

```bash
cd apps/website && pnpm exec next start -p 3188
```

Run in the background; it must report `Ready` before continuing.

- [ ] **Step 3: Reduce the probe to one confirmation test**

Replace the whole contents of `apps/website/e2e/hero-row-height-probe.spec.ts` with:

```ts
import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/** Throwaway confirmation — deleted in the same task. */
test("row heights stop churning under streaming", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const transitions = await page.evaluate(async () => {
    const seen: { id: string; from: string | null; to: string | null }[] = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const node = record.target as HTMLElement;
        seen.push({
          id: node.getAttribute("data-pretable-row-id") ?? "",
          from: record.oldValue,
          to: node.getAttribute("data-pretable-row-height"),
        });
      }
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-pretable-row-height"],
      attributeOldValue: true,
      subtree: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 8000));
    observer.disconnect();
    return seen;
  });

  const values = [...new Set(transitions.map((t) => t.to))];
  console.log("transitions in 8s:", transitions.length);
  console.log("distinct published heights:", values);

  // 66 and 114 are the estimator's outputs for this grid (1×24+42 and 3×24+42).
  // The DOM measures 63 / 68 / 89. Neither estimator value may be published to a
  // row the grid has already measured.
  expect(values).not.toContain("66");
  expect(values).not.toContain("114");
});
```

- [ ] **Step 4: Run it**

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/hero-row-height-probe.spec.ts --project=chromium --workers=1
```

Expected: PASS, and the logged transition count far below the 154 recorded before the fix. Record both numbers — they go in the PR body.

Note the first-paint case is NOT fixed by this change: a row entering the window for the first time has no prior measurement and still gets an estimate. If `66` appears only in the first few hundred milliseconds, that is the known out-of-scope case — report the timing rather than weakening the assertion.

- [ ] **Step 5: Delete the probe and stop the server**

```bash
rm apps/website/e2e/hero-row-height-probe.spec.ts
```

- [ ] **Step 6: Run the website smoke suite for regressions**

Restart the server, then:

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/smoke.spec.ts --project=chromium --workers=1
```

Expected: PASS.

---

## Task 5: Changeset, full verification, PR

- [ ] **Step 1: Add a changeset**

```bash
pnpm exec changeset
```

`@pretable-internal/renderer-dom` is internal; select whichever published packages the change affects (`@pretable/react` at minimum, since it ships the built renderer) and mark it `patch`.

- [ ] **Step 2: Whole-repo checks**

```bash
pnpm typecheck && pnpm lint && pnpm format
```

Expected: clean. If `format` reports files, run `pnpm format:write` and commit.

- [ ] **Step 3: API report freshness**

Build before checking — `api:check` reads `dist/`, and a stale build silently strips exports.

```bash
pnpm build && pnpm api:check
```

Expected: clean. If it reports drift, run `pnpm api` and commit the regenerated reports.

- [ ] **Step 4: Commit any remaining artifacts and push**

```bash
git push -u origin blove/hero-grid-jitter-chrome-01430d
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "fix(renderer-dom): never estimate a row height we have already measured" --body "$(cat <<'EOF'
The homepage hero grid jittered in Chrome while streaming. The heights it jittered to were never measured — they were produced by `estimateDomRowHeight` and applied on top of rows that had already been measured.

Over 8 seconds in Chrome, the measurement path produced 63/89/68 while the DOM received 63, 66, 114, 89, 68. `66` and `114` were published 71 times and measured zero times; both reconcile exactly with the estimator's constants (1×24+42 and 3×24+42).

Streaming issues an `update` for every row every tick. That discards the row's staged measurement — correctly, since the content changed — after which the estimate gate treats a row measured dozens of times as one never seen. This retains the last measured height per identity and uses it as the fallback, so an estimate is only ever used for a row that has never been measured. `hasMeasurement` still goes false; the scheduler and the sliced catch-up are untouched.

Not fixed here, deliberately: a row entering the window for the first time still jumps, because the estimator's constants are calibrated against the bench app rather than the active theme. Tracked as a follow-up in the design doc.

Design: `docs/superpowers/specs/2026-08-12-row-height-estimate-stomping-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Merge on green.** Read the merge state back from `gh pr view` — an opened PR is not a merged PR, and BLOCKED+MERGEABLE usually means a required check is still pending.

---

## Out of scope

Two estimator *accuracy* problems, distinct from this stomping defect, each needing its own design pass: the hardcoded `ROW_LINE_HEIGHT` / `ROW_CHROME_HEIGHT` / `ESTIMATED_CHARACTER_WIDTH` constants, and the estimator's blindness to `render` and `format` (it walks only `wrap` columns and reads raw cell values). Also the false comment at `packages/react/src/pretable-model.ts:405`. All three are recorded in the design doc.

The hero's `.flash` underline is explicitly not being changed — the `last` cell measures a constant 22px and is never the row max.
