# Inspection Grid Layout Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the inspection grid layout regression where pinned sticky header cells stack vertically in block flow, inflating the header row to ~2× `HEADER_HEIGHT` and causing the translucent header backdrop to cover the top of the body grid; all body cells also stack as "cards" because absolute cells inherit non-zero static positions from in-flow sticky siblings.

**Architecture:** The column-virtualization refactor ([dfb6a20](https://github.com/cacheplane/pretable/commit/dfb6a20)) switched cells from CSS grid to absolute positioning for virtualization, but the plan at [`docs/superpowers/plans/2026-04-20-column-virtualization.md:874-894`](../plans/2026-04-20-column-virtualization.md) omitted two things from `getCellStyle` / `getHeaderCellStyle`: explicit `top: 0`, and a row-level layout context (`display: flex`) that keeps in-flow sticky pinned cells from stacking. The design spec at [`docs/superpowers/specs/2026-04-20-column-virtualization-design.md:106`](../specs/2026-04-20-column-virtualization-design.md) explicitly mandates that "pinned columns use `position: sticky; left: <offset>` as they do today" — so the fix preserves sticky for pinned cells and addresses only the missing `top` and parent layout context.

**Tech Stack:** React 19, TypeScript, Vitest, JSDOM, pnpm workspace (package: `@pretable/react`), Playwright (no visual regression configured yet; we'll rely on a DOM-level regression test).

---

## Root-cause summary (for reviewers)

In the shipped build at `http://localhost:5173/`:

- `getHeaderRowStyle()` returns `{ position: sticky, minHeight: HEADER_HEIGHT, minWidth: totalWidth, top: 0, zIndex: 3, ... }` — no `display` → defaults to `block`.
- `getHeaderCellStyle()` / `getCellStyle()` return `{ position: absolute, left, width, height: "100%", ... }` — no `top`.
- `getPinnedCellStyle()` returns `{ position: sticky, left, zIndex: 1, ... }` — spread after the header/body cell style, so pinned cells end up `position: sticky`.

Because the row container is `display: block`, the **in-flow sticky-pinned cells** (Timestamp, Severity) stack vertically — each one 72 px tall, for 144 px total. The **out-of-flow absolute cells** (Source, Owner, Tags, Message) inherit a **static position of `top: 144 px`** (the cursor after the stacked stickies), and with no explicit `top: 0`, they render 144 px below the top of the row. DOM probe at runtime confirms `getComputedStyle(source).top === "144px"` even though no code sets a `top`.

Concrete effect the user sees:

- The translucent header backdrop (`rgba(18, 18, 18, 0.94)`, z-index 3) is 144 px tall instead of 72 px and covers the first visible body row.
- Every body row renders cells as a stacked "card" (TIMESTAMP / SEVERITY / SOURCE / ...) because the same bug pattern applies to body rows.
- Non-pinned cells are cut off on the right (scrollWidth 1284 vs. clientWidth 889) because horizontal scroll is in play but sticky cells are also mispositioned.

## File Structure

| Path                                                              | Role                             | Change                                                                                                                                                                                                                            |
| ----------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/react/src/internal/styles.ts`                           | Row / cell inline-style builders | Add `display: "flex"` + `height: HEADER_HEIGHT` to header row; add `display: "flex"` to body row; add `top: 0` to header cell, body cell, and pinned cell styles                                                                  |
| `packages/react/src/internal/__tests__/pretable-surface.test.tsx` | Surface render tests             | Add a regression test that asserts: header row height === `HEADER_HEIGHT`, all header cells share the same `top: 0`, pinned cells still have `position: sticky`, and non-pinned absolute cells have `top: 0px` in computed styles |
| `docs/superpowers/plans/2026-04-20-column-virtualization.md`      | Column-virtualization plan       | Add a short errata note explaining the omission and linking to this fix plan                                                                                                                                                      |

No new files. No changes to `renderer-dom`, `layout-core`, `grid-core`, or the bench app — this is scoped to the React surface style layer.

---

### Task 1: Add regression test for grid layout geometry (TDD — failing test first)

**Files:**

- Modify: `packages/react/src/internal/__tests__/pretable-surface.test.tsx`

Context: The existing test at line 106-146 (`renders benchmark markers on the scrolling subtree...`) asserts `position: sticky` and `left` values on pinned cells, but it never asserts `top` on any cell nor the total header-row height. That's why the regression shipped. We'll add a dedicated test that pins down the geometry invariants.

- [ ] **Step 1: Add the regression test after the existing "renders benchmark markers..." test**

Insert immediately after the test that ends around line 146. Use the same `columns` and `rows` fixtures already in the file (no need to duplicate; they're defined at the top of the file).

The test targets a known JSDOM gotcha: JSDOM doesn't compute layout, so `getBoundingClientRect()` and `offsetHeight` return zeros. Asserting inline style values (via `toHaveStyle`) is the reliable path. `toHaveStyle` reads the element's `style` attribute, which is what the inline-style builders set.

```typescript
  it("does not stack pinned and absolute header cells vertically (regression: backdrop-over-body)", () => {
    const view = render(
      <PretableSurface
        ariaLabel="Inspection grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={132}
      />,
    );

    const headerRow = view
      .getByRole("button", { name: "Sort Timestamp" })
      .parentElement!;
    const allHeaderButtons = view.getAllByRole("button", {
      name: /^Sort /,
    });
    const pinnedHeader = view.getByRole("button", { name: "Sort Timestamp" });
    const absoluteHeader = view.getByRole("button", { name: "Sort Tags" });

    // Header row MUST lay out children horizontally so sticky siblings do not
    // stack in block flow and inflate the row height.
    expect(headerRow).toHaveStyle({ display: "flex" });
    expect(headerRow).toHaveStyle({ height: "72px" });

    // Every header cell must explicitly anchor to the top of the row; without
    // `top: 0`, absolute cells inherit a static position from in-flow sticky
    // siblings and render below the header row.
    for (const button of allHeaderButtons) {
      expect(button).toHaveStyle({ top: "0px" });
    }

    // Pinned cells must still use sticky (per column-virtualization spec).
    expect(pinnedHeader).toHaveStyle({ position: "sticky", left: "0px" });

    // Non-pinned header cells must be absolutely positioned at the top.
    expect(absoluteHeader).toHaveStyle({ position: "absolute", top: "0px" });

    // Body cells: same invariants — all anchored to top, pinned still sticky.
    const firstRow = view.getAllByTestId("pretable-row")[0]!;
    const bodyCells = firstRow.querySelectorAll("[data-pretable-cell]");
    for (const cell of bodyCells) {
      expect(cell).toHaveStyle({ top: "0px" });
    }
    const pinnedBodyCell = bodyCells[0]!;
    const absoluteBodyCell = bodyCells[bodyCells.length - 1]!;
    expect(pinnedBodyCell).toHaveStyle({ position: "sticky" });
    expect(absoluteBodyCell).toHaveStyle({ position: "absolute" });
    expect(firstRow).toHaveStyle({ display: "flex" });
  });
```

Note on selectors: `headerRow` is the parent of any sort button — since all header buttons are direct children of the header row `<div>` in [pretable-surface.tsx:329](../../packages/react/src/internal/pretable-surface.tsx), `parentElement` is guaranteed to be that `<div>`. `data-pretable-cell` is already set on every body cell (verified in the existing test at line 124).

- [ ] **Step 2: Run the test — it MUST fail**

Run from the worktree root:

```bash
pnpm --filter @pretable/react test -- --run pretable-surface
```

Expected: the new test fails with an assertion error on one of:

- `expect(headerRow).toHaveStyle({ display: "flex" })` — current code has no `display`
- or `expect(button).toHaveStyle({ top: "0px" })` — current code has no `top`
- or `expect(headerRow).toHaveStyle({ height: "72px" })` — current code uses `minHeight`, not `height`

If the test does NOT fail, stop — that means either the styles changed unexpectedly, or the selectors are wrong. Investigate before continuing.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/react/src/internal/__tests__/pretable-surface.test.tsx
git commit -m "test(react): add regression test for grid cell top anchoring"
```

Commit message rationale: the failing test documents the bug before the fix, giving git-blame a clear trail.

---

### Task 2: Fix `getHeaderRowStyle` — add `display: flex` and `height`

**Files:**

- Modify: `packages/react/src/internal/styles.ts:20-32`

- [ ] **Step 1: Replace the body of `getHeaderRowStyle`**

Replace lines 20-32 with:

```typescript
export function getHeaderRowStyle(totalWidth: number): CSSProperties {
  return {
    backdropFilter: "blur(8px)",
    background: "rgba(18, 18, 18, 0.94)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    display: "flex",
    height: HEADER_HEIGHT,
    insetInline: 0,
    minWidth: totalWidth,
    position: "sticky",
    top: 0,
    zIndex: 3,
  };
}
```

Changes:

- Added `display: "flex"` — gives in-flow sticky pinned children a horizontal layout context so they sit side-by-side instead of stacking vertically. Absolute children are out of flex flow, so their positioning via `left`/`top` is unaffected.
- Swapped `minHeight` for `height` — prevents the row from growing when any child unexpectedly participates in flow. `HEADER_HEIGHT` is already imported from `./rendering`.
- Other properties unchanged.

---

### Task 3: Fix `getRowStyle` — add `display: flex`

**Files:**

- Modify: `packages/react/src/internal/styles.ts:45-54`

- [ ] **Step 1: Replace the body of `getRowStyle`**

Replace lines 45-54 with:

```typescript
export function getRowStyle(top: number, height: number): CSSProperties {
  return {
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
    boxSizing: "border-box",
    display: "flex",
    height,
    insetInline: 0,
    position: "absolute",
    top,
  };
}
```

Change: added `display: "flex"`. `height` is already explicit here, so no other changes. Same reasoning as Task 2 — in-flow sticky pinned body cells need a horizontal layout context to avoid stacking.

---

### Task 4: Fix `getCellStyle` and `getHeaderCellStyle` — add `top: 0`

**Files:**

- Modify: `packages/react/src/internal/styles.ts:56-76`

- [ ] **Step 1: Replace both cell style functions**

Replace lines 56-76 with:

```typescript
export function getCellStyle(left: number, width: number): CSSProperties {
  return {
    boxSizing: "border-box",
    height: "100%",
    left,
    padding: "10px 12px",
    position: "absolute",
    top: 0,
    width,
  };
}

export function getHeaderCellStyle(left: number, width: number): CSSProperties {
  return {
    boxSizing: "border-box",
    height: "100%",
    left,
    padding: "12px",
    position: "absolute",
    top: 0,
    width,
  };
}
```

Change: added `top: 0` to both. Without this, absolute cells inherit their static position from the cursor after in-flow sticky siblings.

---

### Task 5: Fix `getPinnedCellStyle` — add `top: 0` (belt-and-suspenders)

**Files:**

- Modify: `packages/react/src/internal/styles.ts:78-85`

- [ ] **Step 1: Replace the pinned cell style function**

Replace lines 78-85 with:

```typescript
export function getPinnedCellStyle(left: number): CSSProperties {
  return {
    background: "rgba(18, 18, 18, 0.96)",
    left,
    position: "sticky",
    top: 0,
    zIndex: 1,
  };
}
```

Change: added `top: 0`. In a `display: flex` parent, sticky children use their natural flex position — but being explicit about `top: 0` prevents future regressions if the parent changes back to block flow. The pinned style is spread AFTER `getCellStyle`/`getHeaderCellStyle` (see [pretable-surface.tsx:347-354](../../packages/react/src/internal/pretable-surface.tsx) and [pretable-surface.tsx:483-490](../../packages/react/src/internal/pretable-surface.tsx)), so `top: 0` is preserved across the spread.

---

### Task 6: Run the regression test — it MUST now pass

- [ ] **Step 1: Run the regression test**

```bash
pnpm --filter @pretable/react test -- --run pretable-surface
```

Expected: all tests in `pretable-surface.test.tsx` pass, including the new regression test from Task 1. If anything other than the regression test starts failing, the change in Tasks 2-5 is not minimal enough — revisit before continuing.

- [ ] **Step 2: Run the full `@pretable/react` test suite**

```bash
pnpm --filter @pretable/react test -- --run
```

Expected: all tests pass. The sibling tests `labeled-grid-surface.test.tsx` and `inspection-grid.test.tsx` should be unaffected (they only assert class names and pinned presence, not `top`/`display`).

If any existing test fails, inspect — most likely it's a test asserting an absent `display` property that's now `flex`. Evaluate whether to update the test's assertion or relax our change.

- [ ] **Step 3: Commit the style fix**

```bash
git add packages/react/src/internal/styles.ts
git commit -m "fix(react): anchor grid cells to top and give rows flex layout context"
```

Commit message rationale: the "why" goes in the commit body (if added) — the subject states the concrete behavior change.

---

### Task 7: Run cross-package test + typecheck + lint

Protect against typos, import drift, and style leakage into other packages.

- [ ] **Step 1: Run the full repo test suite**

```bash
pnpm test
```

Expected: all tests pass across all packages and apps. This covers `scripts/__tests__/*.test.mjs`, every `packages/*/src/**/__tests__`, and `apps/*/src/**/__tests__` (notably `apps/playground/src/__tests__/inspection-demo.test.tsx` and `apps/bench/...`).

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: no type errors. The change doesn't alter any public type; `CSSProperties` from React accepts every key used.

- [ ] **Step 3: Run lint**

```bash
pnpm lint
```

Expected: no lint errors.

- [ ] **Step 4: Run prettier check**

```bash
pnpm format
```

Expected: no formatting errors. If it fails, run `pnpm format:write` to fix and re-stage.

- [ ] **Step 5: Commit anything that came out of formatting or lint auto-fixes**

If nothing changed, skip this step.

```bash
git status
# If anything changed:
git add -A
git commit -m "style: apply prettier formatting"
```

---

### Task 8: Browser verification

This is the step that matters for the user: confirm the backdrop is no longer covering the body, and both header + rows lay out horizontally as expected.

Prereq: the user's local bench dev server is running at `http://localhost:5173/`. The packages the bench consumes via `workspace:*` → `@pretable/react` will need to be rebuilt for the new styles to flow through. The bench app runs a `predev` step (`pnpm run prepare:deps`) that builds the React package, but that only runs on startup. For HMR-driven dev, Vite picks up source changes automatically since `@pretable/react` is resolved from source (not dist) in the dev pipeline. If you've stopped/restarted the bench dev server, the new build will be there.

- [ ] **Step 1: If the user's dev server is running, ask them to hard-reload `http://localhost:5173/` (Cmd+Shift+R on macOS) to flush any cached bundle**

- [ ] **Step 2: Navigate and screenshot via the Chrome extension MCP**

```
mcp__Claude_in_Chrome__navigate → http://localhost:5173/
mcp__Claude_in_Chrome__computer action=screenshot
```

Expected visual: the Signal View's grid now shows a single-row header bar (Timestamp | Severity | Source | Owner | Tags | Message) with all labels aligned on the same Y-axis. The body rows render horizontally with columns laid out left-to-right, not stacked as "TIMESTAMP / SEVERITY / ..." cards.

- [ ] **Step 3: Verify via JS probe the header row height matches `HEADER_HEIGHT` (72) and all header cells share top === 0 in computed styles**

```
mcp__Claude_in_Chrome__javascript_tool →
  (() => {
    const btns = Array.from(document.querySelectorAll('button.inspection-header-cell'));
    const row = btns[0].parentElement;
    const rowRect = row.getBoundingClientRect();
    const cellRects = btns.map(b => b.getBoundingClientRect());
    const sameTop = cellRects.every(r => Math.round(r.top) === Math.round(cellRects[0].top));
    return JSON.stringify({
      headerRowHeight: Math.round(rowRect.height),
      headerCellCount: btns.length,
      allCellsSameTop: sameTop,
      cellTops: cellRects.map(r => Math.round(r.top)),
    }, null, 2);
  })()
```

Expected: `headerRowHeight: 72`, `allCellsSameTop: true`, and `cellTops` is 6 identical values.

- [ ] **Step 4: Confirm a body row's cells share the same top**

```
mcp__Claude_in_Chrome__javascript_tool →
  (() => {
    const firstRow = document.querySelector('[data-testid="pretable-row"], [data-pretable-row]');
    const cells = firstRow.querySelectorAll('[data-pretable-cell]');
    const tops = Array.from(cells).map(c => Math.round(c.getBoundingClientRect().top));
    return JSON.stringify({
      cellCount: cells.length,
      cellTops: tops,
      allSameTop: tops.every(t => t === tops[0]),
    }, null, 2);
  })()
```

Expected: `cellCount: 6`, `allSameTop: true`.

- [ ] **Step 5: If any assertion in step 3 or 4 is off, stop and diagnose**

Common causes:

- Dev server not restarted → stale bundle
- `@pretable/react` dist not rebuilt (bench runs a `predev` that rebuilds — restart pnpm dev if suspicious)
- Unexpected cache layer (Vite's `optimizeDeps`). Fix: `rm -rf node_modules/.vite` under `apps/bench` and restart.

---

### Task 9: Document plan errata

**Files:**

- Modify: `docs/superpowers/plans/2026-04-20-column-virtualization.md`

The column-virtualization plan's code examples (lines 874-894 of that plan) ship the same bug that made it into production. Add a short erratum so future readers don't re-copy the buggy style builders.

- [ ] **Step 1: Append an errata note at the end of the plan file**

Add after the last line of `docs/superpowers/plans/2026-04-20-column-virtualization.md`:

```markdown
---

## Errata (2026-04-21)

The `getCellStyle`, `getHeaderCellStyle`, and `getPinnedCellStyle` examples in Task 4, Step 1 of this plan were missing `top: 0`. The `getHeaderRowStyle` and `getRowStyle` examples were also missing a layout context (`display: "flex"`) for in-flow sticky pinned children. Those omissions shipped to production and caused the inspection grid's header backdrop to cover the body grid (sticky pinned cells stacked vertically in block flow, inflating the header row and shifting the static position of absolute siblings).

Fix plan: [`2026-04-21-inspection-grid-layout-fix.md`](./2026-04-21-inspection-grid-layout-fix.md). The fix preserves `position: sticky` for pinned cells as the design spec requires (see [column-virtualization-design.md:106](../specs/2026-04-20-column-virtualization-design.md)).
```

- [ ] **Step 2: Commit the errata**

```bash
git add docs/superpowers/plans/2026-04-20-column-virtualization.md docs/superpowers/plans/2026-04-21-inspection-grid-layout-fix.md
git commit -m "docs: record column-virtualization plan errata and link fix plan"
```

Note: this assumes the fix plan itself is not yet committed. If it was committed earlier in this session, drop it from the `git add` line.

---

### Task 10: Open PR and wait for green CI

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/pedantic-joliot-7e6d20
```

- [ ] **Step 2: Open a PR against main**

```bash
gh pr create --title "fix(react): anchor grid cells and give rows flex layout" --body "$(cat <<'EOF'
## Summary
- Fixes inspection grid regression where the translucent header backdrop covered the top of the body grid.
- Root cause: in-flow sticky pinned cells stacked vertically in block flow (parent had no `display: flex|grid`) and absolute cells inherited non-zero static positions since `top: 0` was missing.
- Minimal fix: add `display: flex` + explicit `height` to header/body rows, add `top: 0` to all cell style builders. Preserves `position: sticky` for pinned cells per the column-virtualization spec.

## Test plan
- [x] New regression test in `pretable-surface.test.tsx` asserts header row height, cell `top: 0`, and `position: sticky` for pinned cells
- [x] `pnpm test` passes across all packages
- [x] `pnpm typecheck` passes
- [x] `pnpm lint` passes
- [x] Browser verification via Chrome extension at `http://localhost:5173/` confirmed: header row is 72 px tall, all 6 header cells and all 6 body cells per row share the same `top`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Monitor CI**

```bash
gh pr view --json number,statusCheckRollup
```

If checks are pending, poll every 30-60 s until all complete. If anything fails, read the failure and fix — do NOT force-push destructively; create a new commit on top.

- [ ] **Step 4: Merge once green**

Only after every check is `SUCCESS`:

```bash
gh pr merge --squash --delete-branch
```

Rationale for squash: the fix is conceptually a single change (errata + fix + test), and the repo history shows prior PRs used squash-style single-commit merges (see `8f3063d`, `45f94ec`).

If the user has a merge-style preference different from squash, defer to their preference.

---

## Self-Review Checklist

- [x] **Spec coverage**: every claim in the root-cause summary maps to a concrete task. The user-visible symptom (backdrop over body) is addressed by Tasks 2 + 4. The body-row card-stacking is addressed by Tasks 3 + 4. The regression protection is Task 1 + 6. The plan-errata item is Task 9. Browser verification is Task 8.
- [x] **Placeholder scan**: no TBDs, no "implement later", no "similar to Task N". Every code block shows the full new function body, not a diff fragment.
- [x] **Type consistency**: every style builder keeps its existing signature (`number` → `CSSProperties`). The test uses the same `columns` / `rows` fixtures already in the file.
- [x] **No silent behavior change**: pinned cells keep `position: sticky`; header still sticky-pins to top of viewport; body rows still absolutely positioned at their `top`. The only behavior changes are (a) row containers now layout horizontally via flex, and (b) absolute cells anchor to top.
- [x] **Test order**: TDD — Task 1 writes the failing test, commits it; Tasks 2-5 implement; Task 6 re-runs and confirms green.
