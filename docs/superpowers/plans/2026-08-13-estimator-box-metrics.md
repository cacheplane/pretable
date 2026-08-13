# Phase A — Box Metrics From CSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop inferring line height, chrome, and text-box width; read them from CSS, and delete the regression fit that was masking a padding bug.

**Architecture:** A `RowBoxMetrics` — line height, padding x/y, border — resolved once per theme in `packages/react` and threaded to the controller the way `defaultRowHeight` already is. The estimator wraps text at `columnWidth − 2 × paddingX` and adds real chrome. The calibration module keeps only its learned floor; its line-height and chrome regression is removed.

**Tech Stack:** TypeScript, Vitest, Playwright (bench + hero verification).

**Spec:** `docs/superpowers/specs/2026-08-13-estimator-real-inputs-design.md` (Phase A)

**Branch:** `blove/estimator-real-inputs`, already created off `main` at `c64e9d93`.

---

## Context an engineer needs

**Where the estimator is now**, after #342 and #358:

- `estimateDomRowHeight(row, columns, baseHeight, calibration, averageCharWidthPx)` in `packages/renderer-dom/src/create-renderer.ts`. It resolves `lineHeightPx = calibration?.lineHeightPx ?? ROW_LINE_HEIGHT` (24) and `chromeHeightPx = calibration?.chromePx ?? ROW_CHROME_HEIGHT` (42) at `:211-212`.
- It wraps at `resolveColumnWidth(column)` (`:232`, and `predictRowLineCount` at `:310`) — **the full column width, with no padding deducted.** That is the bug this plan fixes.
- `packages/renderer-dom/src/row-height-calibration.ts` learns `lineHeightPx`, `chromePx` and `floorPx` from measurements.
- `packages/react/src/density.ts` has `readPx(name, fallback)` and `getThemeRowHeight()`; `pretable-model.ts` passes `defaultRowHeight: getThemeRowHeight()` to the controller. That is the established route for theme numbers.

**Why this matters more than it looks.** `--pretable-cell-padding-x` is per-theme *and* per-density: Excel is 6/8/12px, Material is 16px. So the un-deducted padding is worth 12–32px of wrap width depending on theme — on a 320px column that is up to 10% of the line.

**The regression this fixes.** Measured over 48 real Chromium rows: line-count prediction is correct on **43/48** with the old guessed 7px character width and **37/48** with the measured 6.505px. The guess was over-stating character width by roughly the factor the wrap width over-stated the text box. Two errors cancelled; #358 corrected one and exposed the other.

**Why the fit must go.** The calibration's line-height/chrome regression absorbs error, which is precisely how it masked the padding bug. Leaving it in place while fixing padding would let it hide the result again. Its learned **floor** is different — nothing else can see what a custom `render` contributes — and stays.

**Commands:**

```bash
pnpm --filter @pretable-internal/renderer-dom test
```

```bash
pnpm --filter @pretable/react test
```

Package scripts build dependencies first; a bare `vitest run` reads a stale `dist/`. Never run `git stash` — the stash stack is shared across worktrees.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/react/src/density.ts` | `getThemeBoxMetrics()` — line height, padding x/y, border from CSS. | 1 |
| `packages/react/src/__tests__/density.test.ts` (or existing) | Unit tests for the resolver, including the no-theme fallback. | 1 |
| `packages/renderer-dom/src/types.ts` | `getRowBoxMetrics?: () => RowBoxMetrics \| null` controller option. | 2 |
| `packages/renderer-dom/src/create-renderer.ts` | Deduct padding from the wrap width; take chrome and line height from box metrics. | 2 |
| `packages/renderer-dom/src/row-layout-controller.ts` | Thread the option through. | 2 |
| `packages/react/src/pretable-model.ts` | Supply it, beside `defaultRowHeight`. | 2 |
| `packages/renderer-dom/src/row-height-calibration.ts` | Remove the line-height/chrome fit; keep the floor. | 3 |

---

## Task 1: Resolve the box from CSS

**Files:**
- Modify: `packages/react/src/density.ts`
- Modify or create: the corresponding test file

- [ ] **Step 1: Find out where line height actually comes from**

`--pretable-cell-padding-x` and `-y` are real tokens (`packages/ui/src/themes/*.css`). **Line height may not be.** The hero's computed cell font shorthand reads `14px / 21px …`, so line height is resolvable from computed style even when no token exists.

Check for a `--pretable-line-height` (or similar) token first. If one exists, read it with `readPx`. If not, read `line-height` from the computed style of a rendered cell. **Report which you found** — the rest of this task depends on it, and guessing here reintroduces exactly the class of bug we are removing.

> **RESOLVED during implementation.** No such token exists — verified against the 54-token contract test in `packages/ui/src/__tests__/contract.test.ts` and a repo-wide grep; body cells set no `line-height` and inherit `normal`. (An earlier design doc lists adding `--pretable-line-height-cell` as an open question; it was never done.) So line height is read from a rendered cell's computed style, accepting only `<number>px`.
>
> **CORRECTION.** An earlier draft of this step said to fall back "to the row-height default" — that is 44, and it would move unthemed estimates, breaking the safety property. The fallback is today's constant, `ROW_LINE_HEIGHT = 24`, as Step 3 says. Padding-Y falls back to `(ROW_CHROME_HEIGHT − borderPx) / 2 = 20.5` so that `2 × paddingY + border === 42` holds by construction, and padding-X falls back to `0` because today's estimator deducts nothing. `borderPx` reads `--pretable-rule-width`, a real token whose 1px fallback is CSS's own default rather than a guess.

- [ ] **Step 2: Write the failing tests**

Add tests covering: each token resolved; the no-theme fallback for every field; and that a missing/invalid value falls back rather than yielding `NaN`. Follow the existing patterns in `density.ts`'s tests — `getThemeRowHeight` is already tested there, and `readPx` already handles the unset and non-px cases.

Assert the fallbacks equal today's behaviour, because that is the safety property: **with no theme, estimates must not move.**

- [ ] **Step 3: Implement `getThemeBoxMetrics()`**

```ts
/**
 * The row box, as CSS states it.
 *
 * These were being inferred: a least-squares fit learned "line height" and
 * "chrome" from measured rows, and the wrap width ignored cell padding
 * entirely. Both are values the browser will hand over directly — and the fit
 * was not merely redundant, it was harmful: it absorbed the padding error and
 * hid it, so a 7px-per-character guess and an un-deducted padding cancelled
 * each other for years. Read what is readable.
 *
 * @internal
 */
export interface RowBoxMetrics {
  readonly lineHeightPx: number;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly borderPx: number;
}
```

Resolve each with `readPx`-style handling, falling back to today's constants so an unthemed grid is unchanged.

- [ ] **Step 4: Run, typecheck, lint, commit**

```bash
pnpm --filter @pretable/react test
```

```bash
pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react lint
```

```bash
git add packages/react/src
git commit -m "feat(react): resolve the row box from CSS instead of inferring it"
```

---

## Task 2: Use the box in the estimator

**Files:**
- Modify: `packages/renderer-dom/src/types.ts`, `create-renderer.ts`, `row-layout-controller.ts`
- Modify: `packages/react/src/pretable-model.ts`
- Modify: `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  test("wraps text inside the cell, not across its padding", () => {
    // The bug: the estimator wrapped at the full column width, so it fitted
    // more characters per line than the cell can actually hold. Themes put
    // 6-16px of padding on each side, so on a 320px column that is up to 10%
    // of the line — and it was cancelling out a character width that was too
    // large, which is how both survived.
    const row = { id: "r0", team: "A", score: 1, label: "x".repeat(60) };
    const columns = [
      { id: "label", wrap: true, widthPx: 320, value: (e: typeof row) => e.label },
    ] as const;

    const withoutPadding = predictRowLineCount(row, columns, 6, {
      lineHeightPx: 21,
      paddingXPx: 0,
      paddingYPx: 12,
      borderPx: 1,
    });
    const withPadding = predictRowLineCount(row, columns, 6, {
      lineHeightPx: 21,
      paddingXPx: 16,
      paddingYPx: 12,
      borderPx: 1,
    });

    expect(withPadding).toBeGreaterThan(withoutPadding);
  });
```

Run it, confirm it fails (the parameter does not exist yet).

- [ ] **Step 2: Thread `RowBoxMetrics` through**

Give `estimateDomRowHeight` and `predictRowLineCount` a trailing `boxMetrics: RowBoxMetrics | null = null`. Inside:

```ts
  // The text box, not the column box. Padding is on both sides.
  const wrapWidth = Math.max(1, resolveColumnWidth(column) - 2 * paddingXPx);
```

and resolve the vertical terms from the box when present:

```ts
  const lineHeightPx = boxMetrics?.lineHeightPx ?? ROW_LINE_HEIGHT;
  const chromeHeightPx =
    boxMetrics === null
      ? ROW_CHROME_HEIGHT
      : boxMetrics.paddingYPx * 2 + boxMetrics.borderPx;
```

> **NOTE from Task 1.** `getThemeBoxMetrics()` never returns `null` — it always yields a box, whose no-theme fallbacks compute to exactly `ROW_LINE_HEIGHT` and `ROW_CHROME_HEIGHT`. So the `null` branch above is equivalent either way and exists only for the case where the controller option is not supplied at all (a non-React consumer). Keep it for that, but do not expect it on the React path.

Add `boxMetrics` to the memo key in **both** cache-hit branches, exactly as `calibrationRef` and `averageCharWidthPx` already are. Give it a stable identity from the React side (resolve once per theme, not per call) so identity comparison is valid — and say so in a comment.

Add the `getRowBoxMetrics?: () => RowBoxMetrics | null` controller option, call it lazily inside the estimate closure (same reasoning as `getAverageCharWidthPx`: the theme is only readable after something renders), and pass the result to `predictRowLineCount` where `measure` feeds the calibration, so the fit sees the line count the estimate used.

Supply it from `pretable-model.ts` beside `defaultRowHeight`.

**Guard the clamp:** `Math.max(1, …)` matters. A narrow column with generous padding can otherwise produce a zero or negative wrap width, and `charsPerLine` would divide by it.

- [ ] **Step 3: Run everything**

```bash
pnpm --filter @pretable-internal/renderer-dom test && pnpm --filter @pretable/react test
```

The two pre-existing estimator tests — `"an unwrapped row estimates at the base height it is given"` and `"retains calibrated wrapped-height estimates across column identities"` — **must pass unedited**. With no box metrics, behaviour is byte-identical to today.

- [ ] **Step 4: Commit**

---

## Task 3: Retire the fit, keep the floor

**Files:**
- Modify: `packages/renderer-dom/src/row-height-calibration.ts` and its tests
- Modify: `packages/renderer-dom/src/create-renderer.ts` (stop reading the removed fields)

- [ ] **Step 1: Remove the regression**

Delete `lineHeightPx` and `chromePx` from `RowHeightCalibrationParameters`, along with `fitWrapped`, the wrapped-sample ring buffer, the plausibility clamps, and `minWrappedSamples`. Keep `floorPx`, its `Math.max` accumulator, the stable-identity guarantee, and the bound.

Replace the module's header comment: it currently explains a hinge model that no longer exists. State instead that the box comes from CSS and that this module learns only what nothing can read — the contribution of custom `render` output the estimator cannot see.

Delete the tests that pinned the fit (`"recovers line height and chrome from wrapped rows"`, `"refuses a degenerate fit"`, `"rejects an implausible fit"`, and the ring-buffer test if it only covered wrapped samples). **Keep and preserve** the floor tests and the identity-stability test.

Deleting tests is normally a smell; here the behaviour they pinned is being deliberately removed, and leaving them would pin a mechanism the design has rejected. Say in the commit message which tests went and why.

- [ ] **Step 2: Run everything and commit**

---

## Task 4: The gate

- [ ] **Step 1: Run the accuracy instrument**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run src/__tests__/row-height-accuracy.test.ts
```

The test drives `estimateDomRowHeight` directly, so it must now pass the hero's real box metrics. Measure them the same way `HERO_AVERAGE_CHAR_WIDTH_PX` was obtained — a throwaway Playwright probe reading the computed style of a hero cell — and export them from the fixture with the same provenance discipline. Do not guess them.

| Observation | Verdict |
| --- | --- |
| Line counts **above 43/48** and mean error **below 6.85px** | **PASS** |
| Line counts at or below 43/48 | **STOP and report.** Beating 37/48 is not success — 43/48 is what the *guess* achieved, and the whole claim is that reading the box beats guessing. |
| Mean error at or above 6.85px | **STOP and report.** |

Report both numbers regardless. Do not tune the fixture or the assertion.

- [ ] **Step 2: Bench no-regression**

```bash
pnpm bench:matrix --adapters=pretable --scenarios=S1,S2,S3,S7 --scripts=initial,scroll --scale=dev
```

Baseline (runset `2026-08-13t04-27-03-476z`): S1 scroll 1, S2 scroll 4, S3 scroll 1, S7 scroll 4. A rise is disqualifying.

- [ ] **Step 3: Hero symptom check**

Build the site, serve it, and observe distinct `data-pretable-row-height` values for 8 seconds in Chromium. Run `e2e/smoke.spec.ts`. Delete any probe; stop the server.

- [ ] **Step 4: Changeset, repo checks, PR**

```bash
pnpm exec changeset
```

`@pretable/react`, `patch`.

```bash
pnpm typecheck && pnpm lint && pnpm format
```

```bash
pnpm build && pnpm api:check
```

Build before `api:check`. Check whether `main` has drifted (`git fetch origin && git log --oneline -3 origin/main`) — parallel sessions have been landing PRs throughout; rebase and re-run the suites if so.

Lead the PR body with the line-count and mean-error numbers, and state plainly that this closes the regression knowingly shipped in #358.

- [ ] **Step 5: Merge on green,** reading the state back from `gh pr view`.

---

## Out of scope

Phase B — segment-measured text via an injectable measurer in `text-core`, informed by `@chenglou/pretext`. It has its own plan and lands after this, deliberately: the fit being removed here would otherwise absorb and mask its effect.
