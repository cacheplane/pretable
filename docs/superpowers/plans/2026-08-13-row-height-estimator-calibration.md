# Row-Height Estimator Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `estimateDomRowHeight` learn a grid's real line height, chrome, and non-text floor from the measurements the grid already takes, instead of using constants calibrated against a different app's font.

**Architecture:** A pure, DOM-free calibration module accumulates `(predicted line count, measured height)` samples. Rows with 2+ predicted lines feed a least-squares fit whose slope is the real line height and whose intercept is the real chrome; rows with 0–1 lines feed a separate floor accumulator that captures whatever non-text content (custom renderers) costs. The estimator consumes the learned values where they exist and the current constants where they don't, so an uncalibrated grid behaves exactly as it does today.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Playwright (bench harness).

**Spec:** `docs/superpowers/specs/2026-08-13-row-height-estimator-calibration-design.md`

**Branch:** `blove/row-height-estimator-calibration`, already created off `main` at `28f749ec`.

---

## Context an engineer needs before starting

**What the estimator is for.** `estimateDomRowHeight` (`packages/renderer-dom/src/create-renderer.ts`) predicts a row's height before it has ever been rendered. The virtualizer needs it for scroll extent and row offsets, and it is what a row is drawn at for the first frame it enters the window. It walks only columns with `wrap: true`, reads the raw cell value, wraps the text through `@pretable-internal/text-core`, and computes `lines × ROW_LINE_HEIGHT + ROW_CHROME_HEIGHT`, floored at a caller-supplied base height.

**Why it is wrong.** `ROW_LINE_HEIGHT = 24`, `ROW_CHROME_HEIGHT = 42`, `ESTIMATED_CHARACTER_WIDTH = 7` are calibrated for the bench app's font. The homepage hero measures a real line height of ~21.07px and real chrome of 25px. Separately, the estimator cannot see `render` or `format`: in the hero, rows whose wrapped text is empty are actually sized by a custom two-line `dayPnl` renderer measuring 37.5px, which the estimator has no way to know about.

**The model being fitted.** Measured heights in the hero are 63 at L=1, 68 at L=2, 89 at L=3 (L = predicted line count of the widest wrapped column). Those are not collinear — 68−63 = 5 but 89−68 = 21 — because at L=1 the wrapped cell is not the tallest cell in the row. They fit:

```
measured ≈ max( floor , chrome + L × lineHeight )
```

`chrome = 25`, `lineHeight = 21.07` gives 67.1 → 68 at L=2 and 88.2 → 89 at L=3. `floor = 63` covers L≤1. The hinge is the shape of the real problem, not a modelling convenience.

**Safety property that makes this shippable:** with no samples, the calibration returns `null` and the estimator must behave **byte-identically** to today. Several steps below verify exactly that.

**Commands (from the repo root):**

```bash
pnpm --filter @pretable-internal/renderer-dom test
```

```bash
pnpm --filter @pretable-internal/renderer-dom typecheck && pnpm --filter @pretable-internal/renderer-dom lint
```

The package scripts build `text-core`, `layout-core` and `grid-core` first. A bare `vitest run` reads a stale `dist/` and can pass vacuously — use the package script for anything you intend to believe.

**Never run `git stash`** in this repo — the stash stack is shared across worktrees and a parallel session can steal the entry.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `packages/renderer-dom/src/row-height-calibration.ts` | **New.** Pure sample accumulator and fit. No DOM, no imports from the controller. | 2 |
| `packages/renderer-dom/src/__tests__/row-height-calibration.test.ts` | **New.** Unit tests for the fit, the unlearned case, and the degenerate-fit fallback. | 2 |
| `packages/renderer-dom/src/create-renderer.ts` | `estimateDomRowHeight` accepts optional learned parameters; exports a line-count helper. | 3 |
| `packages/renderer-dom/src/row-layout-controller.ts` | Owns a calibration instance; feeds it every data-row measurement; passes parameters to the estimator. | 3 |
| `status/` bench artifacts | Baseline and post-change `row_height_error_p95_px`. Not committed unless the repo's convention says otherwise. | 1, 4 |

---

## Task 1: Baseline measurement — GATE

**No implementation begins until this number exists.** If the baseline error is already at or near zero, the project is unjustified and we stop.

**Files:** none modified.

- [ ] **Step 1: Run the bench matrix on the current branch**

```bash
pnpm bench:matrix --adapters=pretable --scenarios=S1,S2,S3,S7 --scripts=initial,scroll --scale=dev
```

This builds the bench app and drives it with Playwright. It takes a while. It writes a run manifest to `status/runsets/<runsetId>.json` and a hypothesis report whose path it prints.

- [ ] **Step 2: Extract the metric**

From the artifacts the run produced, pull `row_height_error_p95_px` for every scenario/script combination, and `post_interaction_row_height_error_p95_px` where the script produces one. If the manifest does not contain them directly, find the per-run summary JSON it references and read them there.

For orientation: `status/milestones/2026-08-11-group-expand-cost-removed.json` records `post_interaction_row_height_error_p95_px` values of 3–4px on interaction scripts, so single-digit pixels is the expected scale.

- [ ] **Step 3: Record the baseline**

Write the numbers into a scratch file you will keep for Task 4's comparison, and report them. Include the runset id so the run is reproducible.

- [ ] **Step 4: Apply the gate**

| Observation | Action |
| --- | --- |
| p95 error is materially above zero on at least one scenario | Continue to Task 2 |
| p95 error is ~0 everywhere | **STOP and report.** There is nothing to improve and the design is unjustified. |

Do not proceed on the assumption that the error must be there because the spec says so. The spec's evidence comes from the website hero, not the bench app, and the bench app uses the very font these constants were calibrated for — so it is entirely possible the bench shows near-zero error while the website does not. **If that is what you find, say so plainly**: it would mean the metric cannot arbitrate this project and we need a different instrument before writing any code.

---

## Task 2: The calibration module (pure, TDD)

**Files:**
- Create: `packages/renderer-dom/src/row-height-calibration.ts`
- Create: `packages/renderer-dom/src/__tests__/row-height-calibration.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/renderer-dom/src/__tests__/row-height-calibration.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createRowHeightCalibration } from "../row-height-calibration";

/**
 * The estimator's constants are calibrated for one app's font. This module
 * learns the real ones from measurements the grid already takes, so the model
 * being fitted is the one the DOM actually produces:
 *
 *   measured ≈ max(floor, chrome + lines × lineHeight)
 *
 * The hinge matters. At one line the wrapped cell often is not the tallest cell
 * in the row — a custom two-line renderer can be — so those rows say nothing
 * about line height and everything about the floor. They are fitted separately.
 */
describe("row height calibration", () => {
  test("reports nothing until it has seen enough", () => {
    const calibration = createRowHeightCalibration();
    expect(calibration.getParameters()).toBeNull();

    // One wrapped sample cannot separate slope from intercept.
    calibration.observe(2, 68);
    expect(calibration.getParameters()?.lineHeightPx ?? null).toBeNull();
  });

  test("recovers line height and chrome from wrapped rows", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 4 });
    // The hero's real numbers: chrome 25, line height 21.07.
    for (const [lines, height] of [
      [2, 67.14],
      [3, 88.21],
      [2, 67.14],
      [4, 109.28],
    ] as const) {
      calibration.observe(lines, height);
    }

    const parameters = calibration.getParameters();
    expect(parameters?.lineHeightPx).toBeCloseTo(21.07, 1);
    expect(parameters?.chromePx).toBeCloseTo(25, 1);
  });

  test("learns the floor from rows whose wrapped text does not decide them", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 4 });
    calibration.observe(1, 63);
    calibration.observe(0, 63);
    calibration.observe(1, 61);

    // Floor is available even with no wrapped samples at all — those rows are
    // exactly the ones a custom renderer decides.
    expect(calibration.getParameters()?.floorPx).toBe(63);
  });

  test("refuses a degenerate fit rather than propagating it", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 3 });
    // Every sample at the same line count: the slope is unidentifiable.
    calibration.observe(2, 68);
    calibration.observe(2, 68);
    calibration.observe(2, 68);

    expect(calibration.getParameters()?.lineHeightPx ?? null).toBeNull();
  });

  test("rejects an implausible fit", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 3 });
    // A negative slope is not a line height under any font.
    calibration.observe(2, 90);
    calibration.observe(3, 60);
    calibration.observe(4, 30);

    expect(calibration.getParameters()?.lineHeightPx ?? null).toBeNull();
  });

  test("forgets old samples so a grid that changes content re-converges", () => {
    const calibration = createRowHeightCalibration({
      minWrappedSamples: 2,
      sampleCapacity: 4,
    });
    for (const [lines, height] of [
      [2, 100],
      [3, 150],
    ] as const) {
      calibration.observe(lines, height);
    }
    expect(calibration.getParameters()?.lineHeightPx).toBeCloseTo(50, 1);

    // Four new samples at a different scale evict the originals entirely.
    for (const [lines, height] of [
      [2, 40],
      [3, 60],
      [2, 40],
      [3, 60],
    ] as const) {
      calibration.observe(lines, height);
    }
    expect(calibration.getParameters()?.lineHeightPx).toBeCloseTo(20, 1);
  });

  test("returns a stable object identity until the fit changes", () => {
    const calibration = createRowHeightCalibration({ minWrappedSamples: 2 });
    calibration.observe(2, 67.14);
    calibration.observe(3, 88.21);

    const first = calibration.getParameters();
    expect(calibration.getParameters()).toBe(first);

    calibration.observe(4, 109.28);
    // Same fit, so the identity must not churn — consumers memoize on it.
    expect(calibration.getParameters()).toBe(first);
  });
});
```

- [ ] **Step 2: Run and confirm they FAIL**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run src/__tests__/row-height-calibration.test.ts
```

Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the module**

Create `packages/renderer-dom/src/row-height-calibration.ts`:

```ts
/**
 * Learns what a row actually costs, from the measurements the grid already takes.
 *
 * `estimateDomRowHeight`'s constants are calibrated against the bench app's font
 * (Inter Variable at 16px). Any other consumer gets a systematically wrong
 * answer — the homepage hero measures a 21.07px line box and 25px of chrome
 * against constants of 24 and 42 — and the error is always in the same
 * direction, so a row visibly shrinks the moment it is first measured.
 *
 * The model:
 *
 *   measured ≈ max(floor, chrome + lines × lineHeight)
 *
 * The hinge is not a convenience. At one line the wrapped cell is frequently not
 * the tallest cell in its row: a custom two-line renderer can be, and the
 * estimator is structurally blind to `render` and `format`. So rows whose
 * predicted line count is 0 or 1 say nothing about line height and everything
 * about the floor, and are fitted separately. That floor term is how this also
 * covers content the estimator cannot read.
 *
 * Deliberately NOT learned: `ESTIMATED_CHARACTER_WIDTH`. It determines the line
 * count itself, and separating it from the other parameters needs to know where
 * wrap points actually fall, which a height measurement does not say. Residual
 * error therefore remains wherever the predicted line count is simply wrong.
 */

/** Learned metrics. A field is null when the data cannot identify it. */
export interface RowHeightCalibrationParameters {
  readonly lineHeightPx: number | null;
  readonly chromePx: number | null;
  readonly floorPx: number | null;
}

export interface RowHeightCalibration {
  /**
   * Record one measurement. `lineCount` is the estimator's predicted line count
   * for the row, NOT the number of lines the DOM actually produced — the whole
   * point is to correct the estimator's own prediction against reality.
   */
  observe(lineCount: number, measuredHeight: number): void;
  /** Null until anything at all has been identified. */
  getParameters(): RowHeightCalibrationParameters | null;
}

export interface RowHeightCalibrationOptions {
  /** Wrapped samples required before a fit is attempted. */
  readonly minWrappedSamples?: number;
  /** Ring-buffer size for wrapped samples. */
  readonly sampleCapacity?: number;
}

const DEFAULT_MIN_WRAPPED_SAMPLES = 4;
const DEFAULT_SAMPLE_CAPACITY = 64;
/**
 * Sanity bounds. A fit outside these is not a font metric, it is noise or a
 * grid whose rows are not sized by text at all, and propagating it would be
 * worse than the constants it replaces.
 */
const MIN_PLAUSIBLE_LINE_HEIGHT = 4;
const MAX_PLAUSIBLE_LINE_HEIGHT = 400;
const MAX_PLAUSIBLE_CHROME = 400;

interface WrappedSample {
  readonly lineCount: number;
  readonly measuredHeight: number;
}

export function createRowHeightCalibration(
  options: RowHeightCalibrationOptions = {},
): RowHeightCalibration {
  const minWrappedSamples =
    options.minWrappedSamples ?? DEFAULT_MIN_WRAPPED_SAMPLES;
  const sampleCapacity = options.sampleCapacity ?? DEFAULT_SAMPLE_CAPACITY;

  const wrapped: WrappedSample[] = [];
  let floorPx: number | null = null;
  let dirty = false;
  let cached: RowHeightCalibrationParameters | null = null;

  const fitWrapped = (): { lineHeightPx: number; chromePx: number } | null => {
    if (wrapped.length < minWrappedSamples) return null;

    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumXX = 0;
    for (const sample of wrapped) {
      sumX += sample.lineCount;
      sumY += sample.measuredHeight;
      sumXY += sample.lineCount * sample.measuredHeight;
      sumXX += sample.lineCount * sample.lineCount;
    }
    const n = wrapped.length;
    const denominator = n * sumXX - sumX * sumX;
    // Zero denominator means every sample sits at the same line count, so slope
    // and intercept cannot be separated. That is the common early case, not an
    // error — it just means we do not know yet.
    if (denominator === 0) return null;

    // Rounded to 1/100px before anything else sees them. Two reasons, both
    // load-bearing: a fit over points that lie exactly on a line still comes
    // back with float noise in the last bits, and consumers memoize on this
    // object's identity — so unrounded values would mint a new object on every
    // sample and defeat the memo the estimator depends on.
    const round = (value: number) => Math.round(value * 100) / 100;
    const lineHeightPx = round(
      (n * sumXY - sumX * sumY) / denominator,
    );
    const chromePx = round((sumY - lineHeightPx * sumX) / n);

    if (
      !Number.isFinite(lineHeightPx) ||
      !Number.isFinite(chromePx) ||
      lineHeightPx < MIN_PLAUSIBLE_LINE_HEIGHT ||
      lineHeightPx > MAX_PLAUSIBLE_LINE_HEIGHT ||
      chromePx < 0 ||
      chromePx > MAX_PLAUSIBLE_CHROME
    ) {
      return null;
    }

    return { lineHeightPx, chromePx };
  };

  const recompute = (): RowHeightCalibrationParameters | null => {
    const fit = fitWrapped();
    if (fit === null && floorPx === null) return null;
    return Object.freeze({
      lineHeightPx: fit?.lineHeightPx ?? null,
      chromePx: fit?.chromePx ?? null,
      floorPx,
    });
  };

  const sameParameters = (
    left: RowHeightCalibrationParameters | null,
    right: RowHeightCalibrationParameters | null,
  ): boolean => {
    if (left === null || right === null) return left === right;
    return (
      left.lineHeightPx === right.lineHeightPx &&
      left.chromePx === right.chromePx &&
      left.floorPx === right.floorPx
    );
  };

  return {
    observe(lineCount, measuredHeight) {
      if (!Number.isFinite(lineCount) || !Number.isFinite(measuredHeight)) {
        return;
      }
      if (measuredHeight <= 0) return;

      if (lineCount >= 2) {
        wrapped.push({ lineCount, measuredHeight });
        // Bounded, so a grid whose content class changes re-converges instead of
        // averaging over its entire history.
        while (wrapped.length > sampleCapacity) wrapped.shift();
      } else {
        // A floor must cover the tallest row that text does not decide, so this
        // is a max rather than a mean: under-estimating here reintroduces the
        // first-paint shrink this exists to remove.
        floorPx = floorPx === null ? measuredHeight : Math.max(floorPx, measuredHeight);
      }
      dirty = true;
    },
    getParameters() {
      if (!dirty) return cached;
      dirty = false;
      const next = recompute();
      // Identity is part of the contract: consumers memoize their estimates on
      // it, so an unchanged fit must not produce a new object.
      if (!sameParameters(cached, next)) cached = next;
      return cached;
    },
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run src/__tests__/row-height-calibration.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Mutation-check every guard**

Do these one at a time, re-running the test file after each, and restore between:

| Mutation | Expected |
| --- | --- |
| Delete the `denominator === 0` early return | "refuses a degenerate fit" FAILS |
| Delete the plausibility clamp block | "rejects an implausible fit" FAILS |
| Change `while (wrapped.length > sampleCapacity)` to never evict | "forgets old samples" FAILS |
| Replace `Math.max` in the floor branch with plain assignment | "learns the floor" FAILS |
| Delete the `sameParameters` check so `cached` is always replaced | "returns a stable object identity" FAILS |

Report each result. **Any mutation that leaves the suite green is an untested line** — fix the test before continuing, and say which.

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
pnpm --filter @pretable-internal/renderer-dom typecheck && pnpm --filter @pretable-internal/renderer-dom lint
```

```bash
git add packages/renderer-dom/src/row-height-calibration.ts packages/renderer-dom/src/__tests__/row-height-calibration.test.ts
git commit -m "feat(renderer-dom): learn row-height metrics from measurements"
```

---

## Task 3: Wire it in

**Files:**
- Modify: `packages/renderer-dom/src/create-renderer.ts`
- Modify: `packages/renderer-dom/src/row-layout-controller.ts`
- Modify: `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts`

- [ ] **Step 1: Write the failing integration test**

Add to `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts`, inside the existing `describe("indexed DOM row layout controller", ...)` block:

```ts
  test("an uncalibrated controller estimates exactly as before", () => {
    // The safety property. With no measurements, nothing may move — this is
    // what makes the calibration safe to ship enabled.
    const row = { id: "r0", team: "A", score: 1, label: "short" };
    const columns = [
      { id: "label", wrap: true, widthPx: 220, value: (e: typeof row) => e.label },
    ] as const;

    expect(estimateDomRowHeight(row, columns, 20, null)).toBe(
      estimateDomRowHeight(row, columns, 20),
    );
  });

  test("a calibrated estimate uses the learned metrics", () => {
    const row = {
      id: "r0",
      team: "A",
      score: 1,
      label:
        "Bonjour depuis Pretable token-231 Bonjour depuis Pretable token-232 Bonjour depuis Pretable token-233",
    };
    const columns = [
      { id: "label", wrap: true, widthPx: 220, value: (e: typeof row) => e.label },
    ] as const;

    const uncalibrated = estimateDomRowHeight(row, columns, 20);
    const calibrated = estimateDomRowHeight(row, columns, 20, {
      // Deliberately far from the constants (24 / 42) so the difference cannot
      // be a rounding coincidence.
      lineHeightPx: 12,
      chromePx: 10,
      floorPx: null,
    });

    expect(calibrated).toBeLessThan(uncalibrated);
  });

  test("the learned floor lifts a row that text does not decide", () => {
    const row = { id: "r0", team: "A", score: 1, label: "short" };
    const columns = [
      { id: "label", wrap: true, widthPx: 220, value: (e: typeof row) => e.label },
    ] as const;

    expect(
      estimateDomRowHeight(row, columns, 20, {
        lineHeightPx: null,
        chromePx: null,
        floorPx: 63,
      }),
    ).toBe(63);
  });
```

- [ ] **Step 2: Run and confirm they FAIL**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run -t "calibrated"
```

Expected: FAIL — `estimateDomRowHeight` takes three parameters today.

- [ ] **Step 3: Extend `estimateDomRowHeight`**

In `packages/renderer-dom/src/create-renderer.ts`:

Import the parameter type:

```ts
import type { RowHeightCalibrationParameters } from "./row-height-calibration";
```

Add a fourth parameter to the signature:

```ts
export function estimateDomRowHeight<TRow extends object>(
  row: TRow,
  columns: readonly DomLayoutColumn<TRow>[],
  baseHeight: number = DEFAULT_ROW_HEIGHT,
  calibration: RowHeightCalibrationParameters | null = null,
): number {
```

Inside, resolve the metrics once before the loop:

```ts
  // Learned where available, the bench-app constants where not. An uncalibrated
  // grid must produce byte-identical results to before this existed.
  const lineHeightPx = calibration?.lineHeightPx ?? ROW_LINE_HEIGHT;
  const chromeHeightPx = calibration?.chromePx ?? ROW_CHROME_HEIGHT;
```

Seed the accumulator with the learned floor — this is the term that covers content the estimator cannot read:

```ts
  let estimatedHeight = Math.max(baseHeight, calibration?.floorPx ?? 0);
```

and use the resolved metrics in the loop body, replacing `ROW_LINE_HEIGHT` and `ROW_CHROME_HEIGHT`:

```ts
    const layout = layoutPreparedText(prepared, resolveColumnWidth(column), {
      lineHeightPx,
      wrapMode: "wrap",
    });

    estimatedHeight = Math.max(estimatedHeight, layout.height + chromeHeightPx);
```

**The memo needs the calibration in its key.** The existing `estimatedRowHeightCache` compares `columnsRef` and `baseHeight`; a changed fit must invalidate it too. Both cache-hit branches need the extra check, and the stored record needs the extra field:

```ts
  const cached = estimatedRowHeightCache.get(row);

  if (
    cached &&
    cached.columnsRef === columns &&
    cached.baseHeight === baseHeight &&
    cached.calibrationRef === calibration
  ) {
    return cached.height;
  }

  const signature = getEstimatedRowHeightSignature(row, columns);

  if (
    cached?.signature === signature &&
    cached.baseHeight === baseHeight &&
    cached.calibrationRef === calibration
  ) {
    cached.columnsRef = columns;
    return cached.height;
  }
```

and at the write site:

```ts
  estimatedRowHeightCache.set(row, {
    signature,
    height: estimatedHeight,
    columnsRef: columns,
    baseHeight,
    calibrationRef: calibration,
  });
```

Add `calibrationRef: RowHeightCalibrationParameters | null` to the cache record's type. Identity comparison is sufficient precisely because the calibration module guarantees a stable object identity until the fit actually changes — that guarantee is what the "returns a stable object identity" test in Task 2 exists to pin.

- [ ] **Step 4: Own a calibration instance in the controller**

In `packages/renderer-dom/src/row-layout-controller.ts`:

```ts
import { createRowHeightCalibration } from "./row-height-calibration";
```

Near where `defaultRowHeight` and `estimate` are resolved (~line 297):

```ts
  // Per controller instance, which is exactly the right scope: `layoutColumns`
  // and `defaultRowHeight` are captured at construction, so a column change or a
  // density flip builds a new controller and re-learns rather than carrying
  // another theme's metrics.
  const calibration = createRowHeightCalibration();
```

and thread the parameters into the default estimator:

```ts
  const estimateRowHeight =
    options.estimateRowHeight ??
    ((row: TRow) =>
      estimateDomRowHeight(
        row,
        layoutColumns,
        defaultRowHeight,
        calibration.getParameters(),
      ));
```

**Verify the assumption in that comment before relying on it.** Confirm `layoutColumns` and `defaultRowHeight` are resolved once at construction and cannot change on a live controller. If either can change, per-instance scoping is wrong and the calibration needs explicit invalidation — **stop and report** rather than papering over it.

Note a consumer-supplied `options.estimateRowHeight` bypasses calibration entirely. That is correct: they asked for their own estimator.

- [ ] **Step 5: Feed measurements to the calibration**

In the `measure` entry point, alongside the existing `retainMeasuredHeight` call (guarded on `ref.kind === "data"`), also observe the sample. You need the row object and its predicted line count:

```ts
      if (ref.kind === "data") {
        retainMeasuredHeight(identityOf(ref), height);
        const observed = state.snapshot.range(index, index + 1)[0];
        if (observed !== undefined && observed.kind === "data") {
          calibration.observe(
            predictRowLineCount(observed.row, layoutColumns),
            height,
          );
        }
      }
```

`predictRowLineCount` does not exist yet — add it to `create-renderer.ts` and export it, reusing the same text pipeline the estimator uses so the predicted count it returns is the *same* number the estimate was built from:

```ts
/**
 * The estimator's predicted line count for a row — the max across its wrapped
 * columns, and 1 when it has none.
 *
 * Exported so calibration fits against the estimator's OWN prediction rather
 * than a second, subtly different reckoning of the same thing. Fitting measured
 * height against a line count the estimator never used would learn a correction
 * for a model nobody runs.
 *
 * @internal
 */
export function predictRowLineCount<TRow extends object>(
  row: TRow,
  columns: readonly DomLayoutColumn<TRow>[],
): number {
  let lines = 1;
  for (const column of columns) {
    if (!column.wrap) continue;
    const prepared = prepareText({
      text: String(readCellValue(row, column)),
      fontKey: ESTIMATE_FONT_KEY,
      averageCharWidth: ESTIMATED_CHARACTER_WIDTH,
    });
    const layout = layoutPreparedText(prepared, resolveColumnWidth(column), {
      lineHeightPx: ROW_LINE_HEIGHT,
      wrapMode: "wrap",
    });
    lines = Math.max(lines, Math.round(layout.height / ROW_LINE_HEIGHT));
  }
  return lines;
}
```

Import it in the controller alongside `estimateDomRowHeight`.

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @pretable-internal/renderer-dom test
```

Expected: PASS, all of them. The pre-existing estimator tests are the ones that matter most here — `"an unwrapped row estimates at the base height it is given"` and `"retains calibrated wrapped-height estimates across column identities"` both pin the uncalibrated behaviour, and they must not need editing. **If either fails, the safety property is broken** — an uncalibrated grid is behaving differently. Fix the implementation, not the test.

- [ ] **Step 7: Mutation-check the wiring**

| Mutation | Expected |
| --- | --- |
| Make `estimateDomRowHeight` ignore its `calibration` argument | "a calibrated estimate uses the learned metrics" and "the learned floor lifts a row" FAIL |
| Drop `calibrationRef` from the memo comparison, then estimate a row, change the fit, and estimate it again | A test must catch the stale value. If none does, **add one** — a memo that ignores the calibration silently freezes the first fit forever, which is a defect that would never show up in a fresh-controller test. |

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm --filter @pretable-internal/renderer-dom typecheck && pnpm --filter @pretable-internal/renderer-dom lint
```

```bash
git add packages/renderer-dom/src
git commit -m "feat(renderer-dom): estimate row heights from learned metrics"
```

---

## Task 4: Re-measure — GATE

**Files:** none modified.

- [ ] **Step 1: Re-run the identical bench command from Task 1**

```bash
pnpm bench:matrix --adapters=pretable --scenarios=S1,S2,S3,S7 --scripts=initial,scroll --scale=dev
```

Same flags, same scale. A comparison against a differently-shaped run is not a comparison.

- [ ] **Step 2: Compare against the Task 1 baseline**

Tabulate `row_height_error_p95_px` and `post_interaction_row_height_error_p95_px`, before and after, per scenario/script.

- [ ] **Step 3: Apply the gate**

| Observation | Action |
| --- | --- |
| p95 error drops materially | Continue to Task 5 |
| p95 error is unchanged | **STOP and report.** A more complicated estimator that is no more accurate is a net loss — the honest outcome is to revert. |
| p95 error rises anywhere | **STOP and report** with the scenario and numbers. |

Also check the metrics the bench guards for continuity — `post_interaction_blank_gap_frames`, `post_interaction_anchor_shift_px`, and the frame budgets. A row-height change that improves estimate accuracy while introducing anchor drift is not an improvement; report any movement in those.

---

## Task 5: Downstream verification and PR

- [ ] **Step 1: Downstream suites**

```bash
pnpm --filter @pretable/core test && pnpm --filter @pretable/react test
```

Expected: PASS. The react suite times out one or two random tests under machine load — re-run any failure by name before believing it.

- [ ] **Step 2: Hero symptom check**

```bash
pnpm --filter @pretable/app-website build
```

```bash
cd apps/website && pnpm exec next start -p 3188
```

With the server up, confirm in Chromium that a row's first published height no longer jumps 66 → 63. Reuse the MutationObserver approach from the previous project: observe `data-pretable-row-height` for 8 seconds, collect the distinct published values, and report them. Expect `66` to be absent or much rarer.

**This is a symptom check, not the criterion** — Task 4's gate already decided the outcome. Report what you see either way; do not treat a surviving `66` as a blocker on its own, but do report it.

Delete any probe file you create, and run the smoke suite before stopping the server:

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/smoke.spec.ts --project=chromium --workers=1
```

- [ ] **Step 3: Changeset**

```bash
pnpm exec changeset
```

`@pretable/react` (the published package that ships the renderer), `patch`. Read a few existing changesets for the house style before writing.

- [ ] **Step 4: Whole-repo checks**

```bash
pnpm typecheck && pnpm lint && pnpm format
```

If `format` reports files, run `pnpm format:write` and commit.

```bash
pnpm build && pnpm api:check
```

Build before `api:check` — it reads `dist/`, and a stale build silently strips exports.

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin blove/row-height-estimator-calibration
```

Open a PR whose body leads with the Task 1 → Task 4 metric comparison, since that is the evidence the change is justified. Name the residual explicitly: `ESTIMATED_CHARACTER_WIDTH` is still 7 and unlearned, so error remains wherever the predicted line count is itself wrong.

- [ ] **Step 6: Merge on green.** Read the state back from `gh pr view` — an opened PR is not a merged PR.

---

## Out of scope

- **Group-row estimation.** The estimate gate is data-only, so group rows are untouched. Whether they should be calibrated is a separate product call.
- **Learning `ESTIMATED_CHARACTER_WIDTH`.** It determines the line count itself and cannot be separated from the other parameters by height measurements alone.
- **The false comment at `packages/react/src/pretable-model.ts:405`.** This change may make its claim true, at which point it should be rewritten rather than deleted — but that is a follow-up, not part of this work.
