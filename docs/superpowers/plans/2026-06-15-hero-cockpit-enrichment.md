# Hero Cockpit Enrichment (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the homepage hero exercise pretable's interaction surface — inline Qty editing with an async order lifecycle, cell-range selection + keyboard + clipboard copy, and live filtering — all via public APIs and all coexisting with the live stream, with the controls hosted in the right sidebar.

**Architecture:** Pure, unit-tested helpers (`qty-edit.ts`, `filters.ts`, `selection.ts`, `positions-math.ts`) hold the logic. `positionColumns` becomes a factory closing over a live `getRows` accessor (so the Qty `validate` can compute the 7% guardrail against current NAV) while keeping a stable identity. `HeroGrid` gains controlled `state.filters`, an `onCellEdit` async handler, an `onSelectionChange` summary, and a streaming reducer that derives `weight`/NAV so edits and ticks stay consistent. `PortfolioSummary` is restructured into stacked sidebar sections (Filter / Selection / Rollup) seeding a future advanced panel.

**Tech Stack:** Next 16, React 19, TypeScript, Vitest (+ jsdom + @testing-library/react), Playwright, `@pretable/react`, CSS modules.

---

## Background the engineer needs

- All work is in `apps/website/app/components/` (the hero) + `heroGrid/`. **No `packages/*` changes** are expected.
- **Cell-edit lifecycle (verified, `@pretable/react`):** the surface's edit controller, on commit, runs:
  1. `parseEditValue(String(draft), input)` → the typed value.
  2. if `column.validate`: status → `validating`; `await validate(value, input)`; a returned string → status back to `editing` with that error (`markEditInvalid`); `true` → continue.
  3. status → `saving`; `await onCellEdit({ rowId, columnId, value, row })`; resolve → commit succeeds; **throw → status `error` with the thrown message** (`markEditError`).
  `PretableEditorInput` (passed to `renderEditor`) has: `draft`, `setDraft(v)`, `commit(dir?)`, `cancel()`, `status` (`"checking"|"editing"|"validating"|"saving"|"error"`), `error?`, `row`, `column`, `value`.
- **Column edit fields (`PretableColumn`):** `editable?: boolean | (input)=>boolean|Promise<boolean>`, `validate?: (value, input)=> (true|string)|Promise<...>`, `parseEditValue?: (raw, input)=>unknown`, `renderEditor?: (input)=>ReactNode`.
- **Filter engine (verified):** `state.filters: Record<columnId,string>`; each is a case-insensitive **substring** match against that column's `value(row)`, **AND**-combined; a filter on a non-existent column id is ignored.
- **Grid stability rule (from earlier on this branch):** the grid is created once and reconciled in place; it recreates only if `columns`/`getRowId`/`autosize` identity changes. So **`columns` must keep a stable identity** — build the factory result in a `useMemo(..., [])` reading live data through a ref.
- **Streaming reducer:** `HeroGrid`'s `onTransaction` merges tick `update` patches into `rows`. Ticks carry `last/mktValue/dayPnl/dayPnlPct/weight` computed from the recording's original quantities.
- Run a single test file: `pnpm --filter @pretable/app-website exec vitest run <path>` (add `--environment jsdom` for `.tsx`/DOM tests). Full app suite: `pnpm --filter @pretable/app-website test`.

### File structure

| File | Responsibility |
|------|----------------|
| `heroGrid/positions-math.ts` (new) | Pure: NAV + weight recomputation from rows. |
| `heroGrid/qty-edit.ts` (new) | Pure: parse/sanity-validate qty, 7% guardrail check, deterministic desk-rejection. |
| `heroGrid/filters.ts` (new) | Pure: build `state.filters` from `{search, sector}`. |
| `heroGrid/selection.ts` (new) | Pure: summarize selection ranges → `{rows, cols}`. |
| `heroGrid/positionColumns.tsx` (modify) | Factory `makePositionColumns({getRows})`; symbol `value` carries name; new `sector` column; editable `qty` column. |
| `heroGrid/QtyEditor.tsx` (new) + `qtyEditor.module.css` | `renderEditor` component: input + cell-anchored lifecycle popover. |
| `heroGrid/sidebar/FilterSection.tsx` (new) | Search input + sector chips. |
| `heroGrid/sidebar/SelectionSection.tsx` (new) | Live selection summary + "Copied ✓". |
| `heroGrid/PortfolioSummary.tsx` (modify) | Compose Filter / Selection / Rollup sections. |
| `heroGrid/sidebar/sidebar.module.css` (new) | Section styling. |
| `HeroGrid.tsx` (modify) | Columns factory, controlled filters, onCellEdit, onSelectionChange, copy feedback, reducer weight/edit reconciliation. |

---

## Task 1: Positions math (NAV + weight)

**Files:** Create `apps/website/app/components/heroGrid/positions-math.ts`; Test `apps/website/app/components/heroGrid/__tests__/positions-math.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { computeNav, withDerivedWeights } from "../positions-math";
import type { PositionRow } from "../types";

function row(p: Partial<PositionRow> & { id: string }): PositionRow {
  return { symbol: p.id, name: p.id, sector: "Technology", qty: 0, last: 0,
    mktValue: 0, dayPnl: 0, dayPnlPct: 0, weight: 0, analyst: "", flag: "hold", ...p };
}

describe("positions-math", () => {
  it("computeNav sums market value", () => {
    expect(computeNav([row({ id: "A", mktValue: 30 }), row({ id: "B", mktValue: 10 })])).toBe(40);
  });
  it("withDerivedWeights sets each weight to mktValue / NAV percent", () => {
    const out = withDerivedWeights([row({ id: "A", mktValue: 30 }), row({ id: "B", mktValue: 10 })]);
    expect(out.find((r) => r.id === "A")!.weight).toBe(75);
    expect(out.find((r) => r.id === "B")!.weight).toBe(25);
  });
  it("withDerivedWeights returns 0 weights when NAV is 0", () => {
    const out = withDerivedWeights([row({ id: "A", mktValue: 0 })]);
    expect(out[0]!.weight).toBe(0);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `pnpm --filter @pretable/app-website exec vitest run app/components/heroGrid/__tests__/positions-math.test.ts` → module not found.

- [ ] **Step 3: Implement `positions-math.ts`**

```ts
import type { PositionRow } from "./types";

export function computeNav(rows: readonly PositionRow[]): number {
  return rows.reduce((sum, r) => sum + r.mktValue, 0);
}

/** Return rows with `weight` derived from each mktValue against total NAV (percent, 1 dp). */
export function withDerivedWeights(rows: readonly PositionRow[]): PositionRow[] {
  const nav = computeNav(rows);
  return rows.map((r) => {
    const weight = nav > 0 ? Number(((r.mktValue / nav) * 100).toFixed(1)) : 0;
    return weight === r.weight ? r : { ...r, weight };
  });
}
```

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/positions-math.ts apps/website/app/components/heroGrid/__tests__/positions-math.test.ts
git commit -m "feat(website): NAV + derived-weight helpers for the cockpit"
```

---

## Task 2: Qty-edit logic (sanity, guardrail, desk rejection)

**Files:** Create `apps/website/app/components/heroGrid/qty-edit.ts`; Test `__tests__/qty-edit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseQty, sanityCheckQty, breachesGuardrail, isDeskRejected, GUARDRAIL_PCT } from "../qty-edit";

describe("qty-edit", () => {
  it("parseQty strips commas/spaces to an integer", () => {
    expect(parseQty("12,500")).toBe(12500);
    expect(parseQty(" 4200 ")).toBe(4200);
  });
  it("parseQty returns NaN for non-integers", () => {
    expect(Number.isNaN(parseQty("12.5"))).toBe(true);
    expect(Number.isNaN(parseQty("abc"))).toBe(true);
  });
  it("sanityCheckQty rejects non-positive and >10x current", () => {
    expect(sanityCheckQty(0, 100)).toMatch(/whole number/i);
    expect(sanityCheckQty(-5, 100)).toMatch(/whole number/i);
    expect(sanityCheckQty(1001, 100)).toMatch(/10×/);
    expect(sanityCheckQty(900, 100)).toBe(true);
  });
  it("breachesGuardrail compares the new single-name weight against NAV", () => {
    // newMktValue large vs others → > 7%
    expect(breachesGuardrail({ newMktValue: 50, otherMktValue: 100 })).toBe(true);  // 50/150 = 33%
    expect(breachesGuardrail({ newMktValue: 5, otherMktValue: 200 })).toBe(false);  // 5/205 ≈ 2.4%
    expect(GUARDRAIL_PCT).toBe(7);
  });
  it("isDeskRejected is deterministic per symbol+qty", () => {
    const a = isDeskRejected("NVDA", 14000);
    expect(isDeskRejected("NVDA", 14000)).toBe(a);   // stable
    expect(typeof a).toBe("boolean");
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL.**

- [ ] **Step 3: Implement `qty-edit.ts`**

```ts
export const GUARDRAIL_PCT = 7;

export function parseQty(raw: string): number {
  const cleaned = raw.replace(/[, ]/g, "").trim();
  if (!/^-?\d+$/.test(cleaned)) return Number.NaN;
  return Number.parseInt(cleaned, 10);
}

/** Returns `true` if acceptable, else a human error string. */
export function sanityCheckQty(qty: number, currentQty: number): true | string {
  if (!Number.isInteger(qty) || qty <= 0) return "Enter a whole number of shares";
  if (qty > currentQty * 10) return "Too large — over 10× current position";
  return true;
}

/** New single-name weight = newMktValue / (newMktValue + every other holding's mktValue). */
export function breachesGuardrail(args: { newMktValue: number; otherMktValue: number }): boolean {
  const nav = args.newMktValue + args.otherMktValue;
  if (nav <= 0) return false;
  return (args.newMktValue / nav) * 100 > GUARDRAIL_PCT;
}

/** Deterministic ~1-in-7 desk rejection, seeded by symbol+qty so demos/tests are stable. */
export function isDeskRejected(symbol: string, qty: number): boolean {
  let h = 2166136261;
  const key = `${symbol}:${qty}`;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 7 === 0;
}
```

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/qty-edit.ts apps/website/app/components/heroGrid/__tests__/qty-edit.test.ts
git commit -m "feat(website): qty edit sanity/guardrail/desk-rejection logic"
```

---

## Task 3: Filter builder

**Files:** Create `apps/website/app/components/heroGrid/filters.ts`; Test `__tests__/filters.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildFilters, SECTORS, type FilterState } from "../filters";

describe("buildFilters", () => {
  it("is empty for the default state", () => {
    expect(buildFilters({ search: "", sector: null })).toEqual({});
  });
  it("maps search to the symbol column", () => {
    expect(buildFilters({ search: "nvda", sector: null })).toEqual({ symbol: "nvda" });
  });
  it("maps a sector chip to the sector column", () => {
    expect(buildFilters({ search: "", sector: "Energy" })).toEqual({ sector: "Energy" });
  });
  it("composes both (AND)", () => {
    expect(buildFilters({ search: "x", sector: "Technology" })).toEqual({ symbol: "x", sector: "Technology" });
  });
  it("trims whitespace-only search to empty", () => {
    expect(buildFilters({ search: "   ", sector: null })).toEqual({});
  });
  it("exposes the sector list including All", () => {
    expect(SECTORS[0]).toBe("All");
    expect(SECTORS).toContain("Technology");
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL.**

- [ ] **Step 3: Implement `filters.ts`**

```ts
export const SECTORS = [
  "All", "Technology", "Consumer", "Health Care", "Financials", "Energy",
] as const;

export interface FilterState {
  search: string;
  sector: string | null; // null or "All" → no sector filter
}

export function buildFilters(state: FilterState): Record<string, string> {
  const out: Record<string, string> = {};
  const search = state.search.trim();
  if (search) out.symbol = search;
  if (state.sector && state.sector !== "All") out.sector = state.sector;
  return out;
}
```

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/filters.ts apps/website/app/components/heroGrid/__tests__/filters.test.ts
git commit -m "feat(website): filter-state → engine filters builder"
```

---

## Task 4: Selection summary

**Files:** Create `apps/website/app/components/heroGrid/selection.ts`; Test `__tests__/selection.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { summarizeSelection } from "../selection";
import type { PretableSelectionState } from "@pretable/react";

const sel = (ranges: Array<[string, string, string, string]>): PretableSelectionState => ({
  ranges: ranges.map(([startRowId, endRowId, startColumnId, endColumnId]) => ({
    startRowId, endRowId, startColumnId, endColumnId })),
  anchor: null,
});

describe("summarizeSelection", () => {
  it("returns null for an empty selection", () => {
    expect(summarizeSelection(sel([]), ["c1", "c2", "c3"], ["r1", "r2", "r3"])).toBeNull();
  });
  it("counts rows × columns of a single range", () => {
    expect(summarizeSelection(sel([["r1", "r2", "c1", "c2"]]), ["c1", "c2", "c3"], ["r1", "r2", "r3"]))
      .toEqual({ rows: 2, cols: 2 });
  });
  it("counts the union across multiple ranges", () => {
    expect(summarizeSelection(sel([["r1", "r1", "c1", "c1"], ["r3", "r3", "c3", "c3"]]),
      ["c1", "c2", "c3"], ["r1", "r2", "r3"])).toEqual({ rows: 2, cols: 2 });
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL.**

- [ ] **Step 3: Implement `selection.ts`**

```ts
import type { PretableSelectionState } from "@pretable/react";

export interface SelectionSummary {
  rows: number;
  cols: number;
}

/**
 * Count distinct rows and columns touched by the selection ranges. Ranges are
 * given by boundary ids; we resolve them against the visible orders to expand.
 */
export function summarizeSelection(
  selection: PretableSelectionState,
  columnOrder: readonly string[],
  rowOrder: readonly string[],
): SelectionSummary | null {
  if (!selection.ranges.length) return null;
  const rowIdx = new Map(rowOrder.map((id, i) => [id, i]));
  const colIdx = new Map(columnOrder.map((id, i) => [id, i]));
  const rowSet = new Set<number>();
  const colSet = new Set<number>();
  for (const r of selection.ranges) {
    const r0 = rowIdx.get(r.startRowId), r1 = rowIdx.get(r.endRowId);
    const c0 = colIdx.get(r.startColumnId), c1 = colIdx.get(r.endColumnId);
    if (r0 === undefined || r1 === undefined || c0 === undefined || c1 === undefined) continue;
    for (let i = Math.min(r0, r1); i <= Math.max(r0, r1); i += 1) rowSet.add(i);
    for (let j = Math.min(c0, c1); j <= Math.max(c0, c1); j += 1) colSet.add(j);
  }
  if (!rowSet.size || !colSet.size) return null;
  return { rows: rowSet.size, cols: colSet.size };
}
```

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/selection.ts apps/website/app/components/heroGrid/__tests__/selection.test.ts
git commit -m "feat(website): selection-range summary helper"
```

---

## Task 5: Columns factory — symbol value, sector column, editable qty

**Files:** Modify `apps/website/app/components/heroGrid/positionColumns.tsx`; Modify `__tests__/positionColumns.test.tsx`

This converts the exported const into a factory `makePositionColumns({ getRows })`. The qty column's `validate` is async (compliance delay + sanity + guardrail using live NAV via `getRows`); `renderEditor` delegates to `QtyEditor` (Task 6).

- [ ] **Step 1: Update the test** `__tests__/positionColumns.test.tsx`

```tsx
import { describe, expect, it } from "vitest";
import { makePositionColumns } from "../positionColumns";
import type { PositionRow } from "../types";

const cols = makePositionColumns({ getRows: () => [] });

describe("makePositionColumns", () => {
  it("exposes columns in order incl. the sector column", () => {
    expect(cols.map((c) => c.id)).toEqual([
      "symbol", "sector", "qty", "last", "mktValue", "dayPnl", "weight", "analyst",
    ]);
  });
  it("symbol value carries the company name so search matches both", () => {
    const symbol = cols.find((c) => c.id === "symbol")!;
    const row = { symbol: "NVDA", name: "NVIDIA Corp" } as PositionRow;
    expect(String(symbol.value!(row))).toBe("NVDA NVIDIA Corp");
  });
  it("qty is editable with a numeric parse", () => {
    const qty = cols.find((c) => c.id === "qty")!;
    expect(qty.editable).toBe(true);
    expect(qty.parseEditValue!("1,200", {} as never)).toBe(1200);
  });
  it("qty validate rejects a guardrail breach using live NAV", async () => {
    const rows: PositionRow[] = [
      { id: "NVDA", symbol: "NVDA", name: "NVIDIA Corp", sector: "Technology", qty: 100, last: 10,
        mktValue: 1000, dayPnl: 0, dayPnlPct: 0, weight: 0, analyst: "", flag: "hold" },
      { id: "MSFT", symbol: "MSFT", name: "Microsoft", sector: "Technology", qty: 100, last: 1,
        mktValue: 100, dayPnl: 0, dayPnlPct: 0, weight: 0, analyst: "", flag: "hold" },
    ];
    const qty = makePositionColumns({ getRows: () => rows }).find((c) => c.id === "qty")!;
    const input = { rowId: "NVDA", columnId: "qty", row: rows[0]!, column: qty, value: 100 } as never;
    // new qty 1000 × last 10 = 10000 mktValue → 10000/(10000+100) ≈ 99% > 7%
    await expect(qty.validate!(1000, input)).resolves.toMatch(/guardrail/i);
    // a tiny change passes sanity + guardrail
    await expect(qty.validate!(120, input)).resolves.toBe(true);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** (`makePositionColumns` not exported).

- [ ] **Step 3: Rewrite `positionColumns.tsx`**

Keep all existing render functions (symbol stacked render, flash price, dayPnl, analyst pill). Wrap in a factory; add the `sector` column; add edit config to `qty`. Full file:

```tsx
import type { PretableColumn, PretableEditInput } from "@pretable/react";
import { fmtPrice, fmtSignedUsd, fmtPct, fmtCompactUsd } from "./format";
import { parseQty, sanityCheckQty, breachesGuardrail } from "./qty-edit";
import { computeNav } from "./positions-math";
import { QtyEditor } from "./QtyEditor";
import type { PositionFlag, PositionRow } from "./types";
import styles from "./cells.module.css";

const PILL_CLASS: Record<PositionFlag, string> = {
  trim: styles.pillTrim, watch: styles.pillWatch, risk: styles.pillRisk, hold: styles.pillHold,
};

const COMPLIANCE_DELAY_MS = 400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PositionColumnsDeps {
  /** Live accessor to current rows, for NAV-aware guardrail validation. */
  getRows: () => readonly PositionRow[];
}

export function makePositionColumns(
  deps: PositionColumnsDeps,
): PretableColumn<PositionRow>[] {
  return [
    {
      id: "symbol",
      header: "Symbol",
      widthPx: 150,
      pinned: "left",
      // value carries symbol + name so the search filter matches either.
      value: (row) => `${row.symbol} ${row.name}`,
      render: ({ row }) => (
        <span className={styles.symbol}>
          {row.symbol}
          <span className={styles.symbolSub}>{row.name}</span>
        </span>
      ),
    },
    {
      id: "sector",
      header: "Sector",
      widthPx: 110,
      value: (row) => row.sector,
    },
    {
      id: "qty",
      header: "Qty",
      widthPx: 96,
      value: (row) => row.qty,
      format: ({ value }) => (value as number).toLocaleString("en-US"),
      editable: true,
      parseEditValue: (raw) => parseQty(raw),
      validate: async (value, input: PretableEditInput<PositionRow>) => {
        const qty = value as number;
        const sanity = sanityCheckQty(qty, input.row.qty);
        if (sanity !== true) return sanity;
        await sleep(COMPLIANCE_DELAY_MS); // simulated compliance check (status = validating)
        const rows = deps.getRows();
        const newMktValue = qty * input.row.last;
        const otherMktValue = computeNav(rows) - input.row.mktValue;
        if (breachesGuardrail({ newMktValue, otherMktValue })) {
          return "Rejected: breaches 7% single-name guardrail";
        }
        return true;
      },
      renderEditor: (input) => <QtyEditor input={input} />,
    },
    {
      id: "last",
      header: "Last",
      widthPx: 96,
      value: (row) => row.last,
      render: ({ row }) => {
        const dirClass = row.lastDir === "up" ? styles.flashUp : row.lastDir === "down" ? styles.flashDown : "";
        return (
          <span className={styles.num}>
            <span key={row.tickSeq ?? 0} className={`${styles.flash} ${dirClass}`}>{fmtPrice(row.last)}</span>
          </span>
        );
      },
    },
    {
      id: "mktValue",
      header: "Mkt Val",
      widthPx: 96,
      value: (row) => row.mktValue,
      format: ({ value }) => fmtCompactUsd(value as number),
    },
    {
      id: "dayPnl",
      header: "Day P&L",
      widthPx: 120,
      value: (row) => row.dayPnl,
      render: ({ row }) => (
        <span className={`${styles.num} ${row.dayPnl >= 0 ? styles.up : styles.down}`}>
          {fmtSignedUsd(row.dayPnl)}
          <span className={styles.subline}>{fmtPct(row.dayPnlPct)}</span>
        </span>
      ),
    },
    {
      id: "weight",
      header: "Wt",
      widthPx: 64,
      value: (row) => row.weight,
      format: ({ value }) => `${(value as number).toFixed(1)}%`,
    },
    {
      id: "analyst",
      header: "AI Analyst",
      widthPx: 320,
      wrap: true,
      sortable: false,
      value: (row) => row.analyst,
      render: ({ row }) => (
        <span className={styles.analyst}>
          {row.analyst}
          {row.analyst.length > 0 && (
            <span className={`${styles.pill} ${PILL_CLASS[row.flag]}`}>{row.flag}</span>
          )}
        </span>
      ),
    },
  ];
}
```

- [ ] **Step 4: Run the test, confirm PASS** (QtyEditor must exist — create it in Task 6 first if your runner resolves the import eagerly; otherwise this task's test passes once Task 6 lands. If blocked on the import, do Task 6 then return.)

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/positionColumns.tsx apps/website/app/components/heroGrid/__tests__/positionColumns.test.tsx
git commit -m "feat(website): positionColumns factory — symbol+name value, sector column, editable qty"
```

---

## Task 6: QtyEditor (input + cell-anchored lifecycle popover)

**Files:** Create `apps/website/app/components/heroGrid/QtyEditor.tsx` + `qtyEditor.module.css`; Test `__tests__/QtyEditor.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QtyEditor } from "../QtyEditor";

function makeInput(over: Record<string, unknown> = {}) {
  return {
    draft: "12500", setDraft: vi.fn(), commit: vi.fn(), cancel: vi.fn(),
    status: "editing", error: undefined, row: {}, column: {}, value: 12500, ...over,
  } as never;
}

describe("QtyEditor", () => {
  it("renders the draft in an input and pushes edits via setDraft", () => {
    const input = makeInput();
    render(<QtyEditor input={input} />);
    const el = screen.getByRole("textbox");
    fireEvent.change(el, { target: { value: "14000" } });
    expect((input as { setDraft: ReturnType<typeof vi.fn> }).setDraft).toHaveBeenCalledWith("14000");
  });
  it("shows the compliance popover while validating", () => {
    render(<QtyEditor input={makeInput({ status: "validating" })} />);
    expect(screen.getByText(/compliance check/i)).toBeInTheDocument();
  });
  it("shows the submitting popover while saving", () => {
    render(<QtyEditor input={makeInput({ status: "saving" })} />);
    expect(screen.getByText(/submitting order/i)).toBeInTheDocument();
  });
  it("shows the error message popover on rejection", () => {
    render(<QtyEditor input={makeInput({ status: "error", error: "Rejected by trading desk" })} />);
    expect(screen.getByText(/trading desk/i)).toBeInTheDocument();
  });
  it("commits on Enter and cancels on Escape", () => {
    const input = makeInput();
    render(<QtyEditor input={input} />);
    const el = screen.getByRole("textbox");
    fireEvent.keyDown(el, { key: "Enter" });
    expect((input as { commit: ReturnType<typeof vi.fn> }).commit).toHaveBeenCalledWith("down");
    fireEvent.keyDown(el, { key: "Escape" });
    expect((input as { cancel: ReturnType<typeof vi.fn> }).cancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL.**

- [ ] **Step 3: Create `qtyEditor.module.css`**

```css
.wrap { position: relative; display: inline-flex; align-items: center; gap: 4px; }
.input { width: 64px; font: inherit; font-variant-numeric: tabular-nums; padding: 1px 4px;
  border: 1px solid var(--pt-rule-strong, #888); border-radius: 4px; background: var(--pt-bg-card, #fff); }
.icon { font-size: 11px; line-height: 1; }
.spin { animation: spin 0.8s linear infinite; display: inline-block; }
@keyframes spin { to { transform: rotate(360deg); } }
.pending { color: var(--pt-color-warning, #b87800); }
.error { color: var(--pt-color-negative, #c0392b); }
.popover { position: absolute; top: 100%; left: 0; margin-top: 3px; z-index: 5; white-space: nowrap;
  font-size: 11px; padding: 3px 8px; border-radius: 6px; border: 1px solid var(--pt-rule, #ddd);
  background: var(--pt-bg-card, #fff); box-shadow: 0 2px 8px rgba(0,0,0,.12); display: inline-flex; gap: 5px; align-items: center; }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
```

- [ ] **Step 4: Create `QtyEditor.tsx`**

```tsx
import type { PretableEditorInput } from "@pretable/react";
import type { PositionRow } from "./types";
import styles from "./qtyEditor.module.css";

export function QtyEditor({ input }: { input: PretableEditorInput<PositionRow> }) {
  const { status, error } = input;
  const pending = status === "validating" || status === "saving";

  return (
    <span className={styles.wrap}>
      <input
        aria-label="Edit quantity"
        className={styles.input}
        autoFocus
        value={String(input.draft ?? "")}
        onChange={(e) => input.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); input.commit("down"); }
          else if (e.key === "Escape") { e.preventDefault(); input.cancel(); }
        }}
      />
      {status === "validating" && (
        <span className={`${styles.icon} ${styles.pending}`} aria-hidden="true">⟳</span>
      )}
      {pending && (
        <span className={styles.popover} role="status">
          <span className={`${styles.icon} ${styles.pending} ${styles.spin}`} aria-hidden="true">⟳</span>
          {status === "validating" ? "compliance check…" : "submitting order…"}
        </span>
      )}
      {!pending && error && (
        <span className={`${styles.popover} ${styles.error}`} role="alert">{error}</span>
      )}
    </span>
  );
}
```

- [ ] **Step 5: Run the test, confirm PASS.** Also re-run Task 5's test (now that QtyEditor exists).

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/heroGrid/QtyEditor.tsx apps/website/app/components/heroGrid/qtyEditor.module.css apps/website/app/components/heroGrid/__tests__/QtyEditor.test.tsx
git commit -m "feat(website): QtyEditor with cell-anchored lifecycle popover"
```

---

## Task 7: FilterSection (search + sector chips)

**Files:** Create `apps/website/app/components/heroGrid/sidebar/FilterSection.tsx` + `sidebar/sidebar.module.css`; Test `__tests__/FilterSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FilterSection } from "../sidebar/FilterSection";

describe("FilterSection", () => {
  it("emits search text changes", () => {
    const onSearch = vi.fn();
    render(<FilterSection search="" sector="All" onSearch={onSearch} onSector={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/filter symbol/i), { target: { value: "nvda" } });
    expect(onSearch).toHaveBeenCalledWith("nvda");
  });
  it("emits sector chip selection", () => {
    const onSector = vi.fn();
    render(<FilterSection search="" sector="All" onSearch={vi.fn()} onSector={onSector} />);
    fireEvent.click(screen.getByRole("button", { name: "Energy" }));
    expect(onSector).toHaveBeenCalledWith("Energy");
  });
  it("marks the active sector chip", () => {
    render(<FilterSection search="" sector="Technology" onSearch={vi.fn()} onSector={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Technology" })).toHaveAttribute("aria-pressed", "true");
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL.**

- [ ] **Step 3: Create `sidebar/sidebar.module.css`**

```css
.section { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--pt-rule, #eee); }
.label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; opacity: .55; }
.search { width: 100%; box-sizing: border-box; font: inherit; font-size: 12px; padding: 4px 8px;
  border: 1px solid var(--pt-rule-strong, #ccc); border-radius: 6px; background: var(--pt-bg-card, #fff); }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font-size: 11px; padding: 2px 8px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--pt-rule-strong, #ccc); background: transparent; color: inherit; }
.chip[aria-pressed="true"] { background: var(--pt-accent, #2563eb); color: #fff; border-color: var(--pt-accent, #2563eb); }
.selsum { font-size: 12px; font-weight: 600; color: var(--pt-accent, #2563eb); }
.copied { color: var(--pt-color-positive, #1a8f50); }
```

- [ ] **Step 4: Create `sidebar/FilterSection.tsx`**

```tsx
import { SECTORS } from "../filters";
import styles from "./sidebar.module.css";

export interface FilterSectionProps {
  search: string;
  sector: string;
  onSearch: (value: string) => void;
  onSector: (value: string) => void;
}

export function FilterSection({ search, sector, onSearch, onSector }: FilterSectionProps) {
  return (
    <section className={styles.section} aria-label="Filters">
      <span className={styles.label}>Filter</span>
      <input
        className={styles.search}
        placeholder="Filter symbol or name…"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
      />
      <div className={styles.chips} role="group" aria-label="Sector">
        {SECTORS.map((s) => (
          <button
            key={s}
            type="button"
            className={styles.chip}
            aria-pressed={sector === s}
            onClick={() => onSector(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run it, confirm PASS.**

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/heroGrid/sidebar/FilterSection.tsx apps/website/app/components/heroGrid/sidebar/sidebar.module.css apps/website/app/components/heroGrid/__tests__/FilterSection.test.tsx
git commit -m "feat(website): sidebar FilterSection (search + sector chips)"
```

---

## Task 8: SelectionSection

**Files:** Create `apps/website/app/components/heroGrid/sidebar/SelectionSection.tsx`; Test `__tests__/SelectionSection.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SelectionSection } from "../sidebar/SelectionSection";

describe("SelectionSection", () => {
  it("renders nothing when there is no summary", () => {
    const { container } = render(<SelectionSection summary={null} copied={false} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("shows rows × cols and the copy hint", () => {
    render(<SelectionSection summary={{ rows: 3, cols: 2 }} copied={false} />);
    expect(screen.getByText(/3 × 2 selected/i)).toBeInTheDocument();
    expect(screen.getByText(/⌘C to copy/i)).toBeInTheDocument();
  });
  it("shows Copied ✓ after a copy", () => {
    render(<SelectionSection summary={{ rows: 1, cols: 1 }} copied={true} />);
    expect(screen.getByText(/copied/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL.**

- [ ] **Step 3: Create `sidebar/SelectionSection.tsx`**

```tsx
import type { SelectionSummary } from "../selection";
import styles from "./sidebar.module.css";

export interface SelectionSectionProps {
  summary: SelectionSummary | null;
  copied: boolean;
}

export function SelectionSection({ summary, copied }: SelectionSectionProps) {
  if (!summary) return null;
  return (
    <section className={styles.section} aria-label="Selection">
      <span className={styles.label}>Selection</span>
      <span className={styles.selsum}>
        {summary.rows} × {summary.cols} selected · ⌘C to copy
        {copied && <span className={styles.copied}> · Copied ✓</span>}
      </span>
    </section>
  );
}
```

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/sidebar/SelectionSection.tsx apps/website/app/components/heroGrid/__tests__/SelectionSection.test.tsx
git commit -m "feat(website): sidebar SelectionSection (live summary + copied)"
```

---

## Task 9: Restructure PortfolioSummary into sections

**Files:** Modify `apps/website/app/components/heroGrid/PortfolioSummary.tsx`; Modify `__tests__/PortfolioSummary.test.tsx`

`PortfolioSummary` becomes a container: `FilterSection` + `SelectionSection` + the existing rollup markup (now its tail). It gains props for filter state/handlers and selection summary; the rollup logic (NAV/P&L/allocation/alerts) is unchanged and stays whole-book.

- [ ] **Step 1: Update the test** — add to `__tests__/PortfolioSummary.test.tsx` (keep existing rollup tests; they still pass since rollup markup is unchanged). Add props to the existing render calls. New cases:

```tsx
// add alongside existing tests; update the existing render() calls to pass the new props:
//   <PortfolioSummary rows={rows} filter={{search:"",sector:"All"}} onSearch={()=>{}}
//      onSector={()=>{}} selection={null} copied={false} />
it("renders the filter controls", () => {
  render(<PortfolioSummary rows={rows} filter={{ search: "", sector: "All" }}
    onSearch={() => {}} onSector={() => {}} selection={null} copied={false} />);
  expect(screen.getByPlaceholderText(/filter symbol/i)).toBeInTheDocument();
});
it("renders the selection summary when present", () => {
  render(<PortfolioSummary rows={rows} filter={{ search: "", sector: "All" }}
    onSearch={() => {}} onSector={() => {}} selection={{ rows: 2, cols: 2 }} copied={false} />);
  expect(screen.getByText(/2 × 2 selected/i)).toBeInTheDocument();
});
```

(Update the three existing `render(<PortfolioSummary rows={rows} />)` calls to include the new props so they typecheck.)

- [ ] **Step 2: Run it, confirm FAIL** (new props/section not present).

- [ ] **Step 3: Edit `PortfolioSummary.tsx`** — extend the props and prepend the two sections; keep the existing `buildModel`/rollup JSX exactly as-is but wrap the rollup in its own `<section>` for visual consistency.

```tsx
// add imports
import { FilterSection } from "./sidebar/FilterSection";
import { SelectionSection } from "./sidebar/SelectionSection";
import type { FilterState } from "./filters";
import type { SelectionSummary } from "./selection";

// extend props
export interface PortfolioSummaryProps {
  rows: readonly PositionRow[];
  filter: FilterState;
  onSearch: (value: string) => void;
  onSector: (value: string) => void;
  selection: SelectionSummary | null;
  copied: boolean;
}

// in the component, render sections before the existing rollup markup:
export function PortfolioSummary({ rows, filter, onSearch, onSector, selection, copied }: PortfolioSummaryProps) {
  const model = useMemo(() => buildModel(rows), [rows]);
  return (
    <aside aria-label="Portfolio summary" className={styles.board}>
      <FilterSection search={filter.search} sector={filter.sector ?? "All"} onSearch={onSearch} onSector={onSector} />
      <SelectionSection summary={selection} copied={copied} />
      {/* existing NAV / Day P&L / Allocation / AI alerts sections unchanged below */}
      {/* ...keep current JSX... */}
    </aside>
  );
}
```

- [ ] **Step 4: Run it, confirm PASS.**

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/PortfolioSummary.tsx apps/website/app/components/heroGrid/__tests__/PortfolioSummary.test.tsx
git commit -m "feat(website): PortfolioSummary hosts Filter + Selection sections"
```

---

## Task 10: Wire HeroGrid — columns factory, filters, editing, selection, copy, reducer

**Files:** Modify `apps/website/app/components/HeroGrid.tsx`

This is the integration task. Add state + handlers and pass props through.

- [ ] **Step 1: Edit `HeroGrid.tsx`** — apply all of the following:

(a) **Imports** (add):
```tsx
import { useCallback } from "react";
import { makePositionColumns } from "./heroGrid/positionColumns";
import { withDerivedWeights } from "./heroGrid/positions-math";
import { buildFilters, type FilterState } from "./heroGrid/filters";
import { summarizeSelection, type SelectionSummary } from "./heroGrid/selection";
import { isDeskRejected } from "./heroGrid/qty-edit";
import type { PretableSelectionState } from "@pretable/react";
```
Remove the old `import { positionColumns } from "./heroGrid/positionColumns";`.

(b) **Live rows ref + stable columns** (so the qty `validate` sees current NAV without recreating the grid):
```tsx
const rowsRef = useRef<PositionRow[]>([]);
useEffect(() => { rowsRef.current = rows; }, [rows]);
const columns = useMemo(() => makePositionColumns({ getRows: () => rowsRef.current }), []);
```

(c) **New state**:
```tsx
const [filter, setFilter] = useState<FilterState>({ search: "", sector: "All" });
const [selection, setSelection] = useState<SelectionSummary | null>(null);
const [copied, setCopied] = useState(false);
const editedQtyByIdRef = useRef<Map<string, number>>(new Map());
```

(d) **Reducer change** — in the `onTransaction` `tx.update` branch, after merging patches, override edited rows' `mktValue` and re-derive all weights. Replace the existing merge/return with:
```tsx
next = next.map((row) => {
  const patch = byId.get(row.id);
  if (!patch) return row;
  const merged: PositionRow = { ...row, ...patch };
  if (typeof patch.last === "number" && patch.last !== row.last) {
    merged.lastDir = patch.last > row.last ? "up" : "down";
    merged.tickSeq = (row.tickSeq ?? 0) + 1;
  }
  const editedQty = editedQtyByIdRef.current.get(row.id);
  if (editedQty !== undefined) {
    merged.qty = editedQty;
    merged.mktValue = Math.round(editedQty * merged.last);
  }
  return merged;
});
next = withDerivedWeights(next); // keep weight consistent with current mktValues
```
Apply the same `withDerivedWeights(next)` after the `tx.add` branch too (so initial rows get correct weights — they already do from the recording, but this is idempotent and harmless).

(e) **filters → controlled state**: compute and pass merged state:
```tsx
const filterMap = useMemo(() => buildFilters(filter), [filter]);
// in <PretableSurface ... >:
state={{ ...(userSort ? { sort: userSort } : {}), filters: filterMap }}
```
(Replace the existing `state={userSort ? { sort: userSort } : null}`.)

(f) **onCellEdit** (the saving phase — submit delay, desk rejection, apply):
```tsx
const handleCellEdit = useCallback(async ({ rowId, columnId, value }: {
  rowId: string; columnId: string; value: unknown; row: PositionRow;
}) => {
  if (columnId !== "qty") return;
  const qty = value as number;
  await new Promise((r) => setTimeout(r, 700)); // simulated order submission (status = saving)
  if (isDeskRejected(rowId, qty)) {
    throw new Error("Rejected by trading desk"); // → markEditError
  }
  editedQtyByIdRef.current.set(rowId, qty);
  setRows((prev) => withDerivedWeights(prev.map((r) =>
    r.id === rowId ? { ...r, qty, mktValue: Math.round(qty * r.last) } : r,
  )));
}, []);
```

(g) **onSelectionChange** → summary (needs current visible order; derive from sortedRows + columns):
```tsx
const handleSelectionChange = useCallback((next: PretableSelectionState) => {
  const colOrder = columns.map((c) => c.id);
  const rowOrder = sortedRowsRef.current.map((r) => r.id);
  setSelection(summarizeSelection(next, colOrder, rowOrder));
}, [columns]);
```
Add `const sortedRowsRef = useRef<PositionRow[]>([]);` and `useEffect(() => { sortedRowsRef.current = sortedRows; }, [sortedRows]);` (so the callback reads the latest order without re-creating).

(h) **Copy feedback** — a document keydown listener shows "Copied ✓" transiently when ⌘/Ctrl+C fires with an active selection (the surface performs the actual copy):
```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "c" || e.key === "C") && selection) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
}, [selection]);
```

(i) **Wire props on `<PretableSurface>`**: add `columns={columns}`, `onCellEdit={handleCellEdit}`, `onSelectionChange={handleSelectionChange}`, `copyWithHeaders`. Keep `rows={sortedRows}`, `getRowId`, `viewportHeight`, `rowSelectionColumn`, `onSortChange`.

(j) **Wire `<PortfolioSummary>`**:
```tsx
<PortfolioSummary
  rows={rows}
  filter={filter}
  onSearch={(search) => setFilter((f) => ({ ...f, search }))}
  onSector={(sector) => setFilter((f) => ({ ...f, sector }))}
  selection={selection}
  copied={copied}
/>
```

(k) **Reduced-motion path**: where the effect currently does `setRows(startingPositions())`, wrap with `withDerivedWeights(...)` for consistency: `setRows(withDerivedWeights(startingPositions()));`

- [ ] **Step 2: Typecheck** — `pnpm --filter @pretable/app-website typecheck` → PASS. Fix any prop/type mismatches (e.g. `state` typing now always an object).

- [ ] **Step 3: Lint** — `pnpm --filter @pretable/app-website lint` → PASS (the mount-once effects already carry the project's eslint-disable for exhaustive-deps where needed; add a targeted disable + reason if lint flags the columns/handlers).

- [ ] **Step 4: Commit**

```bash
git add apps/website/app/components/HeroGrid.tsx
git commit -m "feat(website): wire editing, filtering, selection + copy into the cockpit"
```

---

## Task 11: Interaction legend caption + qty pencil affordance + sidebar width

**Files:** Modify `apps/website/app/components/HeroGrid.tsx` (legend caption), `heroGrid/cells.module.css` (pencil), `heroGrid/heroGrid.module.css` (sidebar width)

- [ ] **Step 1: Legend caption** — under the grid surface in `HeroGrid.tsx`, add a caption element below the `<PretableSurface>` wrapper:
```tsx
<p className={styles.legend}>double-click to edit · drag to select · ⌘C copy</p>
```
Add to `heroGrid.module.css`:
```css
.legend { margin: 0; padding: 4px 10px; font-size: 11px; color: var(--pt-text-muted, #888);
  border-top: 1px solid var(--pt-rule, #eee); }
```

- [ ] **Step 2: Pencil affordance** — in `cells.module.css`, add a hover pencil on editable qty cells:
```css
[data-pretable-column-id="qty"] { position: relative; }
[data-pretable-column-id="qty"]:hover::after { content: "✎"; position: absolute; right: 4px; top: 50%;
  transform: translateY(-50%); font-size: 10px; opacity: .5; pointer-events: none; }
```

- [ ] **Step 3: Sidebar width** — in `heroGrid.module.css`, widen `.heroSidebar` from `flex: 0 0 300px` if needed to `flex: 0 0 300px` (already 300px; confirm the chips wrap acceptably — if cramped, bump to 320px).

- [ ] **Step 4: Lint** — `pnpm --filter @pretable/app-website lint` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/HeroGrid.tsx apps/website/app/components/heroGrid/cells.module.css apps/website/app/components/heroGrid/heroGrid.module.css
git commit -m "feat(website): legend caption, qty pencil affordance, sidebar fit"
```

---

## Task 12: Smoke tests (interactions under streaming)

**Files:** Modify `apps/website/e2e/smoke.spec.ts`

Add one spec exercising the new interactions against the live (streaming) hero. Use stable selectors: `[data-pretable-cell][data-pretable-column-id="qty"]`, `[data-pretable-scroll-viewport]`, the sidebar filter input/chips by role/placeholder.

- [ ] **Step 1: Add the test**

```ts
test("cockpit: edit qty (guardrail reject), filter, and select+copy under streaming", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({ timeout: 10_000 });

  // --- Filter: search narrows the book, sector chip narrows further, clear restores ---
  const search = page.getByPlaceholder(/filter symbol/i);
  const before = await page.locator("[data-pretable-row]").count();
  await search.fill("NVDA");
  await expect(page.locator("[data-pretable-row]")).toHaveCount(1);
  await search.fill("");
  await expect.poll(async () => page.locator("[data-pretable-row]").count()).toBe(before);
  await page.getByRole("button", { name: "Energy" }).click();
  await expect(page.locator("[data-pretable-row]").first()).toBeVisible();
  await page.getByRole("button", { name: "All" }).click();

  // --- Edit qty → 7% guardrail rejection (huge qty) ---
  const nvdaQty = page.locator('[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="qty"]');
  await nvdaQty.dblclick();
  const input = page.getByLabel("Edit quantity");
  await input.fill("9000000");
  await input.press("Enter");
  await expect(page.getByText(/guardrail/i)).toBeVisible({ timeout: 5000 });
  await input.press("Escape");

  // --- Selection summary + copy, surviving ticks ---
  const cellA = page.locator('[data-pretable-row][data-pretable-row-id="NVDA"] [data-pretable-column-id="dayPnl"]');
  const cellB = page.locator('[data-pretable-row][data-pretable-row-id="MSFT"] [data-pretable-column-id="weight"]');
  await cellA.click();
  await cellB.click({ modifiers: ["Shift"] });
  await expect(page.getByText(/selected · ⌘C to copy/i)).toBeVisible();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
  await expect(page.getByText(/Copied/i)).toBeVisible();
  await page.waitForTimeout(2000); // ticks
  await expect(page.getByText(/selected/i)).toBeVisible(); // selection persists
});
```

- [ ] **Step 2: Run smoke locally** — start the dev server (`PORT=3100 pnpm --filter @pretable/app-website dev`), then `BASE_URL=http://localhost:3100 pnpm --filter @pretable/app-website exec playwright test e2e/smoke.spec.ts --project=chromium`. Expected: PASS. If the guardrail editor closes too fast under streaming, assert on the popover text immediately after Enter (already done). Fix selectors as needed against the real DOM.

- [ ] **Step 3: Commit**

```bash
git add apps/website/e2e/smoke.spec.ts
git commit -m "test(website): smoke for editing, filtering, selection+copy under streaming"
```

---

## Task 13: Full validation

- [ ] **Step 1: Run the suite** (from repo root, sequentially):
```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website build
pnpm --filter @pretable/app-website smoke   # against a running dev server or BASE_URL
```
Expected: all PASS.

- [ ] **Step 2: Manual check** — `dev` server; verify: double-click NVDA qty → "compliance check…" then "submitting order…" popover; a huge qty → "breaches 7% guardrail"; a modest qty → applies and weight/NAV shift live while prices keep ticking; search + sector chip narrow the book live; drag-select cells → sidebar shows "N × M selected"; ⌘C → "Copied ✓"; reduced-motion still renders the settled snapshot.

- [ ] **Step 3: Commit anything outstanding; then proceed to finishing-a-development-branch (PR).**

---

## Self-review checklist (run before PR)

- [ ] Spec coverage: A1 editing (Tasks 2,5,6,10), guardrail via live NAV (5,10), desk rejection (2,10), edited-row weight/NAV recompute under streaming (1,10); A2 selection summary + copy (4,8,10), keyboard/range default (no code — verify in smoke 12); A3 search+sector via replaceFilters (3,5,9,10); sidebar restructure (7,8,9); legend + pencil (11). ✔
- [ ] No `RaceRow`/stale symbols; types consistent: `FilterState`, `SelectionSummary`, `makePositionColumns`, `withDerivedWeights`, `buildFilters`, `summarizeSelection`, `parseQty`, `isDeskRejected`.
- [ ] `columns` identity stable (built once via `useMemo([])` + `getRows` ref) — does not reintroduce the grid-recreation/selection-loss bug.
- [ ] No `packages/*` changes. If a genuine library bug surfaces, fix it as its own commit with tests (no new public API) per the spec's scope guard.

## Execution notes

- Tasks 1–4 are independent pure helpers (could be done in any order). Task 6 (QtyEditor) is imported by Task 5; do 6 before/with 5 if the test runner resolves imports eagerly.
- Task 10 is the integration centerpiece — review it carefully (it's where streaming, editing, and the grid-stability rule intersect).
