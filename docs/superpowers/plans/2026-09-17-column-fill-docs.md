# Column Fill Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close #604 by documenting `flex` with a live example and using it on the site's own grids, with no library behaviour change.

**Architecture:** One new example folder under `apps/website/content/examples/column-flex/`, one new docs section in `column-layout.mdx`, `flex` added to two existing column definitions, one Playwright spec proving the row ends at the viewport edge.

**Tech Stack:** MDX docs with the `<Example>` running-examples component, the example registry codegen (`pnpm --filter @pretable/app-website examples:gen`), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-column-fill-docs-design.md`
**Branch:** `blove/column-fill-604` in this worktree (`/Users/blove/repos/pretable/.claude/worktrees/dense-handle-filter-followups-3bb3d8`). Node 24. The website package is `@pretable/app-website`. Never `git checkout` a branch, never `git stash`.

---

### Task 1: The `column-flex` example and the docs section

**Files:**
- Create: `apps/website/content/examples/column-flex/example.ts`, `demo.tsx`, `ColumnFlexGrid.tsx`, `columns.ts`, `data.ts`
- Modify: `apps/website/content/docs/grid/column-layout.mdx` (new section before `## Auto width`; link from the flex clause in Auto width)
- Modify: `apps/website/lib/docs/examples/registry.generated.ts`, `demos.generated.ts` (via `examples:gen`, never by hand)

- [ ] **Step 1: Read the authoring contract and a sibling example**

Read `docs/superpowers/specs/2026-08-14-examples-first-docs.md` sections "The authoring contract", "Non-negotiable API facts", "The verification bar". Read every file in `apps/website/content/examples/column-layout/` as the template for structure, imports, and the `[!focus` marker convention.

- [ ] **Step 2: Write `columns.ts`**

```ts
import type { PretableColumn } from "@pretable/react";

import type { Ticket } from "./data";

/**
 * Two fixed columns and two flexible ones. The leftover viewport width is
 * split 2:1 between Summary and Owner; Owner also carries a floor so it never
 * collapses to a sliver when the viewport is narrow.
 */
export const columns: PretableColumn<Ticket>[] = [
  { id: "key", header: "Key", widthPx: 96 },
  { id: "status", header: "Status", widthPx: 120 },
  // [!focus start]
  { id: "summary", header: "Summary", flex: 2 },
  { id: "owner", header: "Owner", flex: 1, minWidthPx: 140 },
  // [!focus end]
];
```

Use the exact focus-marker syntax the `column-layout` example uses; the above is a placeholder for that syntax, not a new one.

- [ ] **Step 3: Write `data.ts`** with 12 rows of `{ id, key, status, summary, owner }` with varied summary lengths (some long, so the flex column visibly earns its width).

- [ ] **Step 4: Write `ColumnFlexGrid.tsx`** rendering `<Pretable>` (or the component the sibling uses) with `ariaLabel="Column flex"`, the columns, the rows, a fixed `viewportHeight`, and beneath it one sentence: "Key and Status are fixed; Summary and Owner share the rest 2:1, and Owner never goes under 140px." Match the sibling's wrapper markup so the Example component sizes it.

- [ ] **Step 5: Write `demo.tsx` and `example.ts`**

`example.ts`:

```ts
import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Fill the viewport with flex",
  description:
    "Two fixed columns, two flexible ones sharing the leftover width 2:1, and a floor on the narrower one.",
  files: ["ColumnFlexGrid.tsx", "columns.ts", "data.ts"],
});
```

`demo.tsx` default-exports a props-free component rendering `ColumnFlexGrid`, as the sibling's does.

- [ ] **Step 6: Generate the registry and run the check**

```bash
pnpm --filter @pretable/app-website examples:gen && pnpm --filter @pretable/app-website examples:check
```

Expected: both exit 0; the two generated files change.

- [ ] **Step 7: Add the docs section**

In `column-layout.mdx`, directly before `## Auto width`, insert:

```mdx
## Fill the viewport

<Example id="column-flex" />

A column that declares `flex` takes a share of whatever width the fixed columns leave. The leftover is the viewport width minus the sum of every non-flex column's width; flex columns split it in proportion to their `flex` values, and the rounding is settled on the last one so the row ends on the viewport edge rather than a pixel short. `minWidthPx` and `maxWidthPx` clamp a share, and a column with neither still never drops under a 24px floor.

When the fixed columns alone are wider than the viewport there is nothing to share: each flex column keeps its own width and the grid scrolls horizontally, which beats an unreadable sliver.

[ONE SENTENCE ABOUT WHAT A RESIZE DRAG DOES TO A FLEX COLUMN — written from what you observe in Step 9, not from this plan.]

Nothing flexes unless you say so. A grid whose columns are all fixed leaves the remaining width empty, which is the right default for a spreadsheet-shaped grid and the wrong one for a full-width panel; give the last column `flex: 1` in that case.
```

Then in `## Auto width`, change "or takes a flex share when the column declares `flex`" to "or takes a flex share when the column declares `flex` (see [Fill the viewport](#fill-the-viewport))".

- [ ] **Step 8: Run the website unit suite and lint**

```bash
pnpm --filter @pretable/app-website test && pnpm --filter @pretable/app-website lint && pnpm --filter @pretable/app-website typecheck
```

Expected: green. The docs guard checks every registered example is referenced exactly once and every `<Example id>` resolves.

- [ ] **Step 9: Observe resize on a flex column, then write the sentence**

Build and start the site (`pnpm --filter @pretable/ui build && pnpm --filter @pretable/react build && pnpm --filter @pretable/app-website build && pnpm --filter @pretable/app-website start`, port 3000 unless held). Open `/docs/grid/column-layout` in Playwright at 1280 wide, find the `column-flex` example's grid, drag the Summary column's resize handle 100px to the left (use `dragResizeHandle` from `apps/website/e2e/helpers.ts`), and record the four header widths before and after, and whether the row still ends at the viewport edge. Replace the bracketed sentence in Step 7 with what happened. If the behaviour looks like a bug (for example the drag has no effect, or the row no longer ends at the edge), stop and report DONE_WITH_CONCERNS with the numbers.

- [ ] **Step 10: Commit**

```bash
git add apps/website/content/examples/column-flex apps/website/content/docs/grid/column-layout.mdx apps/website/lib/docs/examples
git commit -m "docs: fill the viewport with flex — live example and section

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Showcase grids use flex, and a Playwright proof

**Files:**
- Modify: `apps/website/app/components/heroGrid/positionColumns.tsx` (the `widthPx: 320` column)
- Modify: `apps/website/app/fixtures/scrolled-seam/page.tsx`
- Create: `apps/website/e2e/column-flex.spec.ts`

- [ ] **Step 1: Hero and fixture**

In `positionColumns.tsx`, on the column with `widthPx: 320` (AI Analyst), add `flex: 1, minWidthPx: 320` and keep `widthPx: 320`. In the fixture, change the amount column to `{ id: "amount", header: "Amount", type: "number", widthPx: 140, flex: 1, minWidthPx: 140 }`.

- [ ] **Step 2: Write the failing spec**

```ts
import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The "Fill the viewport" section claims a row with flex columns ends exactly
 * on the viewport edge. That is a pixel claim, so it is asserted on the drawn
 * header cells of the real example at two page widths.
 */

const PAGE = "/docs/grid/column-layout";
const SCOPE = '[data-example-id="column-flex"]';

for (const width of [1280, 900]) {
  test(`flex columns end on the viewport edge at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await waitForGridReady(page, SCOPE);
    const viewport = page.locator(`${SCOPE} [data-pretable-scroll-viewport]`).first();
    const clientWidth = await viewport.evaluate((el) => el.clientWidth);
    const cells = viewport.locator("[data-pretable-header-cell]");
    const widths = await cells.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    const total = widths.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - clientWidth)).toBeLessThanOrEqual(1);
  });
}
```

Check how the Example component marks its root (grep `apps/website/lib/docs/examples` and the `Example` component for a `data-` attribute carrying the slug) and use that selector for `SCOPE`; if there is none, add `data-example-id={slug}` to the component's root element as part of this task and say so. If the header includes a row-select cell or the grid clips header cells by virtualization, use the sum of `[data-pretable-header-cell]` widths in the drawn header row and compare to `clientWidth` minus any right-pinned width; explain the adjustment in a comment.

- [ ] **Step 3: Run locally**

Build, start on a free port, `BASE_URL=http://localhost:<port> pnpm --filter @pretable/app-website exec playwright test column-flex.spec.ts --workers=1`. Expected: 4 passed (2 widths × 2 browsers).

- [ ] **Step 4: Mutation**

Temporarily remove `flex: 2` and `flex: 1` from the example's `columns.ts`, rebuild the website, re-run: expected to fail on the width sum. `git restore` the file, rebuild, green.

- [ ] **Step 5: Hero regression**

`BASE_URL=... pnpm --filter @pretable/app-website exec playwright test grid-header-keyboard.spec.ts grid-tab-wrap-rows.spec.ts --workers=1`. Expected: pass.

- [ ] **Step 6: Screenshots**

Save `docs-column-flex-1280.png` (the example section) and `hero-1400.png` to the scratchpad; do not commit them. Report paths.

- [ ] **Step 7: Commit**

```bash
git add apps/website/app/components/heroGrid/positionColumns.tsx apps/website/app/fixtures/scrolled-seam/page.tsx apps/website/e2e/column-flex.spec.ts
git commit -m "docs(website): hero and seam fixture fill the viewport; prove flex ends on the edge

Closes #604

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

Spec coverage: example (T1), section with the four claims and the observed resize sentence (T1 Steps 7, 9), showcase grids (T2 Step 1), Playwright pixel proof at two widths (T2), hero regression (T2 Step 5), screenshots (T2 Step 6). No placeholders except the deliberately bracketed sentence that Step 9 fills from observation. Names consistent: slug `column-flex`, spec file `column-flex.spec.ts`.
