# Hero Grid Row-Height Jitter Implementation Plan — SUPERSEDED

> **SUPERSEDED.** Task 1 (the verification gate) ran and falsified the hypothesis
> this plan was built on. Only Task 1 was executed; nothing else here was
> implemented. See `docs/superpowers/plans/2026-08-12-row-height-estimate-stomping.md`.


> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the homepage hero grid from jittering in Chrome while the price book streams, by removing the positional dependency from `@pretable/react`'s row-height measurement and by making the hero's tick-flash underline non-layout.

**Architecture:** Verify first — a throwaway Playwright probe decides which of two library fixes the data supports (stateless sub-pixel quantization, or a stateful raw-measurement deadband). Then the library fix lands with unit + browser regression tests while the hero cell is left untouched, so the browser test proves jitter dies with the layout-affecting underline still in place. The hero cell fix lands second, on its own merits.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom), Playwright, pnpm workspaces, Next.js (apps/website).

**Spec:** `docs/superpowers/specs/2026-08-12-hero-grid-row-height-jitter-design.md`

---

## Context an engineer needs before starting

**Repo layout.** `packages/react` is the grid renderer; `apps/website` is the marketing site that consumes the **built** `@pretable/*` packages. Any `packages/react` source change is invisible to the website until the website is rebuilt (`prepare:deps` runs as a `prebuild` hook).

**Where row heights come from.** `packages/react/src/row-height.ts` exports `measureRenderedRowHeight(row, minRowHeight)`. It walks every `[data-pretable-cell]` in the row, measures each cell's intrinsic content with a DOM `Range` (not `scrollHeight` — cells flex-stretch to the row height, so `scrollHeight` feeds the applied height back and never settles), takes the max, adds the row's own padding/border, and `Math.ceil`s against a floor.

The consumer is a layout effect in `packages/react/src/pretable-surface.tsx` (search for `measureRenderedRowHeight`, around line 3146). It skips rows whose measurement key is unchanged, then calls `indexedGrid.measureRow(rendered.ref, measuredHeight)`. The key (`getRowMeasurementKey`, around line 5155) includes `cell.textContent`, so a streaming price column invalidates it every tick.

**jsdom has no layout engine.** Every element measures zero there, which is why `measureCellContentHeight` has a `scrollHeight` fallback. You cannot reproduce sub-pixel behaviour in jsdom — the unit tests in this plan stub the geometry deliberately, and the *real* proof is the Playwright test.

**Running things (all commands from the repo root unless stated):**

```bash
pnpm --filter @pretable/react test          # builds deps, then vitest run
pnpm --filter @pretable/react typecheck
pnpm --filter @pretable/react lint
```

Website end-to-end needs a production build and a served port — `next dev` times tests out on first-compile latency:

```bash
pnpm --filter @pretable/app-website build
```

```bash
cd apps/website && pnpm exec next start -p 3188
```

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test --project=chromium --workers=1
```

Use **this worktree's** Playwright binary (`pnpm exec` from `apps/website` does that). Invoking the main checkout's binary fails with a misleading `No tests found`.

**The website package is `@pretable/app-website`**, not `@pretable/website` (the latter silently matches nothing).

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/website/e2e/hero-row-height-probe.spec.ts` | **Throwaway.** Diagnostic probe that prints published + raw heights. Deleted in Task 2. | 1 |
| `apps/website/e2e/hero-row-height.spec.ts` | Permanent browser regression test: a streaming row's published height has exactly one distinct value. | 2 |
| `packages/react/src/row-height.ts` | Measurement. Gains a raw-extent function and (branch B only) a deadband predicate. Owns the positional-independence invariant. | 4 |
| `packages/react/src/__tests__/row-height-stability.test.ts` | Unit proof that a jittering measurement sequence publishes one height, and that a genuine line-height change still publishes. | 3, 5 |
| `packages/react/src/pretable-surface.tsx` | Publish site. Branch B only: retains the last raw measurement per row. | 4 |
| `apps/website/app/components/heroGrid/cells.module.css` | The tick-flash underline, redrawn to not participate in layout. | 6 |

---

## Task 1: Verification probe — decide which fix the data supports

Nothing else in this plan may start until this task produces data. If the data contradicts the hypothesis, **stop and report** rather than implementing a fix.

**Files:**
- Create (throwaway): `apps/website/e2e/hero-row-height-probe.spec.ts`

- [ ] **Step 1: Build the website against current sources**

```bash
pnpm --filter @pretable/app-website build
```

Expected: build succeeds. This runs `prepare:deps`, so the built `@pretable/react` matches HEAD.

- [ ] **Step 2: Start the production server (leave it running for Tasks 1, 2, 5)**

```bash
cd apps/website && pnpm exec next start -p 3188
```

Expected: `Ready` on `http://localhost:3188`. Run this in the background.

- [ ] **Step 3: Write the probe**

Create `apps/website/e2e/hero-row-height-probe.spec.ts`:

```ts
import { test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * DIAGNOSTIC ONLY — deleted in Task 2 of the row-height-jitter plan.
 *
 * Prints, per animation frame for ~2s: the row height pretable published, and
 * the raw fractional content extent of the ticking `last` cell measured the
 * same way `row-height.ts` measures it.
 */
test("probe: hero row heights while streaming", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const samples = await page.evaluate(async () => {
    const row = document.querySelector<HTMLElement>("[data-pretable-row]");
    if (!row) throw new Error("no row");
    const out: { published: string | null; raw: number }[] = [];

    await new Promise<void>((resolve) => {
      const started = performance.now();
      const tick = () => {
        const cell = row.querySelector<HTMLElement>(
          '[data-pretable-cell][data-pretable-column-id="last"]',
        );
        let raw = 0;
        if (cell) {
          const range = document.createRange();
          range.selectNodeContents(cell);
          raw = range.getBoundingClientRect().height;
        }
        out.push({
          published: row.getAttribute("data-pretable-row-height"),
          raw,
        });
        if (performance.now() - started < 2000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    return out;
  });

  const published = [...new Set(samples.map((s) => s.published))];
  const raws = samples.map((s) => s.raw);
  console.log("distinct published heights:", published);
  console.log("raw min/max:", Math.min(...raws), Math.max(...raws));
  console.log("distinct raw values:", [...new Set(raws)].sort((a, b) => a - b));
});
```

- [ ] **Step 4: Run the probe**

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/hero-row-height-probe.spec.ts --project=chromium --workers=1
```

Expected: PASS, with three `console.log` lines in the output.

- [ ] **Step 5: Apply the decision rule**

Read the output and pick exactly one branch. Record the numbers in the commit message of Task 4.

| Observation | Branch |
| --- | --- |
| More than one distinct published height, **and** raw max − raw min ≤ 0.1 with the values straddling an integer | **Branch A — quantize** (Task 4A) |
| More than one distinct published height, **and** raw spread > 0.1 | **Branch B — deadband** (Task 4B) |
| Exactly one distinct published height | **STOP.** The hypothesis is wrong. Report the numbers and re-brainstorm. Do not implement either branch. |

---

## Task 2: Browser regression test, recorded failing

**Files:**
- Create: `apps/website/e2e/hero-row-height.spec.ts`
- Delete: `apps/website/e2e/hero-row-height-probe.spec.ts`

- [ ] **Step 1: Write the regression test**

Create `apps/website/e2e/hero-row-height.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * A row's published height must not change while only its CONTENT ticks.
 *
 * The hero's `last` column flashes an underline on every tick, which adds about
 * a pixel to the cell's content extent. That is legitimate — what is not is the
 * height oscillating: `Range.getBoundingClientRect()` is viewport-relative and
 * fractional, so a content extent sitting on an integer boundary rounds
 * differently depending on where the row currently sits sub-pixel-wise. Ceil
 * flips, the row moves, the next measurement lands on the other side, and the
 * grid jitters at the streaming rate.
 *
 * Chrome only, deliberately: WebKit's layout rounding does not reproduce it, so
 * a passing WebKit run would be no evidence either way.
 */
test("hero row heights are stable while the book streams", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "sub-pixel rounding behaviour is Chrome-specific",
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForGridReady(page);

  const heightsByRow = await page.evaluate(async () => {
    const seen = new Map<string, Set<string>>();

    await new Promise<void>((resolve) => {
      const started = performance.now();
      const tick = () => {
        for (const row of document.querySelectorAll<HTMLElement>(
          "[data-pretable-row]",
        )) {
          const id = row.getAttribute("data-pretable-row-id") ?? "";
          const height = row.getAttribute("data-pretable-row-height") ?? "";
          const bucket = seen.get(id) ?? new Set<string>();
          bucket.add(height);
          seen.set(id, bucket);
        }
        if (performance.now() - started < 2000) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    return [...seen].map(([id, heights]) => ({ id, heights: [...heights] }));
  });

  expect(heightsByRow.length).toBeGreaterThan(0);
  for (const row of heightsByRow) {
    expect(
      row.heights,
      `row ${row.id} published more than one height while streaming`,
    ).toHaveLength(1);
  }
});
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/hero-row-height.spec.ts --project=chromium --workers=1
```

Expected: FAIL, with a message naming a row that published more than one height. Copy the failure output into the Task 5 commit message.

If it PASSES here, the hypothesis is not reproducing under Playwright. **Stop and report** — do not weaken the test to make it fail.

- [ ] **Step 3: Delete the probe**

```bash
rm apps/website/e2e/hero-row-height-probe.spec.ts
```

- [ ] **Step 4: Commit the failing test**

```bash
git add apps/website/e2e/hero-row-height.spec.ts
git commit -m "test(website): pin hero row heights as stable under streaming"
```

---

## Task 3: Unit test for measurement stability, recorded failing

This test is written against a small refactor of `row-height.ts` that Task 4 performs: the raw fractional extent is separated from the flooring/ceiling step, so both are directly testable. The test therefore fails to compile until Task 4 — that is the intended red state.

**Files:**
- Create: `packages/react/src/__tests__/row-height-stability.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/react/src/__tests__/row-height-stability.test.ts`:

```ts
// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";

import { clampRowHeight, measureRowContentExtent } from "../row-height";

/**
 * jsdom has no layout engine, so a real sub-pixel oscillation cannot be
 * produced here. What CAN be pinned here is the arithmetic that turns a
 * fractional extent into a published integer — which is where the jitter comes
 * from. The geometry is stubbed to replay the sequence a real Chrome frame
 * loop produces when a row's content sits on an integer boundary.
 */

const ROW_FLOOR = 40;

/** A row whose single cell reports `extent` as its Range-measured content. */
function rowMeasuring(extent: number): HTMLElement {
  const row = document.createElement("div");
  const cell = document.createElement("div");
  cell.setAttribute("data-pretable-cell", "");
  row.appendChild(cell);
  document.body.appendChild(row);

  // Non-zero box, so the measurement takes the Range path rather than the
  // jsdom scrollHeight fallback.
  cell.getBoundingClientRect = () =>
    ({ width: 96, height: extent }) as DOMRect;

  vi.spyOn(document, "createRange").mockImplementation(
    () =>
      ({
        selectNodeContents: () => {},
        getBoundingClientRect: () => ({ height: extent }) as DOMRect,
      }) as unknown as Range,
  );

  return row;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("row height stability", () => {
  test("a sub-pixel jitter around an integer publishes one height", () => {
    // What Chrome produces for a 1px-underlined cell whose extent lands on 41:
    // the same content, measured at different sub-pixel row offsets.
    const sequence = [40.998, 41.002, 40.999, 41.001, 41.0];

    const published = sequence.map((extent) =>
      clampRowHeight(measureRowContentExtent(rowMeasuring(extent)), ROW_FLOOR),
    );

    expect(new Set(published).size).toBe(1);
  });

  test("a genuine line-height change still publishes a new height", () => {
    const single = clampRowHeight(
      measureRowContentExtent(rowMeasuring(41.0)),
      ROW_FLOOR,
    );
    const wrapped = clampRowHeight(
      measureRowContentExtent(rowMeasuring(59.0)),
      ROW_FLOOR,
    );

    expect(wrapped).toBeGreaterThan(single);
    expect(wrapped).toBeGreaterThanOrEqual(59);
  });

  test("the floor still wins for content shorter than it", () => {
    expect(clampRowHeight(12.4, ROW_FLOOR)).toBe(ROW_FLOOR);
  });
});
```

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/row-height-stability.test.ts
```

Expected: FAIL — `clampRowHeight` and `measureRowContentExtent` are not exported from `../row-height` yet.

- [ ] **Step 3: Do not commit yet.** This test is committed together with the fix in Task 4.

---

## Task 4: Library fix

Execute **exactly one** of 4A or 4B, per the Task 1 decision. Both keep the entire fix inside `row-height.ts`'s arithmetic so the unit test from Task 3 covers it either way.

### Task 4A — Quantize (stateless; take this if raw spread ≤ 0.1)

**Files:**
- Modify: `packages/react/src/row-height.ts`

- [ ] **Step 1: Restructure `row-height.ts` and add the quantization**

Replace the body of `measureRenderedRowHeight` and add the two new exports. The full replacement for everything from the `measureRenderedRowHeight` doc comment to end of file:

```ts
/**
 * Chrome lays out in 1/64px `LayoutUnit`s, and `Range.getBoundingClientRect()`
 * is viewport-relative — so the SAME content measures a hair differently
 * depending on where the row currently sits sub-pixel-wise. Left alone that is
 * a feedback loop through geometry rather than through the box: the extent
 * lands on an integer boundary, `Math.ceil` flips between N and N+1, the row
 * moves, and the next measurement lands on the other side of the boundary. At a
 * streaming update rate that reads as jitter.
 *
 * Snapping the extent to a 1/16px grid is four times coarser than anything the
 * layout engine can produce, so the noise is erased deterministically while any
 * real difference (the smallest of which is a line height) survives untouched.
 *
 * The invariant, stated plainly: a row's measured height must not depend on
 * where the row currently sits sub-pixel-wise.
 */
const SUBPIXEL_GRID = 16;

/**
 * The row's raw content extent — the tallest cell's intrinsic content plus the
 * row's own vertical padding and border — snapped to the sub-pixel grid.
 *
 * Split out from {@link measureRenderedRowHeight} so the measurement and the
 * flooring arithmetic can be tested independently; jsdom cannot produce real
 * sub-pixel geometry, so the arithmetic is the only part unit tests can pin.
 *
 * @internal
 */
export function measureRowContentExtent(row: HTMLElement): number {
  const style = getComputedStyle(row);
  const verticalPadding =
    parsePxLength(style.paddingTop) + parsePxLength(style.paddingBottom);
  const borderHeight = parsePxLength(style.borderBottomWidth);
  // Every cell, unconditionally. This used to measure only
  // `[data-pretable-wrap="true"]` cells whenever the row had any, falling back
  // to all cells only when it had none. That was an optimisation and it was
  // wrong: any TALLER non-wrap cell in a row that also carried a wrap column
  // was excluded from the max and silently clipped — a two-line presentation
  // (a signed delta over its percentage, say) rendered at single-line height.
  // jsdom has no layout engine, so the clipping was invisible to unit tests and
  // only ever showed in a browser. `Math.max` over every cell is the correct
  // definition of a row's content height, and the cells are already being
  // walked, so the narrower query bought nothing.
  const measuredCells = [
    ...row.querySelectorAll<HTMLElement>("[data-pretable-cell]"),
  ];
  const contentHeight = Math.max(
    0,
    ...measuredCells
      .map((cell) => measureCellContentHeight(cell))
      .filter(Number.isFinite),
  );

  const extent = contentHeight + verticalPadding + borderHeight;
  return Math.round(extent * SUBPIXEL_GRID) / SUBPIXEL_GRID;
}

/**
 * Turns a content extent into the integer height a row is drawn at.
 *
 * @internal
 */
export function clampRowHeight(extent: number, minRowHeight: number): number {
  return Math.max(minRowHeight, Math.ceil(extent));
}

/**
 * DOM measurement helper used internally by the surface's row-height accounting. Not part of the user-facing API.
 *
 * `minRowHeight` is the active theme's `--pretable-row-height` for the current
 * density tier, resolved by the caller — the surface reads it once per render
 * through the same store that drives density, rather than every row doing its
 * own `getComputedStyle` on the document element.
 *
 * It defaults to {@link DEFAULT_ROW_HEIGHT} for the no-theme case only. Passing
 * a constant here is what made three of the nine shipped density tiers
 * unreachable: Excel's rows are 20/24/32px and both other themes are 40 at
 * compact, so a 44 floor simply won.
 *
 * @internal
 */
export function measureRenderedRowHeight(
  row: HTMLElement,
  minRowHeight: number = DEFAULT_ROW_HEIGHT,
) {
  return clampRowHeight(measureRowContentExtent(row), minRowHeight);
}
```

- [ ] **Step 2: Run the unit test**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/row-height-stability.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Run the existing row-height suite for regressions**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/row-height-floor.test.tsx
```

Expected: PASS. If the floor test fails, the restructure changed behaviour it pins — fix the restructure, not the test.

- [ ] **Step 4: Skip to Task 5.**

### Task 4B — Deadband (stateful; take this if raw spread > 0.1)

**Files:**
- Modify: `packages/react/src/row-height.ts`
- Modify: `packages/react/src/pretable-surface.tsx`

- [ ] **Step 1: Restructure `row-height.ts`**

Apply the *same* replacement as Task 4A Step 1, but **without** the quantization — in `measureRowContentExtent`, the last two lines become:

```ts
  return contentHeight + verticalPadding + borderHeight;
```

and delete the `SUBPIXEL_GRID` constant. Keep the `measureRowContentExtent` / `clampRowHeight` split and the invariant comment.

- [ ] **Step 2: Add the deadband predicate to `row-height.ts`**

Append to `row-height.ts`:

```ts
/**
 * How far a row's raw content extent must move before the row is re-drawn at a
 * new height.
 *
 * The comparison is raw-against-raw deliberately. Comparing a new raw extent
 * against the previously PUBLISHED integer ratchets: the published value is
 * already rounded up, so every subsequent measurement reads as a shrink and the
 * row creeps. Raw-against-raw has no such drift, and the smallest change that
 * should ever move a row — one line of text — is over an order of magnitude
 * outside this band.
 */
const SUBPIXEL_DEADBAND_PX = 0.5;

/**
 * Whether a freshly measured extent is a real change or sub-pixel noise.
 *
 * @internal
 */
export function isMeaningfulExtentChange(
  previousExtent: number | null,
  nextExtent: number,
): boolean {
  return (
    previousExtent === null ||
    Math.abs(nextExtent - previousExtent) > SUBPIXEL_DEADBAND_PX
  );
}
```

- [ ] **Step 3: Adjust the Task 3 unit test for this branch**

Branch B's stability lives in the predicate, not in `clampRowHeight`. Replace the first test in `packages/react/src/__tests__/row-height-stability.test.ts` with:

```ts
  test("a sub-pixel jitter around an integer publishes one height", () => {
    const sequence = [40.998, 41.002, 40.999, 41.001, 41.0];

    let lastExtent: number | null = null;
    let published: number | null = null;
    const heights: number[] = [];

    for (const extent of sequence) {
      const measured = measureRowContentExtent(rowMeasuring(extent));
      if (isMeaningfulExtentChange(lastExtent, measured)) {
        lastExtent = measured;
        published = clampRowHeight(measured, ROW_FLOOR);
      }
      heights.push(published as number);
    }

    expect(new Set(heights).size).toBe(1);
  });
```

and extend the import to:

```ts
import {
  clampRowHeight,
  isMeaningfulExtentChange,
  measureRowContentExtent,
} from "../row-height";
```

- [ ] **Step 4: Wire the deadband into the publish site**

In `packages/react/src/pretable-surface.tsx`, next to the other measurement refs (search for `measuredRowKeysRef`), add:

```ts
  const measuredRowExtentsRef = useRef<Record<string, number>>({});
```

Then, in the layout effect that calls `measureRenderedRowHeight` (search for `measureRenderedRowHeight(node, rowHeightFloor)`), replace the two lines

```ts
      const measuredHeight = measureRenderedRowHeight(node, rowHeightFloor);
      indexedGrid.measureRow(rendered.ref, measuredHeight);
```

with

```ts
      // A row's extent is re-measured on every content tick (the measurement key
      // includes cell text), and `Range.getBoundingClientRect()` is
      // viewport-relative — so an unchanged row re-measures a hair differently
      // depending on its current sub-pixel offset. Publishing that would flip
      // the ceiling, move the row, and re-excite the same noise from the other
      // side of the boundary. Only a change big enough to be real is published.
      const measuredExtent = measureRowContentExtent(node);
      const previousExtent = measuredRowExtentsRef.current[renderId] ?? null;
      if (isMeaningfulExtentChange(previousExtent, measuredExtent)) {
        measuredRowExtentsRef.current = {
          ...measuredRowExtentsRef.current,
          [renderId]: measuredExtent,
        };
        indexedGrid.measureRow(
          rendered.ref,
          clampRowHeight(measuredExtent, rowHeightFloor),
        );
      }
```

and update the import at the top of the file (search for `from "./row-height"`) to:

```ts
import {
  clampRowHeight,
  isMeaningfulExtentChange,
  measureRowContentExtent,
} from "./row-height";
```

If `measureRenderedRowHeight` now has no remaining callers in `pretable-surface.tsx`, leave the function itself in place — it is still exported as `ɵmeasureRenderedRowHeight` from `public_api.ts` and removing it is an API change this plan does not authorize.

- [ ] **Step 5: Run the unit test**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/row-height-stability.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Run the existing row-height suite for regressions**

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/row-height-floor.test.tsx
```

Expected: PASS.

---

## Task 5: Prove the mutation check bites, then prove the fix works in a browser

The hero cell is still untouched at this point. That is the whole point of the ordering: the browser test must go green while the layout-affecting underline is still in place.

**Files:**
- Modify (temporarily, then revert): `packages/react/src/row-height.ts`

- [ ] **Step 1: Over-apply the fix and confirm the second unit test fails**

Branch A: change `SUBPIXEL_GRID` from `16` to `0.05` (a 20px grid — coarse enough to swallow a line height).
Branch B: change `SUBPIXEL_DEADBAND_PX` from `0.5` to `40`.

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/row-height-stability.test.ts
```

Expected: FAIL on `a genuine line-height change still publishes a new height`.

If it PASSES, the mutation check is vacuous — the test is not actually constraining the fix. Fix the test before continuing; a stability fix with no counterweight silently clips content.

- [ ] **Step 2: Revert the mutation**

Restore the original constant value. Re-run:

```bash
pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/row-height-stability.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Run the full react suite**

```bash
pnpm --filter @pretable/react test
```

Expected: PASS. This script builds the workspace deps first — a bare `vitest run` would read a stale `dist/` and can pass vacuously. One or two unrelated timeouts are a known local flake on a loaded machine; re-run the named test before believing a failure.

- [ ] **Step 4: Typecheck and lint**

```bash
pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react lint
```

Expected: both clean.

- [ ] **Step 5: Rebuild the website so it picks up the library change**

```bash
pnpm --filter @pretable/app-website build
```

Expected: build succeeds. Restart `next start -p 3188` afterwards so it serves the new build.

- [ ] **Step 6: Run the browser regression test — it must now PASS**

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/hero-row-height.spec.ts --project=chromium --workers=1
```

Expected: PASS, with `cells.module.css` unmodified. Confirm with `git diff --stat apps/website` that no hero CSS is in the working tree.

- [ ] **Step 7: Run the existing hero smoke tests for regressions**

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/smoke.spec.ts --project=chromium --workers=1
```

Expected: PASS.

- [ ] **Step 8: Commit the library fix**

```bash
git add packages/react/src/row-height.ts packages/react/src/__tests__/row-height-stability.test.ts packages/react/src/pretable-surface.tsx
git commit -m "fix(react): make a row's measured height independent of its sub-pixel position"
```

Put the Task 1 probe numbers (distinct published heights, raw min/max) in the commit body — they are the evidence for which branch was taken.

- [ ] **Step 9: Add a changeset**

```bash
pnpm exec changeset
```

Select `@pretable/react`, `patch`, and describe the fix in one line. Commit the generated file.

---

## Task 6: Hero cell — draw the flash without participating in layout

**Files:**
- Modify: `apps/website/app/components/heroGrid/cells.module.css`

- [ ] **Step 1: Record the current row height**

With the server still running, read the published height directly:

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/hero-row-height.spec.ts --project=chromium --workers=1 --reporter=line --trace=off
```

Then capture the number itself with a one-off Node script at `apps/website/e2e/.height-probe.mjs` (delete it after Step 4):

```js
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:3188/", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-pretable-hydrated="true"]', { timeout: 20000 });
console.log(
  "row height:",
  await page
    .locator("[data-pretable-row]")
    .first()
    .getAttribute("data-pretable-row-height"),
);
await browser.close();
```

```bash
cd apps/website && node e2e/.height-probe.mjs
```

Write the printed number down — Step 4 asserts it drops.

- [ ] **Step 2: Redraw the flash**

In `apps/website/app/components/heroGrid/cells.module.css`, replace the `.flash` / `.flashUp` / `.flashDown` rules and both `@keyframes` blocks with:

```css
/* Tick flash.
   Sized against the actual data rate, which is the whole trick here. The book
   ticks ~60x/s across 14 rows, so with the original 1s fade every cell in the
   Last column was mid-flash at every instant — measured, 14 of 14. A signal
   that never stops is not a signal, it is a background fill, and a 24% block
   behind a number cancels out the tabular figures it sits on.
   Now: short enough to land between updates so the flash reads as an event,
   and light enough that overlapping ones stay quiet. Underlined rather than
   filled — the tint sits beneath the digits instead of behind them, so the
   number stays the most legible thing in its own cell.

   The underline is an absolutely-positioned pseudo-element, and it must stay
   one. It was `display: inline-block` with `padding-bottom: 1px`, which pushes
   the box's bottom edge below the text baseline and grows the line box by about
   a pixel — so a 520ms decoration was changing the row's measured height, sixty
   times a second, on every row that ticked. A flash has no business in layout. */
.flash {
  position: relative;
}
.flash::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 2px;
  opacity: 0;
  pointer-events: none;
}
.flashUp::after {
  background: var(--pt-sev-ok);
  animation: flashFade 520ms ease-out;
}
.flashDown::after {
  background: var(--pt-sev-err);
  animation: flashFade 520ms ease-out;
}
@keyframes flashFade {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
```

Leave the `prefers-reduced-motion` block at the bottom of the file as it is — it disables `.flashUp` / `.flashDown` animations and those class names are unchanged.

- [ ] **Step 3: Rebuild and restart**

```bash
pnpm --filter @pretable/app-website build
```

Restart `next start -p 3188`.

- [ ] **Step 4: Verify the underline still draws and the row got shorter**

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test e2e/hero-row-height.spec.ts e2e/smoke.spec.ts --project=chromium --workers=1
```

Expected: PASS. Then confirm visually — take a screenshot mid-stream and check a coloured underline is visible beneath a ticking price, and that the published row height is lower than the number recorded in Step 1.

If the underline is invisible, the likely cause is that `.flash` is an inline element whose pseudo-element has no width; give `.flash` `display: inline-block` **without any padding** (the padding, not the display mode, was the layout culprit) and re-verify the height.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/cells.module.css
git commit -m "fix(website): draw the hero tick flash without changing row height"
```

---

## Task 7: Full verification and PR

- [ ] **Step 1: Whole-repo checks**

```bash
pnpm typecheck && pnpm lint && pnpm format
```

Expected: clean. The root `format` script is `prettier --check .` (there is no `format:check`); if it reports unformatted files, run `pnpm format:write` and commit the result.

- [ ] **Step 2: API report freshness**

Branch B changed exports in `row-height.ts`. `api:check` is a required gate on main, and it reads `dist/` — so build before checking.

```bash
pnpm --filter @pretable/react build && pnpm --filter @pretable/react api:check
```

Expected: clean. If it reports drift, run `pnpm --filter @pretable/react api` and commit the regenerated report.

- [ ] **Step 3: Both browser projects**

```bash
cd apps/website && BASE_URL=http://localhost:3188 pnpm exec playwright test --workers=1
```

Expected: PASS across chromium and webkit. The new spec skips on webkit by design.

- [ ] **Step 4: Stop the local server**

- [ ] **Step 5: Open the PR**

```bash
git push -u origin blove/hero-grid-jitter-chrome-01430d
```

```bash
gh pr create --title "fix(react): row heights independent of sub-pixel position" --body "$(cat <<'EOF'
The hero grid jittered in Chrome while streaming. Two independent defects had collided.

**Library.** `Range.getBoundingClientRect()` is viewport-relative and fractional, so an unchanged row measured differently depending on its current sub-pixel offset. With the content extent sitting on an integer boundary, `Math.ceil` flipped between N and N+1 — the row moved, the next measurement landed on the other side, and it oscillated at the streaming rate. Fixed in `row-height.ts`, with the invariant now stated in the file.

**Hero cell.** The tick-flash underline was an `inline-block` with `padding-bottom: 1px`, which grew the line box — a 520ms decoration was changing row geometry sixty times a second. It is now an absolutely-positioned pseudo-element.

The library commit lands first, with the hero cell untouched, so the new browser regression test proves jitter dies with the layout-affecting underline still in place.

Design: `docs/superpowers/specs/2026-08-12-hero-grid-row-height-jitter-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Merge on green.** Read the merge state back from `gh pr view` — an opened PR is not a merged PR.

---

## Out of scope

`getRowMeasurementKey` includes `cell.textContent`, so every ticking row re-measures all of its cells at ~60Hz. That is what converts a latent instability into visible jitter rather than a one-time settle. It is load-bearing — two-line cells such as Day P&L genuinely change height with content — so it is a separate perf question, not part of this fix.
