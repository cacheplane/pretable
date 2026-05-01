# `@pretable/react` Engine Bridge Implementation Plan (PR 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `@pretable/react` to the new theming package's CSS-variable contract: add a `useResolvedHeights` hook that reads `--pretable-row-height` and `--pretable-header-height` from `<html>` (with `MutationObserver` reactivity), strip skin from `internal/styles.ts`, expose data attributes that `grid.css` targets, and ensure prettier compliance to avoid the recurring CI format failure.

**Architecture:** Engine remains structurally pure — inline styles handle layout/positioning math only (position, top, left, width, height, sticky, overflow, contain). All colors, border-radius, padding values, fonts, and shadows are removed from inline styles and become consumer/theme-package CSS responsibility. The engine adds two CSS variable names (`--pretable-row-height`, `--pretable-header-height`) and a few data attributes (`[data-pretable-header-row]`, `[data-pretable-header-cell]`, `[data-pinned]` on the core surface) to its public contract. No app's behavior changes — apps that override via specificity-beating CSS continue to work; apps that don't override get an unstyled grid (visible/functional but no skin).

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4 + jsdom 29, `useSyncExternalStore`, `MutationObserver`. No new dependencies.

**Spec:** [docs/superpowers/specs/2026-05-01-pretable-theming-architecture-design.md](../specs/2026-05-01-pretable-theming-architecture-design.md) — see PR decomposition table, PR 3, and "Engine integration" section.

**Starting state:** Clean working tree on branch `feat/theming-pr3-engine-bridge` based on `origin/main` at `50120f6` (PR 1, PR 2 of the theming plan already merged via #46/#50). Worktree at `/Users/blove/repos/pretable/.worktrees/theming-pr3-engine-bridge`. Baseline: `pnpm --filter @pretable/react test` passes 40/40.

---

## Scoping decision (read this before starting)

The spec's "Engine integration" section says the engine reads BOTH `--pretable-row-height` and `--pretable-header-height` from CSS. In practice:

- **`--pretable-header-height`** maps cleanly: the engine has a `HEADER_HEIGHT = 52` constant in `packages/react/src/internal/rendering.ts`, used to compute `bodyViewportHeight` and to size the sticky header row. Replacing this constant with a hook-resolved value works directly.

- **`--pretable-row-height`** does NOT map cleanly: the engine doesn't have a single rowHeight knob. Rows are sized per-row by `measureRenderedRowHeight()` (DOM measurement) plus `estimateRowHeight()` (a content-aware estimator using `ROW_CHROME_HEIGHT = 42` plus text layout). Forcing all rows to one CSS-driven height would lose content-aware sizing for wrapped cells.

**This plan's scope:**

- The hook reads BOTH values (spec-aligned API surface, useful for the v0.0.1 contract test and for future consumers who need a snapshot).
- The engine USES `headerHeight` (replaces `HEADER_HEIGHT` constant).
- The engine does NOT use `rowHeight` from the hook in v0.0.1. Row sizing stays measurement-driven. The `--pretable-row-height` CSS token affects visual cell appearance via padding/font-size in `grid.css`, and DOM measurement adapts naturally.
- A future PR (post-0.0.1) can add an opt-in "fixed row height" mode that uses the hook's `rowHeight` value to override measurement for grids that don't need content-aware sizing.

This decision is documented inline in the hook's JSDoc and in this PR's commit message.

---

## File structure

**Files CREATED:**

- `packages/react/src/internal/density.ts` — `useResolvedHeights` hook, `getDensityHeights` snapshot, `parsePx` helper
- `packages/react/src/internal/__tests__/density.test.ts` — hook + snapshot unit tests

**Files MODIFIED:**

- `packages/react/src/internal/styles.ts` — strip all skin (colors, border-radius, padding amounts, fonts, backdrop-filter); keep structural-only
- `packages/react/src/internal/pretable-surface.tsx`:
  - Use `useResolvedHeights` to derive `headerHeight`
  - Replace `HEADER_HEIGHT` import with the hook's resolved value where used (`bodyViewportHeight`, header row inline `height`)
  - Add data attributes: `data-pretable-header-row` on the sticky header div; `data-pretable-header-cell` on each header `<button>`; `data-pinned="left"` on header and body cells when the column is pinned
  - Remove the inline `borderRight: "1px solid rgba(255, 255, 255, 0.06)"` from header cells (skin moves to grid.css)
- `packages/react/src/internal/rendering.ts` — keep `HEADER_HEIGHT` and `DEFAULT_ROW_HEIGHT` constants exported (other code may still use them as fallbacks); no edits required here
- `packages/react/src/internal/__tests__/pretable-surface.test.tsx` — extend with assertions for the new data attributes

**Files NOT TOUCHED:**

- `packages/react/src/internal/inspection-grid.tsx` — already exposes `data-pinned`; unchanged
- `packages/react/src/internal/labeled-grid-surface.tsx` — already exposes `data-pinned`; unchanged
- `packages/react/src/internal/rendering.ts` — no changes; constants remain available
- `apps/website` and `apps/bench` — left untouched. Their CSS continues to override the engine's now-stripped inline styles via specificity. PR 4 / PR 5 wire the new theming package.

---

## Decisions baked in

- **`useResolvedHeights` is React-aware** (uses `useSyncExternalStore`) and lives in `@pretable/react`. The corresponding non-React snapshot (`getDensityHeights`) already exists in `@pretable/ui` and is the consumer-facing static surface. The engine package's `density.ts` is internal — not exported from `@pretable/react`'s public barrel — and doesn't depend on `@pretable/ui`. The CSS variable names are part of `@pretable/react`'s public engine contract (per spec D7).
- **Skin strip is total in `styles.ts`** — no colors, no `border-radius`, no `backdrop-filter`, no fonts, no padding amounts. Only positioning math survives.
- **Row sizing stays measurement-driven** in v0.0.1 (per scoping decision above).
- **Apps continue to work post-strip** because their CSS overrides set the same properties at higher specificity. No visual regression expected for `apps/website` or `apps/bench`. PR 4 / PR 5 swap out their CSS to consume the new theming package.
- **Prettier discipline:** every commit step ends with `pnpm format` (or a verifiable `pnpm exec prettier --check` on the touched files) BEFORE staging. This avoids the recurring post-merge format failure (PR 1 → #47 fixup, PR 2 → #52 fixup).

---

## Task 1: Write `useResolvedHeights` hook + tests

**Files:**

- Create: `packages/react/src/internal/density.ts`
- Create: `packages/react/src/internal/__tests__/density.test.ts`

The hook reads `--pretable-row-height` and `--pretable-header-height` from `document.documentElement`'s computed style, with `MutationObserver` subscription for reactivity. SSR-safe via `getServerSnapshot`.

- [ ] **Step 1: Write the failing test at `packages/react/src/internal/__tests__/density.test.ts`.**

```ts
import { afterEach, describe, expect, test } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { getDensityHeights, useResolvedHeights } from "../density";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
});

describe("getDensityHeights snapshot", () => {
  test("returns fallback values when no CSS variables are set", () => {
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(32);
    expect(heights.headerHeight).toBe(36);
  });

  test("reads numeric pixel values from the documented CSS variables", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "48px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "52px",
    );
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(48);
    expect(heights.headerHeight).toBe(52);
  });

  test("falls back when only one variable is set", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "22px");
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(22);
    expect(heights.headerHeight).toBe(36);
  });

  test("falls back when value is not parseable as <number>px", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "auto");
    expect(getDensityHeights().rowHeight).toBe(32);
  });
});

describe("useResolvedHeights hook", () => {
  test("returns prop values when both props are passed (props win)", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "10px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "20px",
    );
    const { result } = renderHook(() => useResolvedHeights(48, 56));
    expect(result.current.rowHeight).toBe(48);
    expect(result.current.headerHeight).toBe(56);
  });

  test("returns CSS values when no props are passed", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "22px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "26px",
    );
    const { result } = renderHook(() => useResolvedHeights());
    expect(result.current.rowHeight).toBe(22);
    expect(result.current.headerHeight).toBe(26);
  });

  test("returns fallbacks when neither props nor CSS variables are set", () => {
    const { result } = renderHook(() => useResolvedHeights());
    expect(result.current.rowHeight).toBe(32);
    expect(result.current.headerHeight).toBe(36);
  });

  test("re-renders when [data-density] attribute changes on <html>", async () => {
    document.documentElement.style.setProperty("--pretable-row-height", "32px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "36px",
    );
    const { result } = renderHook(() => useResolvedHeights());
    expect(result.current.rowHeight).toBe(32);

    await act(async () => {
      document.documentElement.style.setProperty(
        "--pretable-row-height",
        "56px",
      );
      document.documentElement.setAttribute("data-density", "spacious");
      // MutationObserver fires asynchronously; flush microtasks
      await Promise.resolve();
    });

    expect(result.current.rowHeight).toBe(56);
  });

  test("partial prop override (only rowHeight passed)", () => {
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "44px",
    );
    const { result } = renderHook(() => useResolvedHeights(99));
    expect(result.current.rowHeight).toBe(99);
    expect(result.current.headerHeight).toBe(44);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**

```bash
pnpm --filter @pretable/react test density.test.ts
```

Expected: vitest reports `FAIL` for all 9 tests with module resolution error like `Cannot find module '../density'`.

- [ ] **Step 3: Write `packages/react/src/internal/density.ts`.**

```ts
import { useSyncExternalStore } from "react";

const FALLBACK_ROW_HEIGHT = 32;
const FALLBACK_HEADER_HEIGHT = 36;

export interface DensityHeights {
  rowHeight: number;
  headerHeight: number;
}

function parsePx(value: string): number | null {
  const match = value.trim().match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * Synchronous snapshot of the resolved density-related CSS variables on
 * `document.documentElement`.
 *
 * Returns `{ rowHeight, headerHeight }` parsed from `--pretable-row-height`
 * and `--pretable-header-height`. Falls back to 32 / 36 when a variable is
 * unset or unparseable.
 *
 * SSR-safe: returns the fallback values when `document` is undefined.
 */
export function getDensityHeights(): DensityHeights {
  if (typeof document === "undefined") {
    return {
      rowHeight: FALLBACK_ROW_HEIGHT,
      headerHeight: FALLBACK_HEADER_HEIGHT,
    };
  }
  const styles = getComputedStyle(document.documentElement);
  return {
    rowHeight:
      parsePx(styles.getPropertyValue("--pretable-row-height")) ??
      FALLBACK_ROW_HEIGHT,
    headerHeight:
      parsePx(styles.getPropertyValue("--pretable-header-height")) ??
      FALLBACK_HEADER_HEIGHT,
  };
}

function subscribe(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-density", "data-theme", "class", "style"],
  });
  return () => observer.disconnect();
}

/**
 * React hook — reactive density values that update when `[data-density]`,
 * `[data-theme]`, `class`, or inline `style` change on `<html>`.
 *
 * Numeric props win when passed; otherwise CSS variables; otherwise fallbacks.
 *
 * Currently the engine only uses `headerHeight` (replaces the legacy
 * HEADER_HEIGHT constant). The `rowHeight` value is exposed for API parity
 * with the spec's documented contract and for future use; row sizing in v0.0.1
 * remains measurement-driven via `measureRenderedRowHeight()` /
 * `estimateRowHeight()`.
 *
 * SSR-safe: server snapshot returns fallback values without DOM access.
 */
export function useResolvedHeights(
  rowHeightProp?: number,
  headerHeightProp?: number,
): DensityHeights {
  return useSyncExternalStore(
    subscribe,
    () => {
      const css = getDensityHeights();
      return {
        rowHeight: rowHeightProp ?? css.rowHeight,
        headerHeight: headerHeightProp ?? css.headerHeight,
      };
    },
    () => ({
      rowHeight: rowHeightProp ?? FALLBACK_ROW_HEIGHT,
      headerHeight: headerHeightProp ?? FALLBACK_HEADER_HEIGHT,
    }),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass.**

```bash
pnpm --filter @pretable/react test density.test.ts
```

Expected: vitest reports `9 passed`. All four `getDensityHeights` tests + all five `useResolvedHeights` tests pass.

If the MutationObserver re-render test (`re-renders when [data-density] attribute changes`) fails: jsdom's MutationObserver is asynchronous; the `await Promise.resolve()` flushes microtasks. If still failing, the implementation may need `attributeFilter` adjustments — but the test as written matches the implementation exactly, so it should pass.

- [ ] **Step 5: Run prettier on the new files.**

```bash
pnpm exec prettier --write packages/react/src/internal/density.ts packages/react/src/internal/__tests__/density.test.ts
```

Expected: prettier reports the two files were reformatted (or that they were already compliant).

- [ ] **Step 6: Run the full @pretable/react typecheck to confirm nothing else broke.**

```bash
pnpm --filter @pretable/react typecheck
```

Expected: exit 0.

- [ ] **Step 7: Commit.**

```bash
git add packages/react/src/internal/density.ts packages/react/src/internal/__tests__/density.test.ts
git status --short
git commit -m "$(cat <<'EOF'
feat(react): add useResolvedHeights hook and getDensityHeights snapshot

Internal hook in packages/react/src/internal/density.ts that reads
--pretable-row-height and --pretable-header-height from <html>'s
computed style via useSyncExternalStore + MutationObserver, with
prop overrides winning and fallback values (32 / 36) when neither
props nor CSS variables resolve. SSR-safe via getServerSnapshot
returning fallbacks.

The engine consumes this hook in subsequent commits to derive
headerHeight (replacing the HEADER_HEIGHT constant in
internal/rendering.ts). Row sizing in v0.0.1 stays measurement-
driven; the hook's rowHeight value is exposed for spec API parity
and future opt-in fixed-row-height mode.

Documents two CSS variable names as part of @pretable/react's
public engine contract:
- --pretable-row-height (read; engine uses headerHeight only in v0.0.1)
- --pretable-header-height (read; replaces HEADER_HEIGHT constant)

Tests cover: snapshot fallbacks, snapshot CSS-var reads, hook prop
override, hook CSS-var read, hook fallbacks, hook reactivity to
attribute changes, partial prop override.

Part 1 of @pretable/react engine bridge (PR 3 of theming plan).

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Strip skin from `internal/styles.ts`

**Files:**

- Modify: `packages/react/src/internal/styles.ts`

Remove all colors, border-radius, padding amounts, fonts, and backdrop-filter from inline styles. Keep only positioning math. The current file (91 lines) becomes leaner; after this commit the engine's inline styles handle layout exclusively.

The `HEADER_HEIGHT` import remains for now — Task 3 wires `useResolvedHeights` into the surface and removes that direct usage.

- [ ] **Step 1: Read the current file to confirm starting state.**

```bash
cat packages/react/src/internal/styles.ts
```

Confirm it has the seven exported functions: `getViewportStyle`, `getHeaderRowStyle`, `getScrollContentStyle`, `getRowStyle`, `getCellStyle`, `getHeaderCellStyle`, `getPinnedCellStyle`. Confirm `getViewportStyle` has `border` + `borderRadius`; `getHeaderRowStyle` has `backdropFilter` + `background` + `borderBottom`; `getRowStyle` has `borderBottom`; `getCellStyle` has `padding: "10px 12px"`; `getHeaderCellStyle` has `padding: "12px"`; `getPinnedCellStyle` has `background`.

- [ ] **Step 2: Write the new `packages/react/src/internal/styles.ts`.**

Use the Write tool with this exact content:

```ts
import type { CSSProperties } from "react";

import { HEADER_HEIGHT } from "./rendering";

/**
 * Inline styles for @pretable/react's grid surface.
 *
 * Layout/positioning math only — no colors, no border-radius, no fonts,
 * no padding amounts, no backdrop-filter. Skin lives in CSS targeting
 * the engine's data attributes (`[data-pretable-*]`); see @pretable/ui's
 * grid.css for the public theming surface.
 */

export function getViewportStyle(height: number): CSSProperties {
  return {
    contain: "content",
    containIntrinsicSize: `auto ${height}px`,
    contentVisibility: "auto",
    height,
    overflow: "auto",
    overflowAnchor: "none",
    overscrollBehavior: "contain",
    position: "relative",
  };
}

export function getHeaderRowStyle(
  totalWidth: number,
  headerHeight: number = HEADER_HEIGHT,
): CSSProperties {
  return {
    display: "flex",
    height: headerHeight,
    insetInline: 0,
    minWidth: totalWidth,
    position: "sticky",
    top: 0,
    zIndex: 3,
  };
}

export function getScrollContentStyle(
  totalHeight: number,
  totalWidth: number,
): CSSProperties {
  return {
    height: Math.max(totalHeight, 0),
    minWidth: totalWidth,
    position: "relative",
  };
}

export function getRowStyle(top: number, height: number): CSSProperties {
  return {
    boxSizing: "border-box",
    display: "flex",
    height,
    insetInline: 0,
    position: "absolute",
    top,
  };
}

export function getCellStyle(left: number, width: number): CSSProperties {
  return {
    boxSizing: "border-box",
    height: "100%",
    left,
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
    position: "absolute",
    top: 0,
    width,
  };
}

export function getPinnedCellStyle(left: number): CSSProperties {
  return {
    left,
    position: "sticky",
    top: 0,
    zIndex: 1,
  };
}
```

Note: `getHeaderRowStyle` now takes an optional second param `headerHeight` defaulting to `HEADER_HEIGHT`. Task 3 passes the hook-resolved value at the call site.

- [ ] **Step 3: Verify @pretable/react still builds + typechecks.**

```bash
pnpm --filter @pretable/react typecheck 2>&1 | tail -5
```

Expected: exit 0. The function signatures are backward-compatible (the new `headerHeight` parameter is optional).

```bash
pnpm --filter @pretable/react build 2>&1 | tail -5
```

Expected: tsup builds clean.

- [ ] **Step 4: Run @pretable/react tests.**

```bash
pnpm --filter @pretable/react test
```

Expected: 49 tests pass (40 baseline + 9 new from density.test.ts in Task 1). No failures from the strip — the existing tests don't assert visual styling, they test structural behavior.

If a test fails referencing a removed style property: investigate. The strip should not have broken any structural test.

- [ ] **Step 5: Run prettier on the modified file.**

```bash
pnpm exec prettier --write packages/react/src/internal/styles.ts
```

- [ ] **Step 6: Commit.**

```bash
git add packages/react/src/internal/styles.ts
git commit -m "$(cat <<'EOF'
refactor(react): strip skin from internal/styles.ts

Remove all colors (rgba viewport border, rgba header background,
rgba row border-bottom, rgba pinned cell background), border-radius
(16px viewport), backdrop-filter (blur header), and padding amounts
(10px 12px cells, 12px header cells) from inline styles.

Inline styles now handle layout/positioning math exclusively:
position, top, left, width, height, sticky, absolute, overflow,
contain, box-sizing, z-index, insetInline. Skin moves to CSS
targeting [data-pretable-*] data attributes — @pretable/ui's
grid.css is the public theming surface.

getHeaderRowStyle now takes an optional headerHeight parameter
defaulting to HEADER_HEIGHT (52). The next commit wires
useResolvedHeights into the surface to pass the CSS-driven value.

Apps that override these properties via specificity-beating CSS
(apps/website's globals.css #grid block, apps/bench's app.css)
continue to work unchanged. PR 4 / PR 5 swap their CSS to consume
the new theming package.

Part 2 of @pretable/react engine bridge (PR 3 of theming plan).

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire `useResolvedHeights` into `pretable-surface.tsx`

**Files:**

- Modify: `packages/react/src/internal/pretable-surface.tsx`

Replace direct `HEADER_HEIGHT` usage with `useResolvedHeights().headerHeight`. Pass the resolved value to `getHeaderRowStyle`. The `bodyViewportHeight` calculation now uses the dynamic value too.

- [ ] **Step 1: Add the import.**

In `packages/react/src/internal/pretable-surface.tsx`, find the existing block of imports from `./rendering` and `./styles` (around line 19-37). Use the Edit tool:

- old_string:
  ```
  import { measureRenderedRowHeight } from "../row-height";
  import { type PretableTelemetry, usePretableModel } from "../use-pretable";
  import {
    DEFAULT_ROW_HEIGHT,
    HEADER_HEIGHT,
    formatCellValue,
    getNextSortDirection,
    getPinnedLeftOffsets,
    resolveCellValue,
  } from "./rendering";
  import {
    getCellStyle,
    getHeaderCellStyle,
    getHeaderRowStyle,
    getPinnedCellStyle,
    getRowStyle,
    getScrollContentStyle,
    getViewportStyle,
  } from "./styles";
  ```
- new_string:
  ```
  import { measureRenderedRowHeight } from "../row-height";
  import { type PretableTelemetry, usePretableModel } from "../use-pretable";
  import { useResolvedHeights } from "./density";
  import {
    DEFAULT_ROW_HEIGHT,
    formatCellValue,
    getNextSortDirection,
    getPinnedLeftOffsets,
    resolveCellValue,
  } from "./rendering";
  import {
    getCellStyle,
    getHeaderCellStyle,
    getHeaderRowStyle,
    getPinnedCellStyle,
    getRowStyle,
    getScrollContentStyle,
    getViewportStyle,
  } from "./styles";
  ```

(Removes `HEADER_HEIGHT` from the rendering import list; adds the density hook import.)

- [ ] **Step 2: Use the hook inside the component.**

Find the line near the top of the component body that destructures props and computes `bodyViewportHeight`:

- old_string:
  ```
    const [measuredHeights, setMeasuredHeights] = useState<
      Record<string, number>
    >({});
    const [viewportWidth, setViewportWidth] = useState(0);
    const measuredHeightsRef = useRef<Record<string, number>>({});
    const measuredRowKeysRef = useRef<Record<string, string>>({});
    const rowNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const viewportRef = useRef<HTMLDivElement>(null);
    const bodyViewportHeight = Math.max(viewportHeight - HEADER_HEIGHT, 0);
  ```
- new_string:

  ```
    const [measuredHeights, setMeasuredHeights] = useState<
      Record<string, number>
    >({});
    const [viewportWidth, setViewportWidth] = useState(0);
    const measuredHeightsRef = useRef<Record<string, number>>({});
    const measuredRowKeysRef = useRef<Record<string, string>>({});
    const rowNodesRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const viewportRef = useRef<HTMLDivElement>(null);
    const { headerHeight } = useResolvedHeights();
    const bodyViewportHeight = Math.max(viewportHeight - headerHeight, 0);
  ```

- [ ] **Step 3: Pass the resolved height to `getHeaderRowStyle`.**

Find the JSX where the header row div is rendered (around line 340). The current call is `getHeaderRowStyle(renderSnapshot.totalWidth)`.

- old_string:
  ```
        <div style={getHeaderRowStyle(renderSnapshot.totalWidth)}>
  ```
- new_string:
  ```
        <div
          data-pretable-header-row=""
          style={getHeaderRowStyle(renderSnapshot.totalWidth, headerHeight)}
        >
  ```

(This also adds the `data-pretable-header-row` attribute that `grid.css` targets — Task 4 documents this, but it lands here because the JSX is being modified.)

- [ ] **Step 4: Verify @pretable/react typechecks.**

```bash
pnpm --filter @pretable/react typecheck 2>&1 | tail -5
```

Expected: exit 0.

- [ ] **Step 5: Run @pretable/react tests.**

```bash
pnpm --filter @pretable/react test 2>&1 | tail -5
```

Expected: 49 tests pass (40 baseline + 9 from density.test.ts).

If a `pretable-surface.test.tsx` test fails: the failure likely points at the new `useResolvedHeights` hook and jsdom not having a real CSS environment. The hook returns the fallback values (32 / 36) when CSS variables aren't set in the test environment — which differs from the previous hardcoded `HEADER_HEIGHT = 52`. If a test was asserting on layout positions computed from `viewportHeight - 52`, it now uses `viewportHeight - 36` and may fail.

If you hit this: in the affected test file, set `--pretable-header-height: 52px` on `document.documentElement.style` before mounting, OR update the assertion to use the new fallback (36). Choose the approach that preserves the test's intent — usually the former.

- [ ] **Step 6: Run prettier.**

```bash
pnpm exec prettier --write packages/react/src/internal/pretable-surface.tsx
```

- [ ] **Step 7: Commit.**

```bash
git add packages/react/src/internal/pretable-surface.tsx
git commit -m "$(cat <<'EOF'
feat(react): wire useResolvedHeights into pretable-surface

Replace direct HEADER_HEIGHT constant usage with the resolved value
from useResolvedHeights. The hook reads --pretable-header-height
from <html>'s computed style with MutationObserver-backed
reactivity; consumers can now switch density/theme at runtime by
toggling [data-density] / [data-theme] on <html>, and the engine
re-renders with the new sticky-header offset and bodyViewportHeight.

Also adds the data-pretable-header-row attribute on the sticky
header div so @pretable/ui's grid.css can target the header
background, font, and bottom border via that selector. Same
contract as the existing [data-pretable-scroll-viewport] /
[data-pretable-row] / [data-pretable-cell] data attributes.

If no theme is loaded (CSS variables unset), the hook falls back
to 36px header height. apps/website and apps/bench currently
override header dimensions via their own CSS; their behavior is
unchanged because their selectors win specificity.

Part 3 of @pretable/react engine bridge (PR 3 of theming plan).

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add data attributes for grid.css to target

**Files:**

- Modify: `packages/react/src/internal/pretable-surface.tsx`

Adds three more data attributes that `@pretable/ui/grid.css` references:

- `data-pretable-header-cell` on each header `<button>` (companion to `data-pretable-header-row` added in Task 3)
- `data-pinned="left"` on header cells AND body cells when the column is pinned left

Note: `data-selected` and `data-focused` are already exposed (verified at `pretable-surface.tsx:454,459,508,511`). `data-pinned` already exists in `labeled-grid-surface.tsx` but NOT in the core `pretable-surface.tsx` — Task 4 adds it to the core surface.

- [ ] **Step 1: Add `data-pretable-header-cell` to the header `<button>`.**

Find the header button JSX (around line 367-419 — the `<button>` with `aria-label={\`Sort ${label}\`}`). The current attributes block is something like:

```tsx
<button
  {...headerProps}
  aria-label={`Sort ${label}`}
  className={getHeaderCellClassName?.({...})}
  key={column.id}
  onClick={...}
  style={{...}}
  type="button"
>
```

Use the Edit tool to add the `data-pretable-header-cell=""` attribute and `data-pinned` conditional. The exact edit:

- old_string:
  ```
              {...headerProps}
              aria-label={`Sort ${label}`}
              className={getHeaderCellClassName?.({
                column,
                sortDirection,
              })}
              key={column.id}
              onClick={() => {
  ```
- new_string:

  ```
              {...headerProps}
              aria-label={`Sort ${label}`}
              className={getHeaderCellClassName?.({
                column,
                sortDirection,
              })}
              data-pretable-header-cell=""
              data-pinned={plannedCol.pinned === "left" ? "left" : undefined}
              key={column.id}
              onClick={() => {
  ```

- [ ] **Step 2: Add `data-pinned` to body cells.**

Find the body cell JSX (around line 502-515 — the `<div>` with `data-pretable-cell=""`). The current attributes are:

```tsx
<div
  data-focused={...}
  data-pretable-cell=""
  data-pretable-wrap={...}
  data-selected={...}
  ...
>
```

Locate the column for that cell — it's `column` in the surrounding `.map()` callback. Add `data-pinned`:

- old_string:
  ```
                    data-focused={isFocused ? "true" : "false"}
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    data-selected={isSelected ? "true" : "false"}
  ```
- new_string:

  ```
                    data-focused={isFocused ? "true" : "false"}
                    data-pinned={column.pinned === "left" ? "left" : undefined}
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    data-selected={isSelected ? "true" : "false"}
  ```

- [ ] **Step 3: Verify the structural test still passes.**

```bash
pnpm --filter @pretable/react test
```

Expected: 49 tests pass. Existing tests don't assert on `data-pinned` or `data-pretable-header-cell` so they're unaffected.

- [ ] **Step 4: Add a test for the new attributes.**

Find the surface test file `packages/react/src/internal/__tests__/pretable-surface.test.tsx`. Read it briefly (`head -40`) to confirm the existing test pattern. The file already imports rendering helpers; the new test follows the same shape.

Append a new test at the end of the existing `describe(...)` block. Use the Edit tool to add it just before the file's final `});` (the closing of the describe). Locate the last existing test (or the closing brace of the describe) and add:

```ts
  test("exposes data-pretable-header-row, data-pretable-header-cell, and data-pinned for theming", () => {
    const columns = [
      { id: "a", header: "A", pinned: "left" as const, valueGetter: () => "a" },
      { id: "b", header: "B", valueGetter: () => "b" },
    ];
    const rows = [{ id: "r1", value: "x" }];
    const { container } = render(
      <PretableSurface
        ariaLabel="test grid"
        columns={columns}
        rows={rows}
        viewportHeight={400}
      />,
    );

    expect(container.querySelector("[data-pretable-header-row]")).not.toBeNull();
    const headerCells = container.querySelectorAll("[data-pretable-header-cell]");
    expect(headerCells.length).toBe(2);
    expect(headerCells[0]?.getAttribute("data-pinned")).toBe("left");
    expect(headerCells[1]?.getAttribute("data-pinned")).toBeNull();

    const bodyCells = container.querySelectorAll("[data-pretable-cell]");
    expect(bodyCells.length).toBeGreaterThan(0);
    const pinnedBodyCell = container.querySelector(
      '[data-pretable-cell][data-pinned="left"]',
    );
    expect(pinnedBodyCell).not.toBeNull();
  });
```

If the existing test file's column/row shape differs from what I assumed, adapt the column type and row shape to match. The existing tests in this file are the source of truth for prop shapes — read one passing test first and mirror its column/row construction exactly.

- [ ] **Step 5: Run the new test in isolation to verify it passes.**

```bash
pnpm --filter @pretable/react test pretable-surface.test
```

Expected: all tests in `pretable-surface.test.tsx` pass, including the new one.

If the new test fails because the column type doesn't include `pinned`: adapt to whatever column type the test file uses for pinned columns (mirror an existing test).

- [ ] **Step 6: Run all @pretable/react tests.**

```bash
pnpm --filter @pretable/react test
```

Expected: 50 tests pass (40 baseline + 9 density + 1 new attribute test).

- [ ] **Step 7: Run prettier.**

```bash
pnpm exec prettier --write packages/react/src/internal/pretable-surface.tsx packages/react/src/internal/__tests__/pretable-surface.test.tsx
```

- [ ] **Step 8: Commit.**

```bash
git add packages/react/src/internal/pretable-surface.tsx packages/react/src/internal/__tests__/pretable-surface.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): expose data-pretable-header-cell and data-pinned attributes

Two new data attributes on the core PretableSurface for
@pretable/ui's grid.css to target:

- data-pretable-header-cell="" on each header <button>; companion
  to data-pretable-header-row added on the sticky header div in
  the previous commit.
- data-pinned="left" on header AND body cells when the column is
  pinned left. Replaces the old reliance on labeled-grid-surface
  setting this attribute (which is a higher-level wrapper, not
  the core surface).

These complete the data-attribute contract @pretable/ui's grid.css
documents:
- [data-pretable-scroll-viewport]   (already)
- [data-pretable-scroll-content]    (already)
- [data-pretable-row]               (already)
- [data-pretable-cell]              (already)
- [data-pretable-wrap]              (already)
- [data-pretable-header-row]        (added previous commit)
- [data-pretable-header-cell]       (this commit)
- [data-pinned]                     (this commit, on core surface)
- [data-selected]                   (already)
- [data-focused]                   (already)

New unit test verifies all three attributes render on the core
surface for both pinned and non-pinned columns.

Part 4 of @pretable/react engine bridge (PR 3 of theming plan).

Co-Authored-By: Assistant Opus 4 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Final workspace verification

**Files:** none touched.

- [ ] **Step 1: Run @pretable/react tests one more time.**

```bash
pnpm --filter @pretable/react test 2>&1 | tail -5
```

Expected: 50 tests pass.

- [ ] **Step 2: Run apps/website and apps/bench tests in isolation.**

```bash
pnpm --filter @pretable/app-website test 2>&1 | tail -3
pnpm --filter @pretable/app-bench test 2>&1 | tail -3
```

Expected: both pass. The skin-strip in `styles.ts` doesn't break apps because their CSS overrides win specificity — header background, viewport border, and cell colors all come from their `globals.css` / `app.css` rules.

If a website or bench test fails: the issue is most likely a test asserting on a specific computed style. The fix depends on the test, but candidates are: (a) the test was relying on the rgba inline values that are now gone — update assertion; (b) the test isn't actually broken but jsdom is reporting differently — investigate.

- [ ] **Step 3: Run typecheck.**

```bash
pnpm typecheck 2>&1 | tail -5
```

Expected: exit 0 across the workspace.

- [ ] **Step 4: Run build.**

```bash
pnpm build 2>&1 | tail -5
```

Expected: all packages and apps build clean.

- [ ] **Step 5: Run prettier --check across the touched files one final time.**

```bash
pnpm exec prettier --check packages/react/src/internal/density.ts packages/react/src/internal/styles.ts packages/react/src/internal/pretable-surface.tsx packages/react/src/internal/__tests__/density.test.ts packages/react/src/internal/__tests__/pretable-surface.test.tsx
```

Expected: all five files pass prettier.

If any file fails: run `pnpm exec prettier --write <file>` on it, then `git add` and amend the most recent commit OR add a separate "format" commit. Prefer amending if it's the most recent file you touched; otherwise add a separate commit `chore: prettier touched files`.

- [ ] **Step 6: Confirm clean working tree and full commit list.**

```bash
git status
git log --oneline origin/main..HEAD
```

Expected status: clean. Expected log: 5 commits (the plan + 4 implementation).

```
<sha> docs(plans): @pretable/react engine bridge (PR 3 of theming plan)
<sha> feat(react): add useResolvedHeights hook and getDensityHeights snapshot
<sha> refactor(react): strip skin from internal/styles.ts
<sha> feat(react): wire useResolvedHeights into pretable-surface
<sha> feat(react): expose data-pretable-header-cell and data-pinned attributes
```

(No commit for Task 5 — it's verification only.)

---

## Self-review checklist

After completing all tasks, the engineer should be able to answer "yes" to each:

- [ ] `packages/react/src/internal/density.ts` exists, exports `useResolvedHeights`, `getDensityHeights`, and `DensityHeights` interface.
- [ ] `packages/react/src/internal/__tests__/density.test.ts` has 9 tests, all passing.
- [ ] `packages/react/src/internal/styles.ts` contains zero hex/rgba color values, zero `border-radius`, zero `padding` amounts, zero `backdrop-filter`. Only positioning math.
- [ ] `pretable-surface.tsx` uses `useResolvedHeights().headerHeight` (not `HEADER_HEIGHT` directly) for `bodyViewportHeight` and the header style.
- [ ] `pretable-surface.tsx` renders `data-pretable-header-row=""` on the sticky header div, `data-pretable-header-cell=""` on each header button, and `data-pinned="left"` on header AND body cells for left-pinned columns.
- [ ] `pretable-surface.test.tsx` has a new test verifying these three attributes.
- [ ] `pnpm --filter @pretable/react test` passes 50/50.
- [ ] `pnpm --filter @pretable/app-website test` and `pnpm --filter @pretable/app-bench test` both pass (no regression — apps' CSS still overrides the now-stripped engine styles).
- [ ] `pnpm typecheck` and `pnpm build` pass workspace-wide.
- [ ] `pnpm format` (or per-file `prettier --check`) reports no style issues on any of the touched files.
- [ ] The git history shows 4 implementation commits in a coherent narrative.

If any answer is "no", investigate before declaring the PR done.

---

## What this PR does NOT do (deferred)

- **PR 4** — wire `apps/website` embedded grid: replaces the website's existing `#grid` CSS block with `@import "@pretable/ui/themes/material.css"` + `@import "@pretable/ui/grid.css"`. After PR 4, the website's grid will visually use the new theming package's Material theme, and the website's existing CSS overrides come out of `globals.css`.
- **PR 5** — wire `apps/bench` grid: same shape as PR 4 but uses Excel theme.
- **`--pretable-row-height` actually drives row sizing** — deferred. v0.0.1 keeps measurement-driven row layout. A future PR adds an opt-in fixed-row-height mode that uses the hook's `rowHeight` value.
- **Token-contract test in `@pretable/react`** — already exists in `@pretable/ui` (PR 2). The engine's contract is exercised by the apps' visual sanity checks (deferred to PR 4 / PR 5) and by the existing structural tests.
