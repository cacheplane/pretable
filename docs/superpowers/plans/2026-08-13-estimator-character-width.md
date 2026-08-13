# Estimator Character Width Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the estimator's guessed 7px-per-character with a real measurement of the grid's font, so predicted line counts stop being wrong.

**Architecture:** `packages/react` measures the computed font of a rendered cell once with `canvas.measureText`, caches it per font string, and hands it to the row-layout controller the same way it already hands down `defaultRowHeight`. The controller passes it into `estimateDomRowHeight` → `prepareText({ averageCharWidth })`. `text-core` is unchanged. Without canvas — SSR, jsdom — the measurement returns `null` and today's guess stands.

**Tech Stack:** TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-estimator-character-width-design.md`

**Branch:** `blove/row-height-estimator-calibration` (continues the calibration work; HEAD `f370495b`).

---

## Context an engineer needs

**The defect.** `text-core`'s entire model of a font is `charsPerLine = floor(width / averageCharWidth)`. That width is never measured — `prepareText` sniffs the *font-key string* for "mono"/"condensed"/"serif" (`packages/text-core/src/prepare-text.ts:58`), and `create-renderer.ts` passes the literal `"Pretable Estimate 14"`, which matches nothing, so every grid gets 7px per character.

**The evidence.** Against 23 real hero rows (`packages/renderer-dom/src/__tests__/row-height-accuracy.fixture.ts`), ten rows of 87-character text at 320px are predicted at 3 lines / 114px against a browser-produced 2 lines / 89px. That is 250px of the 299px total error.

**Current branch state.** The accuracy gate test (`row-height-accuracy.test.ts`) is **committed red** at `mean |estimate - measured|: 13 -> 13`. Making it green is this plan's job. The calibration module from the previous design is retained and still wired — it learns `chrome` and the non-text `floor`, which this plan does not touch.

**The safety property.** With no measured width, every estimate must be byte-identical to today. Two pre-existing tests in `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts` pin it — `"an unwrapped row estimates at the base height it is given"` and `"retains calibrated wrapped-height estimates across column identities"`. They must pass unedited.

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
| `packages/react/src/text-metrics.ts` | **New.** Measure and cache average character width per font via canvas. Returns `null` without canvas. | 1 |
| `packages/react/src/__tests__/text-metrics.test.ts` | **New.** Unit tests with a stubbed canvas, plus the no-canvas path. | 1 |
| `packages/renderer-dom/src/types.ts` | New `getAverageCharWidthPx` controller option. | 2 |
| `packages/renderer-dom/src/row-layout-controller.ts` | Calls the getter inside the estimate closure. | 2 |
| `packages/renderer-dom/src/create-renderer.ts` | Fifth parameter on `estimateDomRowHeight`; feeds `prepareText`; joins the memo key. | 2 |
| `packages/react/src/pretable-model.ts` | Supplies the getter, beside `defaultRowHeight: getThemeRowHeight()`. | 2 |

---

## Task 1: Measure the font

**Files:**
- Create: `packages/react/src/text-metrics.ts`
- Create: `packages/react/src/__tests__/text-metrics.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/src/__tests__/text-metrics.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  measureAverageCharWidth,
  resetTextMetricsCacheForTesting,
} from "../text-metrics";

/**
 * The estimator's model of a font is one number: pixels per character. It was
 * never measured — `prepareText` guesses it by pattern-matching a font-key
 * string, and the key the grid passes matches none of its patterns, so every
 * grid silently got 7px. On the homepage hero that predicts 3 lines where the
 * browser draws 2, which is most of the estimator's total error.
 */

function stubCanvas(widthPerChar: number) {
  const context = {
    font: "",
    measureText: (text: string) => ({ width: text.length * widthPerChar }),
  };
  vi.spyOn(document, "createElement").mockImplementation(
    (tag: string) =>
      (tag === "canvas"
        ? { getContext: () => context }
        : {}) as unknown as HTMLElement,
  );
  return context;
}

afterEach(() => {
  vi.restoreAllMocks();
  resetTextMetricsCacheForTesting();
});

describe("average character width", () => {
  test("measures the font it is given", () => {
    stubCanvas(6);
    expect(measureAverageCharWidth("14px Inter", "hello world")).toBeCloseTo(
      6,
      5,
    );
  });

  test("applies the font to the measuring context", () => {
    const context = stubCanvas(6);
    measureAverageCharWidth("14px Inter", "hello world");
    expect(context.font).toBe("14px Inter");
  });

  test("caches per font, so a session measures each font once", () => {
    stubCanvas(6);
    const measureText = vi.spyOn(
      document.createElement("canvas").getContext("2d") as never,
      "measureText",
    );
    measureAverageCharWidth("14px Inter", "hello world");
    const callsAfterFirst = measureText.mock.calls.length;
    measureAverageCharWidth("14px Inter", "different sample text");
    expect(measureText.mock.calls.length).toBe(callsAfterFirst);
  });

  test("returns null without a canvas, so SSR keeps today's behaviour", () => {
    vi.spyOn(document, "createElement").mockImplementation(
      () => ({ getContext: () => null }) as unknown as HTMLElement,
    );
    expect(measureAverageCharWidth("14px Inter", "hello world")).toBeNull();
  });

  test("returns null for empty sample text rather than dividing by zero", () => {
    stubCanvas(6);
    expect(measureAverageCharWidth("14px Inter", "")).toBeNull();
  });

  test("counts graphemes, not code units", () => {
    // "🚀🚀" is 2 graphemes and 4 code units. Dividing by code units would
    // halve the answer for emoji-bearing text.
    stubCanvas(10); // measureText returns text.length * 10 = 40
    const width = measureAverageCharWidth("14px Inter", "🚀🚀");
    expect(width).toBeCloseTo(20, 5);
  });
});
```

- [ ] **Step 2: Run and confirm FAIL**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/text-metrics.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `packages/react/src/text-metrics.ts`:

```ts
/**
 * How wide is a character, really?
 *
 * `@pretable-internal/text-core` models a font as a single number — pixels per
 * character — and wraps with `charsPerLine = floor(width / averageCharWidth)`.
 * Nothing measured that number: `prepareText` infers it by pattern-matching the
 * font-key string ("mono" → 8, "condensed" → 6.5, "serif" → 7.25, else 7), and
 * the key the estimator passes is the literal "Pretable Estimate 14", which
 * matches none of them. Every grid, in every font, got 7.
 *
 * Measured against real rows, that predicts 3 lines where Chromium draws 2 —
 * 250px of the estimator's 299px total error on the homepage hero.
 *
 * This measures the real thing with `canvas.measureText`, which costs no layout
 * and no reflow: nothing is inserted into the document. One call per font per
 * session.
 *
 * A uniform average is still a uniform average. Text whose character mix is
 * unusual — all caps, digit-heavy, CJK, emoji — will still wrap differently
 * than predicted. Fixing that means per-string measurement, which is a
 * different design and was explicitly deferred rather than half-built here.
 */

const widthByFont = new Map<string, number | null>();

let segmenter: Intl.Segmenter | null = null;

function countGraphemes(text: string): number {
  // Code-unit length would halve the answer for emoji and mis-count combining
  // marks, and this number is a divisor.
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    segmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let count = 0;
    for (const _ of segmenter.segment(text)) count += 1;
    return count;
  }
  return [...text].length;
}

function getMeasuringContext(): CanvasRenderingContext2D | null {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(1, 1).getContext(
      "2d",
    ) as CanvasRenderingContext2D | null;
  }
  if (typeof document === "undefined") return null;
  return document.createElement("canvas").getContext("2d");
}

/**
 * Average advance width of `sampleText` in `font`, or `null` when it cannot be
 * measured. `font` is a CSS font shorthand, the same value a canvas context
 * takes.
 *
 * Null is the honest answer on the server and in jsdom, and callers must treat
 * it as "keep the existing guess" — an unmeasured grid has to estimate exactly
 * as it did before this existed.
 *
 * @internal
 */
export function measureAverageCharWidth(
  font: string,
  sampleText: string,
): number | null {
  const cached = widthByFont.get(font);
  if (cached !== undefined) return cached;

  const context = getMeasuringContext();
  const graphemes = countGraphemes(sampleText);
  if (context === null || graphemes === 0) {
    // Not cached: a later call may have a canvas (post-hydration) or real
    // sample text, and caching null here would pin the grid to the guess for
    // the rest of the session.
    return null;
  }

  context.font = font;
  const width = context.measureText(sampleText).width / graphemes;
  const resolved = Number.isFinite(width) && width > 0 ? width : null;
  if (resolved !== null) widthByFont.set(font, resolved);
  return resolved;
}

/** @internal */
export function resetTextMetricsCacheForTesting(): void {
  widthByFont.clear();
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/text-metrics.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation-check**

| Mutation | Expected |
| --- | --- |
| Replace `countGraphemes` with `text.length` | "counts graphemes, not code units" FAILS |
| Remove the `graphemes === 0` guard | "returns null for empty sample text" FAILS |
| Remove the cache write | "caches per font" FAILS |
| Return a number instead of `null` when `context === null` | "returns null without a canvas" FAILS |

Report each. Any mutation leaving the suite green is an untested line — fix the test and say which.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react lint
```

```bash
git add packages/react/src/text-metrics.ts packages/react/src/__tests__/text-metrics.test.ts
git commit -m "feat(react): measure a font's real average character width"
```

---

## Task 2: Thread it into the estimator

**Files:**
- Modify: `packages/renderer-dom/src/create-renderer.ts`
- Modify: `packages/renderer-dom/src/types.ts`
- Modify: `packages/renderer-dom/src/row-layout-controller.ts`
- Modify: `packages/react/src/pretable-model.ts`
- Modify: `packages/renderer-dom/src/__tests__/indexed-renderer.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `indexed-renderer.test.ts`, inside the existing `describe("indexed DOM row layout controller", ...)`:

```ts
  test("a measured character width changes the predicted line count", () => {
    // The hero's failing shape: 87 characters at 320px. At the guessed 7px per
    // character that is 3 lines; the browser draws 2. This is the whole defect
    // in one assertion.
    const row = {
      id: "r0",
      team: "A",
      score: 1,
      label:
        "Momentum strong into the print. Options skew rich; size is already at the model cap.",
    };
    const columns = [
      { id: "label", wrap: true, widthPx: 320, value: (e: typeof row) => e.label },
    ] as const;

    expect(predictRowLineCount(row, columns)).toBe(3);
    expect(predictRowLineCount(row, columns, 6)).toBe(2);
  });
```

- [ ] **Step 2: Run and confirm FAIL**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run -t "measured character width"
```

Expected: FAIL — `predictRowLineCount` takes two parameters today.

- [ ] **Step 3: Extend `create-renderer.ts`**

Give both `estimateDomRowHeight` and `predictRowLineCount` a trailing `averageCharWidthPx: number | null = null` parameter, and pass it through to `prepareText`:

```ts
    const prepared = prepareText({
      text: String(readCellValue(row, column)),
      fontKey: ESTIMATE_FONT_KEY,
      // Measured where the platform allows it; the guess otherwise. `prepareText`
      // infers a width from the font-key string when this is undefined, and the
      // key we pass matches none of its patterns — so the guess is always 7.
      averageCharWidth: averageCharWidthPx ?? ESTIMATED_CHARACTER_WIDTH,
    });
```

Add `averageCharWidthPx` to the memo record and to **both** cache-hit comparisons, exactly as `calibrationRef` already is. It is a number, so compare by value.

- [ ] **Step 4: Add the controller option**

In `packages/renderer-dom/src/types.ts`, on the controller options interface:

```ts
  /**
   * Resolves the grid font's average character width, or `null` when it cannot
   * be measured (server rendering, no canvas). Called lazily per estimate, not
   * once at construction: the font is only measurable after something has
   * rendered, and a controller is built before that.
   */
  readonly getAverageCharWidthPx?: () => number | null;
```

In `row-layout-controller.ts`, use it inside the estimate closure:

```ts
  const estimateRowHeight =
    options.estimateRowHeight ??
    ((row: TRow) =>
      estimateDomRowHeight(
        row,
        layoutColumns,
        defaultRowHeight,
        calibration.getParameters(),
        options.getAverageCharWidthPx?.() ?? null,
      ));
```

and pass the same value to `predictRowLineCount` where `measure` observes a calibration sample, so the fit is against the line count the estimate actually used.

- [ ] **Step 5: Supply it from React**

In `packages/react/src/pretable-model.ts`, beside `defaultRowHeight: getThemeRowHeight()`:

```ts
      getAverageCharWidthPx: () => getGridAverageCharWidth(),
```

Implement `getGridAverageCharWidth` in `packages/react/src/text-metrics.ts`: read the computed `font` shorthand from a rendered wrapped cell (`[data-pretable-cell][data-pretable-wrap="true"]`), fall back to any `[data-pretable-cell]`, and use that cell's own `textContent` as the sample when it is non-empty, else a fixed sample string. Return `null` when no cell has rendered yet — the estimator then keeps the guess, which is correct for the pre-first-render case.

Prefer real cell text over a synthetic alphabet: average character width is content-dependent, and a corpus string bakes in English-prose bias.

- [ ] **Step 6: Run everything**

```bash
pnpm --filter @pretable-internal/renderer-dom test && pnpm --filter @pretable/react test
```

Expected: PASS. **The two pre-existing estimator tests must pass unedited** — with `getAverageCharWidthPx` absent or returning `null`, estimates are byte-identical to today. If either fails, the safety property is broken; fix the implementation, not the test.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer-dom/src packages/react/src
git commit -m "feat(renderer-dom): predict line counts from a measured character width"
```

---

## Task 3: The gate

**Files:** none modified, unless the fixture needs regenerating.

- [ ] **Step 1: Run the accuracy test**

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run src/__tests__/row-height-accuracy.test.ts
```

It prints `mean |estimate - measured|: <before> -> <after>`. The recorded baseline is **13.0 → 13.0** (red).

Note this test drives `estimateDomRowHeight` directly, so it must pass a measured character width for the fix to be exercised. The hero's real value is not yet known — obtain it by measuring `14px Inter` (or whatever the hero cell's computed font actually is; check rather than assume) with the Task 1 helper, and pass that. Record the number you used.

| Observation | Verdict |
| --- | --- |
| Calibrated error materially below uncalibrated, and below 13.0 | **PASS** |
| Unchanged or worse | **STOP and report.** Do not adjust the fixture or the assertion. |

- [ ] **Step 2: Assert the line count directly**

Height error can improve for the wrong reasons. Add to `row-height-accuracy.test.ts`:

```ts
  test("the 87-character samples predict two lines, not three", () => {
    const wide = HERO_ROW_HEIGHT_SAMPLES.filter(
      (sample) => sample.heightPx === 89,
    );
    expect(wide.length).toBeGreaterThan(0);
    for (const sample of wide) {
      expect(
        predictRowLineCount(
          { analyst: sample.text },
          columnsFor(sample),
          HERO_AVERAGE_CHAR_WIDTH_PX,
        ),
      ).toBe(2);
    }
  });
```

with `HERO_AVERAGE_CHAR_WIDTH_PX` exported from the fixture alongside the samples, carrying the measured value and how it was obtained.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer-dom/src/__tests__
git commit -m "test(renderer-dom): pin the corrected line-count prediction"
```

---

## Task 4: Regression checks, changeset, PR

- [ ] **Step 1: Bench no-regression**

```bash
pnpm bench:matrix --adapters=pretable --scenarios=S1,S2,S3,S7 --scripts=initial,scroll --scale=dev
```

Baseline (runset `2026-08-13t04-27-03-476z`): S1 scroll **1**, S2 scroll **4**, S3 scroll **1**, S7 scroll **4**. `initial` runs emit no value. A rise is disqualifying; flat or lower is fine.

- [ ] **Step 2: Hero symptom check**

```bash
pnpm --filter @pretable/app-website build
```

```bash
cd apps/website && pnpm exec next start -p 3188
```

Observe `data-pretable-row-height` for 8 seconds in Chromium and report the distinct published values. `66` and `114` were the estimator's old outputs; expect them absent or confined to the first frames. Delete any probe, run `e2e/smoke.spec.ts`, stop the server.

- [ ] **Step 3: Changeset, repo checks**

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

Build before `api:check` — it reads `dist/`. Note `getAverageCharWidthPx` is a new option on a private package's type; if a published report changes, regenerate with `pnpm api` and commit.

- [ ] **Step 4: Push and open the PR**

Lead the body with the accuracy numbers — baseline 13.0px and whatever Task 3 produced — plus the line-count fix. Name the residual explicitly: a uniform average still mispredicts unusual character mixes (all caps, digits, CJK, emoji), and `@chenglou/pretext` was evaluated and declined for that case.

- [ ] **Step 5: Merge on green,** reading the state back from `gh pr view`.

---

## Out of scope

Per-string measurement or a pluggable measurer inside `text-core`. If a uniform average proves insufficient, revisiting the declined dependency is more honest than growing our own.
