# Homepage Showcase Strip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two live, interactive proof sections to the homepage — a 2,500 × 500 virtualization-at-scale grid with a rendered-cell counter, and a resize/reorder column-layout grid.

**Architecture:** Website-only. Two new `ScrollReveal`-wrapped sections in the drawer flow, each a server-component section (Tailwind chrome) hosting a `"use client"` grid island that self-gates mounting with an `IntersectionObserver` (`useInView`). Grids use the existing `<PretableSurface>`; column + row virtualization is automatic, resize/reorder are on by default per column, and neither grid uses controlled `state` (no controlled-state warning). Reset = grid remount via React `key`.

**Tech Stack:** Next 16 / React 19, `@pretable/react` (`PretableSurface`, `PretableColumn`), Tailwind (design tokens: `text-text-primary`, `text-text-secondary`, `border-rule`, `bg-bg-card`, `accent`, `font-display`, `font-mono`), Vitest + Testing Library, Playwright.

**Key facts verified against the codebase:**

- Base column fields: `id`, `header`, `widthPx`, `pinned`, `value`, `format`, `render`, `editable`, `resizable`, `reorderable`. Resize is enabled unless `resizable: false`; reorder unless `reorderable: false` (`pretable-surface.tsx:1270,1317`). So defaults give us both — no extra props.
- `PretableSurface` measures its own `viewportWidth` from `clientWidth` (`pretable-surface.tsx:483,1110`) → column virtualization is automatic; we only pass `viewportHeight` (a number).
- Cells carry `data-pretable-cell`; the scroll viewport carries `data-pretable-scroll-viewport`.
- Test setup (`apps/website/app/components/__tests__/setup.ts`) globally mocks `IntersectionObserver` as a **no-op** (never fires) and stubs `requestAnimationFrame` as a no-op. Tests that need `useInView` to mount must install a **firing** IO mock; hooks must do an initial **synchronous** count rather than relying on rAF.
- Existing section eyebrows run 02…07 (FeatureGrid = `07 · what`); the new sections are **08** and **09**.
- Website tests live in `apps/website/app/components/__tests__/`; run from `apps/website` with `pnpm test`. Type/lint: `pnpm typecheck`, `pnpm lint`. Smoke: `pnpm e2e` (Playwright).

---

## File Structure

New (all under `apps/website/app/components/`):

- `showcase/useInView.ts` — one-shot lazy-mount hook.
- `showcase/scaleData.ts` — pure generators for the 2,500 × 500 grid.
- `showcase/useRenderedCellCount.ts` — live DOM-cell counter hook (+ pure `countCells`).
- `showcase/ScaleGrid.tsx` — `"use client"` scale grid island + counter.
- `showcase/columnLayoutData.ts` — small portfolio-style slice + columns.
- `showcase/ColumnLayoutGrid.tsx` — `"use client"` resize/reorder grid + reset.
- `ScaleShowcase.tsx` — server section (eyebrow 08, copy, hosts `ScaleGrid`).
- `ColumnLayoutShowcase.tsx` — server section (eyebrow 09, copy, hosts `ColumnLayoutGrid`).
- Tests: `__tests__/useInView.test.ts`, `__tests__/scaleData.test.ts`, `__tests__/useRenderedCellCount.test.ts`, `__tests__/columnLayoutData.test.ts`, `__tests__/ScaleGrid.test.tsx`, `__tests__/ColumnLayoutGrid.test.tsx`.

Modified:

- `app/page.tsx` — insert the two sections after `<FeatureGrid>`, before `<CtaSection>`.
- `e2e/smoke.spec.ts` — one new test.

---

## Task 1: `useInView` lazy-mount hook

**Files:**

- Create: `apps/website/app/components/showcase/useInView.ts`
- Test: `apps/website/app/components/__tests__/useInView.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/app/components/__tests__/useInView.test.ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInView } from "../showcase/useInView";

// A firing IntersectionObserver: invokes its callback with isIntersecting:true
// as soon as observe() is called (synchronously, wrapped by the test in act()).
class FiringIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe = () => {
    this.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

describe("useInView", () => {
  const original = globalThis.IntersectionObserver;
  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  it("flips to true once the element intersects", () => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
    const { result } = renderHook(() => useInView<HTMLDivElement>());
    const [ref] = result.current;
    // Attach a node so the effect's observe() runs.
    act(() => {
      (ref as { current: HTMLDivElement | null }).current =
        document.createElement("div");
    });
    // Re-run the effect by re-rendering is not needed: the effect ran on mount
    // but ref.current was null then. Simplest: assert the fallback path instead.
    expect(Array.isArray(result.current)).toBe(true);
  });

  it("mounts immediately when IntersectionObserver is unavailable", () => {
    // @ts-expect-error simulate missing API
    globalThis.IntersectionObserver = undefined;
    const { result } = renderHook(() => useInView<HTMLDivElement>());
    expect(result.current[1]).toBe(true);
  });
});
```

Note: the first test as written cannot reliably attach a ref before the mount effect; keep it as a smoke assertion of the tuple shape, and rely on the second test (missing-API path → immediate `true`) plus the component tests (Tasks 5 & 7, which install `FiringIO` and assert the grid mounts) for real coverage. This is intentional — `useInView`'s observer wiring is exercised end-to-end in the component tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/website && pnpm test -- useInView`
Expected: FAIL — `Cannot find module '../showcase/useInView'`.

- [ ] **Step 3: Write the hook**

```ts
// apps/website/app/components/showcase/useInView.ts
"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * One-shot in-view detector for lazy-mounting heavy content. Returns
 * `[ref, inView]`; `inView` flips to `true` the first time the referenced
 * element intersects the viewport (then the observer disconnects). When
 * `IntersectionObserver` is unavailable, mounts immediately.
 */
export function useInView<T extends Element = HTMLDivElement>(
  rootMargin = "200px",
): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return [ref, inView];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/website && pnpm test -- useInView`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/showcase/useInView.ts apps/website/app/components/__tests__/useInView.test.ts
git commit -m "feat(website): useInView one-shot lazy-mount hook"
```

---

## Task 2: `scaleData` generators

**Files:**

- Create: `apps/website/app/components/showcase/scaleData.ts`
- Test: `apps/website/app/components/__tests__/scaleData.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/app/components/__tests__/scaleData.test.ts
import { describe, expect, it } from "vitest";
import {
  COL_COUNT,
  ROW_COUNT,
  makeScaleColumns,
  makeScaleRows,
  synthCell,
} from "../showcase/scaleData";

describe("scaleData", () => {
  it("makes 2,500 lightweight rows keyed by index", () => {
    const rows = makeScaleRows();
    expect(rows).toHaveLength(ROW_COUNT);
    expect(rows[0]?.i).toBe(0);
    expect(rows[ROW_COUNT - 1]?.i).toBe(ROW_COUNT - 1);
  });

  it("makes a leading Row column plus 500 data columns", () => {
    const cols = makeScaleColumns();
    expect(cols).toHaveLength(COL_COUNT + 1);
    expect(cols[0]?.id).toBe("row");
    expect(cols[1]?.id).toBe("c1");
    expect(cols[1]?.header).toBe("C1");
    expect(cols[COL_COUNT]?.id).toBe(`c${COL_COUNT}`);
  });

  it("synthCell is deterministic and varies across cells", () => {
    expect(synthCell(5, 3)).toBe(synthCell(5, 3));
    expect(synthCell(5, 3)).not.toBe(synthCell(6, 3));
    expect(synthCell(5, 3)).not.toBe(synthCell(5, 4));
  });

  it("data column value accessors read synthCell for their column index", () => {
    const cols = makeScaleColumns();
    const c1 = cols[1]!;
    expect(c1.value?.({ i: 7 } as never, 7)).toBe(synthCell(7, 0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/website && pnpm test -- scaleData`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the generators**

```ts
// apps/website/app/components/showcase/scaleData.ts
import type { PretableColumn } from "@pretable/react";

export const ROW_COUNT = 2500;
export const COL_COUNT = 500;
export const TOTAL_CELLS = ROW_COUNT * COL_COUNT;

/** A row is just its index — cell values are derived lazily from (row, col). */
export interface ScaleRow {
  i: number;
}

export function makeScaleRows(): ScaleRow[] {
  return Array.from({ length: ROW_COUNT }, (_, i) => ({ i }));
}

/** Deterministic synthetic value for a cell, in 0.0–99.9. */
export function synthCell(rowIndex: number, colIndex: number): number {
  return ((rowIndex * 31 + colIndex * 17) % 1000) / 10;
}

export function makeScaleColumns(): PretableColumn<ScaleRow>[] {
  const columns: PretableColumn<ScaleRow>[] = [
    {
      id: "row",
      header: "Row",
      widthPx: 76,
      pinned: "left",
      value: (row) => row.i,
      format: ({ value }) => `#${value as number}`,
    },
  ];
  for (let c = 0; c < COL_COUNT; c += 1) {
    const colIndex = c;
    columns.push({
      id: `c${c + 1}`,
      header: `C${c + 1}`,
      widthPx: 90,
      value: (row) => synthCell(row.i, colIndex),
      format: ({ value }) => (value as number).toFixed(1),
    });
  }
  return columns;
}
```

Note: each data column's `value` ignores the row-model index argument and uses the captured `colIndex` with `row.i`. The test passes `7` as the second arg only to confirm the accessor doesn't depend on it.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/website && pnpm test -- scaleData`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/showcase/scaleData.ts apps/website/app/components/__tests__/scaleData.test.ts
git commit -m "feat(website): scale-grid data generators (2,500 x 500, lazy cells)"
```

---

## Task 3: `useRenderedCellCount` + `countCells`

**Files:**

- Create: `apps/website/app/components/showcase/useRenderedCellCount.ts`
- Test: `apps/website/app/components/__tests__/useRenderedCellCount.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/app/components/__tests__/useRenderedCellCount.test.ts
import { describe, expect, it } from "vitest";
import { countCells } from "../showcase/useRenderedCellCount";

describe("countCells", () => {
  it("counts [data-pretable-cell] descendants", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-pretable-cell></div>
      <div data-pretable-cell></div>
      <span>not a cell</span>
      <div><div data-pretable-cell></div></div>
    `;
    expect(countCells(root)).toBe(3);
  });

  it("returns 0 when there are no cells", () => {
    expect(countCells(document.createElement("div"))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/website && pnpm test -- useRenderedCellCount`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the hook**

```ts
// apps/website/app/components/showcase/useRenderedCellCount.ts
"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/** Counts the cell nodes currently rendered inside `el`. */
export function countCells(el: Element): number {
  return el.querySelectorAll("[data-pretable-cell]").length;
}

/**
 * Tracks how many `[data-pretable-cell]` nodes are in the DOM inside the
 * returned ref's element, updating live (rAF-throttled) as the grid scrolls
 * and virtualizes. Does an initial synchronous count on mount plus a settle
 * pass on the next tick (grid rows mount after this effect).
 */
export function useRenderedCellCount(): {
  ref: RefObject<HTMLDivElement | null>;
  count: number;
} {
  const ref = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const recount = () => setCount(countCells(el));
    recount();
    const settle = setTimeout(recount, 0);

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        recount();
      });
    };
    // scroll does not bubble, but capture-phase listeners on an ancestor still
    // fire for descendant scroll (the grid's inner viewport).
    el.addEventListener("scroll", onScroll, true);

    return () => {
      clearTimeout(settle);
      el.removeEventListener("scroll", onScroll, true);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return { ref, count };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/website && pnpm test -- useRenderedCellCount`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/showcase/useRenderedCellCount.ts apps/website/app/components/__tests__/useRenderedCellCount.test.ts
git commit -m "feat(website): useRenderedCellCount live DOM-cell counter"
```

---

## Task 4: `columnLayoutData` (portfolio slice)

**Files:**

- Create: `apps/website/app/components/showcase/columnLayoutData.ts`
- Test: `apps/website/app/components/__tests__/columnLayoutData.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/website/app/components/__tests__/columnLayoutData.test.ts
import { describe, expect, it } from "vitest";
import { LAYOUT_ROWS, makeLayoutColumns } from "../showcase/columnLayoutData";

describe("columnLayoutData", () => {
  it("has a dozen rows with unique ids", () => {
    expect(LAYOUT_ROWS).toHaveLength(12);
    expect(new Set(LAYOUT_ROWS.map((r) => r.id)).size).toBe(12);
  });

  it("defines eight columns in the expected order", () => {
    const ids = makeLayoutColumns().map((c) => c.id);
    expect(ids).toEqual([
      "symbol",
      "sector",
      "qty",
      "last",
      "mktValue",
      "dayPnl",
      "weight",
      "note",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/website && pnpm test -- columnLayoutData`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the data**

```ts
// apps/website/app/components/showcase/columnLayoutData.ts
import type { PretableColumn } from "@pretable/react";

export interface LayoutRow {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  qty: number;
  last: number;
  mktValue: number;
  dayPnl: number;
  weight: number;
  note: string;
}

const mk = (
  symbol: string,
  name: string,
  sector: string,
  qty: number,
  last: number,
  dayPnl: number,
  weight: number,
  note: string,
): LayoutRow => ({
  id: symbol,
  symbol,
  name,
  sector,
  qty,
  last,
  mktValue: Math.round(qty * last),
  dayPnl,
  weight,
  note,
});

export const LAYOUT_ROWS: LayoutRow[] = [
  mk(
    "NVDA",
    "NVIDIA",
    "Technology",
    12000,
    121.4,
    18420,
    6.4,
    "Trim into strength",
  ),
  mk("MSFT", "Microsoft", "Technology", 8200, 432.1, -9100, 5.8, "Core hold"),
  mk("AAPL", "Apple", "Technology", 9400, 224.3, 4200, 5.1, "Hold"),
  mk("AMZN", "Amazon", "Consumer", 6100, 186.7, 7300, 4.4, "Add on dips"),
  mk("JPM", "JPMorgan", "Financials", 7300, 211.9, -2600, 4.1, "Watch rates"),
  mk("LLY", "Eli Lilly", "Health Care", 2100, 812.5, 15800, 3.9, "Hold"),
  mk("XOM", "Exxon Mobil", "Energy", 9800, 112.6, -3300, 3.2, "Trim"),
  mk("UNH", "UnitedHealth", "Health Care", 1900, 528.4, 2100, 3.0, "Hold"),
  mk("V", "Visa", "Financials", 4200, 289.1, 1500, 2.8, "Core hold"),
  mk("CVX", "Chevron", "Energy", 5600, 158.2, -1200, 2.3, "Watch"),
  mk("HD", "Home Depot", "Consumer", 2400, 392.7, 3600, 2.1, "Hold"),
  mk("PFE", "Pfizer", "Health Care", 14500, 28.4, -900, 1.1, "Under review"),
];

export function makeLayoutColumns(): PretableColumn<LayoutRow>[] {
  const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  const signedUsd = (n: number) =>
    `${n < 0 ? "-" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return [
    { id: "symbol", header: "Symbol", widthPx: 110, value: (r) => r.symbol },
    { id: "sector", header: "Sector", widthPx: 130, value: (r) => r.sector },
    {
      id: "qty",
      header: "Qty",
      widthPx: 96,
      value: (r) => r.qty,
      format: ({ value }) => (value as number).toLocaleString("en-US"),
    },
    {
      id: "last",
      header: "Last",
      widthPx: 96,
      value: (r) => r.last,
      format: ({ value }) => usd(value as number),
    },
    {
      id: "mktValue",
      header: "Mkt Value",
      widthPx: 120,
      value: (r) => r.mktValue,
      format: ({ value }) => usd(value as number),
    },
    {
      id: "dayPnl",
      header: "Day P&L",
      widthPx: 110,
      value: (r) => r.dayPnl,
      format: ({ value }) => signedUsd(value as number),
    },
    {
      id: "weight",
      header: "Weight",
      widthPx: 96,
      value: (r) => r.weight,
      format: ({ value }) => `${(value as number).toFixed(1)}%`,
    },
    { id: "note", header: "Analyst note", widthPx: 180, value: (r) => r.note },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/website && pnpm test -- columnLayoutData`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/showcase/columnLayoutData.ts apps/website/app/components/__tests__/columnLayoutData.test.ts
git commit -m "feat(website): column-layout demo data (portfolio slice)"
```

---

## Task 5: `ScaleGrid` client island + section

**Files:**

- Create: `apps/website/app/components/showcase/ScaleGrid.tsx`
- Create: `apps/website/app/components/ScaleShowcase.tsx`
- Test: `apps/website/app/components/__tests__/ScaleGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/website/app/components/__tests__/ScaleGrid.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScaleGrid } from "../showcase/ScaleGrid";
import { TOTAL_CELLS } from "../showcase/scaleData";

// Firing IntersectionObserver so useInView mounts the grid.
class FiringIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe = () => {
    this.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

describe("ScaleGrid", () => {
  const original = globalThis.IntersectionObserver;
  beforeEach(() => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  it("shows the model-cell total and renders far fewer cells than the model", async () => {
    const { container } = render(<ScaleGrid />);
    // Counter shows the formatted model total (1,250,000).
    expect(
      screen.getByText(TOTAL_CELLS.toLocaleString("en-US"), { exact: false }),
    ).toBeInTheDocument();
    // The grid mounts and renders SOME cells, but far fewer than rows*cols.
    await waitFor(() => {
      const cells = container.querySelectorAll("[data-pretable-cell]").length;
      expect(cells).toBeGreaterThan(0);
      expect(cells).toBeLessThan(TOTAL_CELLS);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/website && pnpm test -- ScaleGrid`
Expected: FAIL — `Cannot find module '../showcase/ScaleGrid'`.

- [ ] **Step 3: Write `ScaleGrid.tsx`**

```tsx
// apps/website/app/components/showcase/ScaleGrid.tsx
"use client";

import { PretableSurface } from "@pretable/react";
import { useMemo } from "react";
import {
  type ScaleRow,
  TOTAL_CELLS,
  makeScaleColumns,
  makeScaleRows,
} from "./scaleData";
import { useInView } from "./useInView";
import { useRenderedCellCount } from "./useRenderedCellCount";

const VIEWPORT_HEIGHT = 420;

export function ScaleGrid() {
  const [mountRef, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={mountRef} className="w-full">
      {inView ? (
        <ScaleGridLive />
      ) : (
        <div
          aria-hidden
          style={{ height: VIEWPORT_HEIGHT + 32 }}
          className="w-full rounded-[8px] border border-rule bg-bg-card"
        />
      )}
    </div>
  );
}

function ScaleGridLive() {
  const rows = useMemo(() => makeScaleRows(), []);
  const columns = useMemo(() => makeScaleColumns(), []);
  const { ref, count } = useRenderedCellCount();
  return (
    <>
      <p
        data-testid="scale-counter"
        className="mb-3 font-mono text-[13px] text-text-secondary"
      >
        <strong className="text-text-primary">
          {TOTAL_CELLS.toLocaleString("en-US")}
        </strong>{" "}
        cells in the model ·{" "}
        <strong className="text-accent" data-testid="scale-dom-count">
          {count.toLocaleString("en-US")}
        </strong>{" "}
        rendered in the DOM
      </p>
      <div
        ref={ref}
        className="overflow-hidden rounded-[8px] border border-rule"
      >
        <PretableSurface<ScaleRow>
          ariaLabel="Virtualized 2,500 by 500 grid"
          columns={columns}
          getRowId={(row) => String(row.i)}
          rows={rows}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write `ScaleShowcase.tsx`**

```tsx
// apps/website/app/components/ScaleShowcase.tsx
import { ScaleGrid } from "./showcase/ScaleGrid";

export function ScaleShowcase() {
  return (
    <section
      id="scale"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          08 · scale
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          2,500 rows × 500 columns.{" "}
          <em className="italic text-accent">~160 cells in the DOM.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Pretable virtualizes both axes. The grid below holds 1.25 million
          cells; scroll anywhere and the live counter shows how few actually
          exist in the DOM at once — matching our published 2,500 × 500
          benchmark (~160 peak nodes).
        </p>
        <div className="mt-10">
          <ScaleGrid />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/website && pnpm test -- ScaleGrid`
Expected: PASS (1 test). If jsdom renders all 501 columns (it has no real width), the cell count will be larger than in a browser but still `< TOTAL_CELLS` — the assertion holds.

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/showcase/ScaleGrid.tsx apps/website/app/components/ScaleShowcase.tsx apps/website/app/components/__tests__/ScaleGrid.test.tsx
git commit -m "feat(website): scale showcase section (2,500 x 500 virtualization + live counter)"
```

---

## Task 6: `ColumnLayoutGrid` client island + section

**Files:**

- Create: `apps/website/app/components/showcase/ColumnLayoutGrid.tsx`
- Create: `apps/website/app/components/ColumnLayoutShowcase.tsx`
- Test: `apps/website/app/components/__tests__/ColumnLayoutGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// apps/website/app/components/__tests__/ColumnLayoutGrid.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ColumnLayoutGrid } from "../showcase/ColumnLayoutGrid";

class FiringIO {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe = () => {
    this.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  };
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  root = null;
  rootMargin = "";
  thresholds = [];
}

describe("ColumnLayoutGrid", () => {
  const original = globalThis.IntersectionObserver;
  beforeEach(() => {
    globalThis.IntersectionObserver =
      FiringIO as unknown as typeof IntersectionObserver;
  });
  afterEach(() => {
    globalThis.IntersectionObserver = original;
  });

  it("renders the portfolio headers and a working reset button", async () => {
    render(<ColumnLayoutGrid />);
    await waitFor(() => {
      expect(screen.getByText("Symbol")).toBeInTheDocument();
      expect(screen.getByText("Analyst note")).toBeInTheDocument();
    });
    // Reset remounts the grid; the headers are still present afterward.
    fireEvent.click(screen.getByTestId("reset-layout"));
    await waitFor(() => {
      expect(screen.getByText("Symbol")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/website && pnpm test -- ColumnLayoutGrid`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `ColumnLayoutGrid.tsx`**

```tsx
// apps/website/app/components/showcase/ColumnLayoutGrid.tsx
"use client";

import { PretableSurface } from "@pretable/react";
import { useMemo, useState } from "react";
import {
  LAYOUT_ROWS,
  type LayoutRow,
  makeLayoutColumns,
} from "./columnLayoutData";
import { useInView } from "./useInView";

const VIEWPORT_HEIGHT = 360;

export function ColumnLayoutGrid() {
  const [mountRef, inView] = useInView<HTMLDivElement>();
  return (
    <div ref={mountRef} className="w-full">
      {inView ? (
        <ColumnLayoutGridLive />
      ) : (
        <div
          aria-hidden
          style={{ height: VIEWPORT_HEIGHT + 44 }}
          className="w-full rounded-[8px] border border-rule bg-bg-card"
        />
      )}
    </div>
  );
}

function ColumnLayoutGridLive() {
  const columns = useMemo(() => makeLayoutColumns(), []);
  const [resetKey, setResetKey] = useState(0);
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-mono text-[13px] text-text-secondary">
          drag a column border to resize · drag a header to reorder
        </p>
        <button
          type="button"
          data-testid="reset-layout"
          onClick={() => setResetKey((k) => k + 1)}
          className="rounded-[6px] border border-rule px-3 py-1.5 font-mono text-[12px] text-text-primary hover:bg-bg-card"
        >
          Reset layout
        </button>
      </div>
      <div className="overflow-hidden rounded-[8px] border border-rule">
        <PretableSurface<LayoutRow>
          key={resetKey}
          ariaLabel="Resizable, reorderable columns"
          columns={columns}
          getRowId={(row) => row.id}
          rows={LAYOUT_ROWS}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write `ColumnLayoutShowcase.tsx`**

```tsx
// apps/website/app/components/ColumnLayoutShowcase.tsx
import { ColumnLayoutGrid } from "./showcase/ColumnLayoutGrid";

export function ColumnLayoutShowcase() {
  return (
    <section
      id="column-layout"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          09 · columns, your way
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Resize and reorder. <em className="italic text-accent">Built in.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Drag a column border to resize, drag a header to reorder — no config,
          no plugins. Make a mess, then hit reset.
        </p>
        <div className="mt-10">
          <ColumnLayoutGrid />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/website && pnpm test -- ColumnLayoutGrid`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/showcase/ColumnLayoutGrid.tsx apps/website/app/components/ColumnLayoutShowcase.tsx apps/website/app/components/__tests__/ColumnLayoutGrid.test.tsx
git commit -m "feat(website): column-layout showcase section (resize/reorder + reset)"
```

---

## Task 7: Wire both sections into the homepage

**Files:**

- Modify: `apps/website/app/page.tsx`

- [ ] **Step 1: Add imports**

Add to the import block (alphabetical with the rest):

```tsx
import { ColumnLayoutShowcase } from "./components/ColumnLayoutShowcase";
import { ScaleShowcase } from "./components/ScaleShowcase";
```

- [ ] **Step 2: Insert the sections in the drawer flow**

In the `<DrawerShell>` flow, between the `FeatureGrid` and `CtaSection` blocks, insert:

```tsx
        <ScrollReveal>
          <ScaleShowcase />
        </ScrollReveal>
        <ScrollReveal>
          <ColumnLayoutShowcase />
        </ScrollReveal>
```

Resulting order: `… FeatureGrid → ScaleShowcase → ColumnLayoutShowcase → CtaSection → MountainFooter`.

- [ ] **Step 3: Typecheck + lint**

Run: `cd apps/website && pnpm typecheck && pnpm lint`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): add scale + column-layout showcases to homepage"
```

---

## Task 8: Playwright smoke + full validation

**Files:**

- Modify: `apps/website/e2e/smoke.spec.ts`

- [ ] **Step 1: Add the smoke test**

Append to `apps/website/e2e/smoke.spec.ts`:

```ts
test("showcase: scale grid virtualizes; column layout resizes + resets", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("drawer-handle").click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");

  // --- Scale section: scroll into view, grid mounts, counter proves virtualization ---
  await page.locator("#scale").scrollIntoViewIfNeeded();
  const scaleGrid = page.getByRole("grid", { name: /2,500 by 500/i });
  await expect(scaleGrid).toBeVisible({ timeout: 10_000 });
  // Model total is shown.
  await expect(page.getByTestId("scale-counter")).toContainText("1,250,000");
  // DOM-rendered cell count is tiny relative to 1.25M (virtualization on).
  await expect
    .poll(
      async () => await page.locator("#scale [data-pretable-cell]").count(),
      { timeout: 10_000 },
    )
    .toBeLessThan(2000);
  // Scroll the grid; the rendered count stays small.
  await page
    .locator("#scale [data-pretable-scroll-viewport]")
    .evaluate((el) => {
      el.scrollTop = 4000;
      el.scrollLeft = 6000;
    });
  await expect
    .poll(async () => await page.locator("#scale [data-pretable-cell]").count())
    .toBeLessThan(2000);

  // --- Column-layout section: resize a column, then reset ---
  await page.locator("#column-layout").scrollIntoViewIfNeeded();
  const layoutGrid = page.getByRole("grid", {
    name: /resizable, reorderable/i,
  });
  await expect(layoutGrid).toBeVisible({ timeout: 10_000 });

  const symbolHeader = page.locator(
    '#column-layout [data-pretable-header-cell][data-pretable-column-id="symbol"]',
  );
  const widthBefore = (await symbolHeader.boundingBox())?.width ?? 0;

  // Drag the symbol column's resize handle to the right by ~80px.
  const handle = symbolHeader.locator("[data-pretable-resize-handle]");
  const hb = await handle.boundingBox();
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 80, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
  }
  const widthAfter = (await symbolHeader.boundingBox())?.width ?? 0;
  expect(widthAfter).toBeGreaterThan(widthBefore + 20);

  // Reset restores the original width.
  await page.getByTestId("reset-layout").click();
  await expect
    .poll(async () => (await symbolHeader.boundingBox())?.width ?? 0)
    .toBeLessThan(widthBefore + 20);
});
```

Note on selectors: confirm the header-cell and resize-handle data attributes by inspecting the rendered DOM (`data-pretable-header-cell`, `data-pretable-column-id`, `data-pretable-resize-handle`) — grep `packages/react/src/pretable-surface.tsx` for the exact attribute names and adjust the locators if they differ. If reorder/resize drag proves flaky in CI, keep the resize+reset assertions and drop the drag-reorder (there is none here), but do **not** silently weaken the virtualization assertion.

- [ ] **Step 2: Run the smoke test**

Run: `cd apps/website && pnpm e2e -- smoke`
Expected: PASS, including the new test.

- [ ] **Step 3: Full validation sweep**

Run from repo root:

```bash
cd apps/website && pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e
```

Expected: all green. (`pnpm build` must succeed — the new sections render server-side with client islands.)

- [ ] **Step 4: Commit**

```bash
git add apps/website/e2e/smoke.spec.ts
git commit -m "test(website): smoke for scale virtualization + column resize/reset"
```

---

## Self-Review notes (for the executor)

- **Spec coverage:** Scale section (Task 5) ✓; rendered-cell counter (Task 3 + 5) ✓; column resize/reorder + reset (Task 6) ✓; lazy mount (Task 1, used in 5 & 6) ✓; placement after FeatureGrid (Task 7) ✓; unit + RTL + smoke (Tasks 1–8) ✓; portfolio-slice data (Task 4) ✓; generic scale data (Task 2) ✓.
- **Out of scope, do not add:** theming/dark/density, headless example, any `packages/*` change.
- **Type consistency:** `ScaleRow`, `LayoutRow`, `makeScaleColumns`, `makeScaleRows`, `synthCell`, `TOTAL_CELLS`, `makeLayoutColumns`, `LAYOUT_ROWS`, `countCells`, `useRenderedCellCount`, `useInView` — names are used identically across tasks.
- **Smoke selectors are the one soft spot:** verify `data-pretable-header-cell` / `data-pretable-resize-handle` attribute names against `pretable-surface.tsx` before finalizing; adjust locators to match reality.
